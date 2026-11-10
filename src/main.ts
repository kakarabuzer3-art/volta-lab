import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import {
  Engine, MAX_SETPOINT_V, deepFreeze, outputStageDescription, displayPresentation, displayState, validateLoad, acInputSupplyLoad, capacitiveLoad, dcModuleLoad, dcMotorLoad, inductiveLoad, resistiveLoad, rlcLoad,
} from './sim/index.ts';
import type { Connection, Load, Snapshot } from './sim/index.ts';

// All electrical behaviour (battery, DC-DC / inverter conversion, loads, protection, energy ledger)
// is computed by ONE deterministic engine in ./sim/. This file only draws its Snapshot and routes input.
// (Legacy ./electrical.ts is kept as the earlier Thevenin reference model and is no longer used here.)
type SourceMode = 'AC' | 'DC';
const MAX_VOLTAGE = MAX_SETPOINT_V;
const engine = new Engine();
const CURRENT_LIMIT_A = engine.config.converter.outCurrentLimitA;
const TRIP_DELAY_S = engine.config.tripDelayS;
const SPARK_REF_VOLTAGE = 220; // spark size at this setting is the original look; higher voltage grows it
const SPARK_MAX = 192;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('sceneCanvas') as HTMLCanvasElement;
const sceneWrap = $('sceneWrap');

// -----------------------------------------------------------------------------
// Volta Lab Industrial Edition. The 3D model is an enclosed consumer/workshop-
// style power unit. Telemetry and sparks are intentionally labelled simulation.
// This is not a validated electrical, arc, or human-shock model; the spark is purely visual.
// -----------------------------------------------------------------------------
// Studio backdrop painted as a dithered radial gradient (a flat colour or a CSS
// overlay would either look dead or put a haze layer on top of the machine).
function makeBackdropTexture() {
  const size = 1024;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.52, size * 0.46, 30, size * 0.5, size * 0.56, size * 0.74);
  g.addColorStop(0, '#242b31'); g.addColorStop(0.45, '#12171c'); g.addColorStop(1, '#07090b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 3; // tiny dither removes colour banding in dark gradients
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const scene = new THREE.Scene();
scene.background = makeBackdropTexture();
scene.fog = new THREE.FogExp2('#080a0d', 0.012);

const BASE_FOV = 34;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 100);
const defaultCamera = new THREE.Vector3(0.2, 0.45, 7.5);
const defaultTarget = new THREE.Vector3(0, -0.12, 0);
const detailCamera = new THREE.Vector3(-0.1, 0.22, 5.75);
const detailTarget = new THREE.Vector3(-0.1, -0.05, 0);
camera.position.copy(defaultCamera);
camera.lookAt(defaultTarget);
/** Rendering resolution: up to 2x on desktop; capped at 1.5x on touch-first devices, where fill rate (GPU and battery) is the limit. */
function renderPixelRatio() { return Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2); }
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(renderPixelRatio());
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

// Every canvas texture on the machine (screen, labels, floor grid) goes through
// here: mipmaps + max anisotropy keep small text crisp at oblique viewing angles.
function sharpen(texture: THREE.CanvasTexture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

// prefers-reduced-motion is honoured in the scene too (CSS alone cannot stop WebGL animation): no camera inertia, no pulsing
// lights or tip rings, instant (not eased) switch/lever movement and a steady, non-flickering fault flash with no drifting particles.
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = reducedMotionQuery.matches;
canvas.dataset.reducedMotion = String(reduceMotion);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = !reduceMotion;
controls.dampingFactor = 0.065;
controls.target.copy(defaultTarget);
controls.minDistance = 5.2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.82;
controls.update();

// ---- Camera modes -------------------------------------------------------------------------------------------
// ONE source of truth (`cameraMode`) decides which OrbitControls permissions exist. `pointerLock` is a separate,
// temporary lock used while a cable tip / dial is being dragged. applyCameraControls() is the ONLY function that
// writes controls.enabled / enableRotate / enableZoom / enablePan, so ending a drag can never re-enable something
// the selected mode forbids.
type CameraMode = 'free' | 'locked' | 'zoom-only' | 'rotate-only';
const CAMERA_CYCLE: readonly CameraMode[] = ['free', 'locked', 'zoom-only', 'rotate-only'];
const CAMERA_LABEL: Record<CameraMode, string> = { free: 'VIEW FREE', locked: 'VIEW LOCKED', 'zoom-only': 'ZOOM ONLY', 'rotate-only': 'ROTATE ONLY' };
let cameraMode: CameraMode = 'free';
let pointerLock = false;
function applyCameraControls() {
  controls.enabled = !pointerLock;
  controls.enableRotate = cameraMode === 'free' || cameraMode === 'rotate-only';
  controls.enableZoom = cameraMode === 'free' || cameraMode === 'zoom-only';
  controls.enablePan = cameraMode === 'free';
  canvas.dataset.cameraMode = cameraMode;
}
/** Drop any damping/inertia that is still pending WITHOUT moving the camera (flags alone do not stop it). */
function stopCameraMomentum() {
  const p = camera.position.clone(), t = controls.target.clone();
  controls.enableDamping = false;
  controls.update(); // flushes the pending rotate/zoom/pan deltas to zero
  camera.position.copy(p); controls.target.copy(t);
  controls.enableDamping = !reduceMotion;
  controls.update(); // re-derives orientation from the restored position; deltas are zero, so nothing moves
}
function setCameraMode(mode: CameraMode) {
  cameraMode = mode;
  stopCameraMomentum();
  applyCameraControls();
}

scene.add(new THREE.HemisphereLight('#d6e0ed', '#111318', 1.75));
const keyLight = new THREE.DirectionalLight('#f2f6ff', 3.2);
keyLight.position.set(4.2, 5.5, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048); // 4x the texels of the old 1024 map = crisper contact shadows
keyLight.shadow.camera.left = -4.6; keyLight.shadow.camera.right = 4.6;
keyLight.shadow.camera.top = 4.6; keyLight.shadow.camera.bottom = -4.6;
keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 18;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);
const rimLight = new THREE.PointLight('#4688bd', 18, 8, 2);
rimLight.position.set(2.6, 1.7, -1.6);
scene.add(rimLight);
const warmLight = new THREE.PointLight('#d78452', 10, 6, 2);
warmLight.position.set(-2.9, 1.2, 1.2);
scene.add(warmLight);
const frontFill = new THREE.PointLight('#9ab7cc', 22, 9, 2);
frontFill.position.set(0, 1, 5.3);
scene.add(frontFill);

const mat = (color: string, metalness = 0.3, roughness = 0.45, emissive?: string, emissiveIntensity = 0.2) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...(emissive ? { emissive, emissiveIntensity } : {}) });
const caseMat = mat('#171a1e', 0.68, 0.36);
const frontMat = mat('#0c0f12', 0.55, 0.32);
const insetMat = mat('#080b0e', 0.4, 0.34);
const darkSteel = mat('#222830', 0.82, 0.28);
const edgeSteel = mat('#606974', 0.9, 0.22);
const screwMat = mat('#9aa3ad', 0.92, 0.2);
const rubberMat = mat('#08090b', 0.05, 0.84);
const ventMat = mat('#030507', 0.25, 0.72);
const screenGlow = mat('#9bfde1', 0.15, 0.2, '#2ee6be', 0.7);
const redCableMat = mat('#ac202b', 0.1, 0.72, '#35060a', 0.08);
const blackCableMat = mat('#20242a', 0.13, 0.68);
const brassMat = mat('#c4a46d', 0.85, 0.24);
const copperTipMat = mat('#d9ad83', 0.8, 0.22, '#57371f', 0.12);

// Industrial ground slab. The machine's four rubber feet end at y = -1.18, so the slab's TOP face sits exactly there:
// the feet touch it (no gap, no sinking) and it receives the existing key-light shadow map for the foot contact shadows.
// It is wider and deeper than the machine + both cable lengths, perfectly flat, and only ~6 cm thick (not a podium).
const GROUND_TOP_Y = -1.18;
const GROUND_W = 11.4, GROUND_D = 7.6, GROUND_R = 0.55, GROUND_T = 0.06, GROUND_CZ = 0.45;
function roundedRectShape(w: number, d: number, r: number, inset = 0): THREE.Shape {
  const x = w / 2 - inset, y = d / 2 - inset, rr = Math.max(0.01, r - inset);
  const sh = new THREE.Shape();
  sh.moveTo(-x + rr, -y);
  sh.lineTo(x - rr, -y); sh.absarc(x - rr, -y + rr, rr, -Math.PI / 2, 0, false);
  sh.lineTo(x, y - rr); sh.absarc(x - rr, y - rr, rr, 0, Math.PI / 2, false);
  sh.lineTo(-x + rr, y); sh.absarc(-x + rr, y - rr, rr, Math.PI / 2, Math.PI, false);
  sh.lineTo(-x, -y + rr); sh.absarc(-x + rr, -y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return sh;
}
const groundGeometry = new THREE.ExtrudeGeometry(roundedRectShape(GROUND_W, GROUND_D, GROUND_R), { depth: GROUND_T, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 20 });
const ground = new THREE.Mesh(groundGeometry, mat('#232a32', 0.12, 0.84));
// Extrusion runs along +z of the shape plane; rotate so the shape lies flat (x/z) and the extrusion points up.
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, GROUND_TOP_Y - GROUND_T - 0.012, GROUND_CZ);
ground.receiveShadow = true;
scene.add(ground);
// Restrained perimeter detail: a thin edge highlight and a dim inset safety line, both lying flat on the top face.
function groundOutline(inset: number, color: string, opacity: number): THREE.LineLoop {
  const pts = roundedRectShape(GROUND_W, GROUND_D, GROUND_R, inset).getPoints(24).map((v) => new THREE.Vector3(v.x, GROUND_TOP_Y + 0.002, -v.y + GROUND_CZ));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}
scene.add(groundOutline(0.02, '#566677', 0.7), groundOutline(0.3, '#6b5a2c', 0.4));
// Far surround: very dark and unlit-looking so it reads as the room floor, not as another platform.
const surround = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#07090c', 0.1, 0.95));
surround.rotation.x = -Math.PI / 2;
surround.position.y = GROUND_TOP_Y - GROUND_T - 0.03;
surround.receiveShadow = true;
scene.add(surround);

const machine = new THREE.Group();
scene.add(machine);

function addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, bevel = false) {
  const geometry = bevel
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 4, Math.min(size[0], size[1], size[2]) * 0.12)
    : new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function addFrontBolt(x: number, y: number) {
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.025, 18), screwMat);
  head.rotation.x = Math.PI / 2;
  head.position.set(x, y, 0.767);
  head.castShadow = true;
  machine.add(head);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.029, 0.006, 0.004), ventMat);
  slot.position.set(x, y, 0.782);
  machine.add(slot);
}

// Rugged rectangular industrial casing: deliberately closed, no exposed rotor.
addBox(machine, [3.62, 0.18, 1.58], [0, -0.93, 0], darkSteel, true); // base rail
addBox(machine, [3.33, 0.16, 1.42], [0, -1.035, 0], caseMat, true); // lower chassis
const shell = addBox(machine, [3.36, 1.78, 1.38], [0, -0.055, 0], caseMat, true);
shell.castShadow = true;
addBox(machine, [3.18, 1.57, 0.07], [0, -0.055, 0.708], frontMat, true); // recessed front fascia
addBox(machine, [3.08, 0.035, 0.035], [0, 0.747, 0.754], edgeSteel, true); // upper fascia edge
addBox(machine, [3.08, 0.028, 0.035], [0, -0.855, 0.754], darkSteel, true); // lower fascia edge

// Side cover seams and rows of ventilation louvers on the visible right side.
for (const side of [-1, 1]) {
  addBox(machine, [0.035, 1.38, 0.055], [side * 1.675, -0.055, 0.08], darkSteel, true);
  for (let i = 0; i < 8; i++) {
    const y = 0.46 - i * 0.145;
    const louver = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.043, 0.68), edgeSteel);
    louver.position.set(side * 1.696, y, -0.02);
    louver.castShadow = true;
    machine.add(louver);
    const shadowSlot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.62), ventMat);
    shadowSlot.position.set(side * 1.699, y - 0.025, -0.02);
    machine.add(shadowSlot);
  }
}

// Top carry handles and mounting brackets.
for (const x of [-0.55, 0.55]) {
  addBox(machine, [0.26, 0.1, 0.25], [x, 0.87, -0.1], darkSteel, true);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 18), edgeSteel);
  post.position.set(x, 0.995, -0.1);
  post.castShadow = true;
  machine.add(post);
}
const handle = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 10, 40, Math.PI), edgeSteel);
handle.position.set(0, 1.055, -0.1);
handle.castShadow = true;
machine.add(handle);

// Four rubber mounting feet and restrained metallic hardware.
for (const x of [-1.42, 1.42]) {
  for (const z of [-0.53, 0.53]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.16, 20), rubberMat);
    foot.position.set(x, -1.10, z);
    foot.castShadow = true;
    machine.add(foot);
    const footWasher = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 20), edgeSteel);
    footWasher.position.set(x, -1.02, z);
    machine.add(footWasher);
  }
}
for (const x of [-1.49, 1.49]) for (const y of [-0.76, 0.65]) addFrontBolt(x, y);

// Printed product label rendered as a canvas texture.
// Drawn at 3x the old resolution (1800x240 instead of 600x80) with larger type,
// then mip-mapped + anisotropic, so the printed text stays sharp.
const MONO = "'DM Mono', ui-monospace, Menlo, Consolas, monospace";
function makeLabelTexture(title: string, subtitle: string, aspect = 7.5) {
  // Canvas aspect must equal the plane aspect, otherwise the text is squashed (blurry/distorted).
  const c = document.createElement('canvas'); c.width = Math.round(240 * aspect); c.height = 240;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#c3cdd5'; ctx.font = '600 84px Arial, Helvetica, sans-serif'; ctx.fillText(title, 18, 102);
  ctx.fillStyle = '#74838f'; ctx.font = `500 54px ${MONO}`; ctx.fillText(subtitle, 22, 188);
  return sharpen(new THREE.CanvasTexture(c));
}
const brandLabel = new THREE.Mesh(
  new THREE.PlaneGeometry(1.5, 0.2),
  new THREE.MeshBasicMaterial({ map: makeLabelTexture('VOLTA LAB  /  V-415', 'INDUSTRIAL POWER UNIT'), transparent: true, toneMapped: false }),
);
brandLabel.position.set(-0.64, 0.655, 0.755);
machine.add(brandLabel);

// Inset digital display mounted on the casing. Drawn on a 720x190 logical grid but
// rasterised at 2x (1440x380) and sampled with mipmaps + anisotropy so the digits
// stay sharp. The bezel and glass are larger than before so values are readable
// at the default camera distance.
const DISPLAY_W = 720, DISPLAY_H = 190, DISPLAY_SCALE = 2;
const displayCanvas = document.createElement('canvas');
displayCanvas.width = DISPLAY_W * DISPLAY_SCALE; displayCanvas.height = DISPLAY_H * DISPLAY_SCALE;
const displayContext = displayCanvas.getContext('2d')!;
const displayTexture = sharpen(new THREE.CanvasTexture(displayCanvas));
const displayFrame = addBox(machine, [1.98, 0.58, 0.11], [-0.5, 0.27, 0.761], darkSteel, true);
const displayInner = addBox(machine, [1.9, 0.51, 0.035], [-0.5, 0.27, 0.827], insetMat, true);
const DISPLAY_PLANE_W = 1.84;
const displayPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(DISPLAY_PLANE_W, DISPLAY_PLANE_W * DISPLAY_H / DISPLAY_W),
  new THREE.MeshBasicMaterial({ map: displayTexture, toneMapped: false }),
);
displayPlane.position.set(-0.5, 0.27, 0.849);
machine.add(displayPlane);

// Very faint diagonal glass sheen above the screen (kept subtle so it never reduces contrast).
const sheenCanvas = document.createElement('canvas'); sheenCanvas.width = 256; sheenCanvas.height = 64;
{
  const sctx = sheenCanvas.getContext('2d')!;
  const g = sctx.createLinearGradient(0, 0, 256, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.38, 'rgba(255,255,255,0.02)');
  g.addColorStop(0.4, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  sctx.fillStyle = g; sctx.fillRect(0, 0, 256, 64);
}
const displaySheen = new THREE.Mesh(
  new THREE.PlaneGeometry(DISPLAY_PLANE_W, DISPLAY_PLANE_W * DISPLAY_H / DISPLAY_W),
  new THREE.MeshBasicMaterial({ map: sharpen(new THREE.CanvasTexture(sheenCanvas)), transparent: true, depthWrite: false, toneMapped: false }),
);
displaySheen.position.set(-0.5, 0.27, 0.8505);
machine.add(displaySheen);

let lastDisplayKey = '';
// Fonts load asynchronously: repaint once they are ready so the screen never keeps fallback glyphs.
document.fonts?.ready.then(() => { lastDisplayKey = ''; });
function paintMachineDisplay(snap: Snapshot) {
  const o = snap.output;
  const pres = displayPresentation(snap); // single source of truth for lit / tone / chip (see ./sim/status.ts)
  const mode = pres.mode;
  const state = pres.state;
  const ac = o.kind === 'ac';
  const lit = pres.lit;
  const status = pres.chip;
  canvas.dataset.displayLit = String(lit); canvas.dataset.displayState = state; // diagnostic attributes for the browser check (the LCD is a canvas texture)
  const freqText = ac ? o.freqHz.toFixed(1) : 'DC';
  const peakText = o.vPeakV === null ? 'n/a' : o.vPeakV.toFixed(1);
  const socText = `${(snap.battery.socFrac * 100).toFixed(0)}%`;
  // Only re-upload the texture when something visible actually changed.
  const key = [mode, state, lit, status, pres.faultLines?.join('/') ?? '', o.voltage.toFixed(1), o.currentA.toFixed(2), Math.round(o.pRealW), o.targetV.toFixed(0), peakText, freqText, o.currentLimited, socText].join('|');
  if (key === lastDisplayKey) return;
  lastDisplayKey = key;

  const ctx = displayContext;
  const W = DISPLAY_W, H = DISPLAY_H;
  // Lit whenever Main Power is ON (including every fault); only Main Power OFF gives the dim, unlit palette.
  const accent = state === 'protected' ? '#ff7a7a' : state === 'empty' ? '#ffb347' : state === 'short' ? '#ffa56b' : lit ? '#4be1ac' : '#5b7068';
  const bright = lit ? '#c4ffec' : '#4d6a5f';
  const soft = lit ? '#8fe6c6' : '#4d6a5f';
  const label = '#68a592';

  ctx.setTransform(DISPLAY_SCALE, 0, 0, DISPLAY_SCALE, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#07130f'); bg.addColorStop(1, '#0a211a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Header bar: source mode + status chip.
  ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, W, 42);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = label; ctx.font = `500 18px ${MONO}`; ctx.fillText(`${mode} OUTPUT  ·  V-415  ·  SIM`, 24, 22);
  ctx.textAlign = 'right'; ctx.fillText(`BAT ${socText}`, 556, 22); ctx.textAlign = 'left';
  ctx.beginPath(); ctx.roundRect(574, 9, 122, 25, 12.5);
  ctx.fillStyle = state === 'off' ? 'rgba(255,255,255,0.05)' : `${accent}26`; ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(592, 21.5, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.font = `500 16px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(status, 647, 22); ctx.textAlign = 'left';

  // Main voltage read-out: RMS for AC, steady value for DC.
  ctx.textBaseline = 'alphabetic';
  const vText = o.voltage.toFixed(1);
  ctx.fillStyle = bright; ctx.font = `500 78px ${MONO}`; ctx.fillText(vText, 24, 114);
  const vw = ctx.measureText(vText).width;
  ctx.fillStyle = soft; ctx.font = `500 32px ${MONO}`; ctx.fillText('V', 24 + vw + 8, 114);
  ctx.fillStyle = label; ctx.font = `500 16px ${MONO}`; ctx.fillText(ac ? 'RMS' : 'DC', 24 + vw + 8 + 24, 114);

  // Set-point bar (open-circuit voltage) with ticks, plus peak value (AC) or polarity (DC).
  const bx = 430, bw = 266;
  if (pres.faultLines) {
    // Fault: the screen stays lit and says what happened (never a blank screen while Main Power is ON).
    ctx.fillStyle = `${accent}22`; ctx.beginPath(); ctx.roundRect(bx - 8, 54, bw + 16, 70, 8); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = accent; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 20px ${MONO}`; ctx.fillText('! ' + pres.faultLines[0], bx + 6, 86);
    ctx.fillStyle = bright; ctx.font = `500 15px ${MONO}`; ctx.fillText(pres.faultLines[1], bx + 6, 110);
  } else {
  ctx.fillStyle = label; ctx.font = `500 14px ${MONO}`; ctx.fillText('SET', bx, 72);
  ctx.textAlign = 'right'; ctx.fillText(ac ? `PEAK ${peakText} V` : 'A: +   B: −', bx + bw, 72); ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.beginPath(); ctx.roundRect(bx, 84, bw, 10, 5); ctx.fill();
  const frac = Math.max(0, Math.min(1, o.targetV / MAX_VOLTAGE));
  if (frac > 0.005) {
    const fill = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    fill.addColorStop(0, '#2fa77f'); fill.addColorStop(1, accent);
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(bx, 84, Math.max(10, bw * frac), 10, 5); ctx.fill();
  }
  ctx.fillStyle = 'rgba(160,220,196,0.35)';
  for (let i = 0; i <= 4; i++) ctx.fillRect(bx + (bw * i) / 4 - 0.5, 100, 1, 6);
  ctx.fillStyle = '#5a8574'; ctx.font = `500 13px ${MONO}`;
  ctx.textAlign = 'left'; ctx.fillText('0', bx, 122);
  ctx.textAlign = 'center'; ctx.fillText(String(Math.round(MAX_VOLTAGE / 2)), bx + bw / 2, 122);
  ctx.textAlign = 'right'; ctx.fillText(String(MAX_VOLTAGE), bx + bw, 122); ctx.textAlign = 'left';
  }

  // Secondary read-outs. DC has no frequency, so it shows "DC" instead of a number.
  ctx.fillStyle = 'rgba(120,200,170,0.16)'; ctx.fillRect(24, 130, W - 48, 1);
  const cells: Array<[string, string, string]> = [
    [o.currentLimited ? 'CURRENT · LIMIT' : 'CURRENT', o.currentA.toFixed(2), 'A'],
    ['FREQUENCY', freqText, ac ? 'Hz' : ''],
    ['POWER', Math.round(o.pRealW).toLocaleString('en-US'), 'W'],
  ];
  cells.forEach(([name, value, unit], i) => {
    const x = 24 + i * 232;
    ctx.fillStyle = label; ctx.font = `500 14px ${MONO}`; ctx.fillText(name, x, 150);
    ctx.fillStyle = soft; ctx.font = `500 28px ${MONO}`; ctx.fillText(value, x, 178);
    const w = ctx.measureText(value).width;
    ctx.fillStyle = label; ctx.font = `500 16px ${MONO}`; ctx.fillText(unit, x + w + 6, 178);
  });

  ctx.strokeStyle = 'rgba(75,225,172,0.28)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
  displayTexture.needsUpdate = true;
}

// Physical rocker switch on the front fascia.
const powerButtonGroup = new THREE.Group();
powerButtonGroup.position.set(0.81, 0.36, 0.82);
powerButtonGroup.userData.control = 'power';
machine.add(powerButtonGroup);
const rockerBezel = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.27, 0.10, 4, 0.035), insetMat);
rockerBezel.castShadow = true;
powerButtonGroup.add(rockerBezel);
const rockerMat = mat('#242a2e', 0.6, 0.27);
const rocker = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.17, 0.075, 4, 0.025), rockerMat);
rocker.position.z = 0.055;
rocker.castShadow = true;
powerButtonGroup.add(rocker);
// Printed "I" (on) and "O" (off) symbols on the rocker face. They tilt with the rocker.
function makeSymbolTexture(kind: 'I' | 'O') {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round';
  if (kind === 'I') { ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(64, 22); ctx.lineTo(64, 106); ctx.stroke(); }
  else { ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(64, 64, 34, 0, Math.PI * 2); ctx.stroke(); }
  return sharpen(new THREE.CanvasTexture(c));
}
const symbolOnMat = new THREE.MeshBasicMaterial({ map: makeSymbolTexture('I'), transparent: true, toneMapped: false, depthWrite: false });
const symbolOffMat = new THREE.MeshBasicMaterial({ map: makeSymbolTexture('O'), transparent: true, toneMapped: false, depthWrite: false });
const symbolOn = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), symbolOnMat);
symbolOn.position.set(0, 0.042, 0.0385);
const symbolOff = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), symbolOffMat);
symbolOff.position.set(0, -0.042, 0.0385);
rocker.add(symbolOn, symbolOff);
let rockerTarget = 0.2;
const physicalPowerLedMat = mat('#762e32', 0.1, 0.2, '#ff2638', 0.65);
const physicalPowerLed = new THREE.Mesh(new THREE.SphereGeometry(0.042, 18, 18), physicalPowerLedMat);
physicalPowerLed.position.set(1.12, 0.36, 0.83);
machine.add(physicalPowerLed);
const powerLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.1), new THREE.MeshBasicMaterial({ map: makeLabelTexture('POWER', 'I = ON  O = OFF', 4.6), transparent: true, toneMapped: false }));
powerLabel.position.set(0.81, 0.18, 0.795);
machine.add(powerLabel);

// Physical output-level dial. Drag it horizontally or use the onscreen slider.
const dialGroup = new THREE.Group();
dialGroup.position.set(0.81, -0.18, 0.815);
dialGroup.userData.control = 'dial';
machine.add(dialGroup);
const dialRim = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.032, 10, 40), edgeSteel);
dialRim.position.z = 0.03;
dialGroup.add(dialRim);
const dialFace = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.075, 40), mat('#13181c', 0.75, 0.3));
dialFace.rotation.x = Math.PI / 2;
dialFace.position.z = 0.005;
dialFace.castShadow = true;
dialGroup.add(dialFace);
const dialCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.075, 32), darkSteel);
dialCenter.rotation.x = Math.PI / 2;
dialCenter.position.z = 0.054;
dialGroup.add(dialCenter);
const dialNeedle = new THREE.Group();
const dialNeedleBar = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.105, 0.018), screenGlow);
dialNeedleBar.position.set(0, 0.055, 0.103);
dialNeedleBar.castShadow = true;
dialNeedle.add(dialNeedleBar);
dialGroup.add(dialNeedle);
const dialTickMaterial = mat('#a1abb4', 0.45, 0.4);
for (let i = 0; i < 11; i++) {
  const angle = THREE.MathUtils.degToRad(-140 + i * 28);
  const tick = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.012), dialTickMaterial);
  tick.position.set(Math.sin(angle) * 0.162, Math.cos(angle) * 0.162, 0.063);
  tick.rotation.z = -angle;
  dialGroup.add(tick);
}
const dialLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.1), new THREE.MeshBasicMaterial({ map: makeLabelTexture('OUTPUT LEVEL', `0 - ${MAX_VOLTAGE} V`, 5.2), transparent: true, toneMapped: false }));
dialLabel.position.set(0.81, -0.47, 0.795);
machine.add(dialLabel);

// Physical AC / DC mode selector: two-position industrial rotary lever. Left = AC, right = DC.
function makeWhiteTextTexture(text: string, aspect: number) {
  const c = document.createElement('canvas'); c.width = Math.round(160 * aspect); c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 104px Arial, Helvetica, sans-serif'; ctx.fillText(text, c.width / 2, c.height / 2 + 6);
  return sharpen(new THREE.CanvasTexture(c));
}
const modeGroup = new THREE.Group();
modeGroup.position.set(-0.5, -0.30, 0.80);
modeGroup.userData.control = 'mode';
machine.add(modeGroup);
const modeBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.06, 40), insetMat);
modeBezel.rotation.x = Math.PI / 2; modeBezel.castShadow = true;
modeGroup.add(modeBezel);
const modeRing = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.014, 10, 48), edgeSteel);
modeRing.position.z = 0.03;
modeGroup.add(modeRing);
const modeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.07, 32), mat('#13181c', 0.75, 0.3));
modeBody.rotation.x = Math.PI / 2; modeBody.position.z = 0.05; modeBody.castShadow = true;
modeGroup.add(modeBody);
const modeLever = new THREE.Group();
modeLever.position.z = 0.085;
const modeLeverBar = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.17, 0.045, 3, 0.012), edgeSteel);
modeLeverBar.position.y = 0.045; modeLeverBar.castShadow = true;
const modeLeverTip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.008), screenGlow);
modeLeverTip.position.set(0, 0.1, 0.026);
modeLever.add(modeLeverBar, modeLeverTip);
modeGroup.add(modeLever);
const MODE_LEVER_ANGLE = 0.62; // rad; +z rotation tilts the lever left (AC), -z right (DC)
let modeLeverTarget = MODE_LEVER_ANGLE;
const modeAcMat = new THREE.MeshBasicMaterial({ map: makeWhiteTextTexture('AC', 1.5), transparent: true, toneMapped: false, depthWrite: false });
const modeDcMat = new THREE.MeshBasicMaterial({ map: makeWhiteTextTexture('DC', 1.5), transparent: true, toneMapped: false, depthWrite: false });
const modeTitleMat = new THREE.MeshBasicMaterial({ map: makeWhiteTextTexture('AC / DC', 3.6), transparent: true, toneMapped: false, depthWrite: false, color: '#a9b6c0' });
const modeAcLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.1), modeAcMat);
const modeDcLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.1), modeDcMat);
modeAcLabel.position.set(-0.81, -0.235, 0.795);
modeDcLabel.position.set(-0.19, -0.235, 0.795);
const modeTitle = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.1), modeTitleMat);
modeTitle.position.set(-0.5, -0.095, 0.795);
machine.add(modeAcLabel, modeDcLabel, modeTitle);

// Two front-mounted insulated output posts.
const terminalPositions = [new THREE.Vector3(-0.65, -0.635, 0.77), new THREE.Vector3(0.65, -0.635, 0.77)];
for (let i = 0; i < 2; i++) {
  const terminalGroup = new THREE.Group();
  terminalGroup.position.copy(terminalPositions[i]);
  machine.add(terminalGroup);
  const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.11, 24), rubberMat);
  insulator.rotation.x = Math.PI / 2;
  terminalGroup.add(insulator);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.091, 0.091, 0.06, 24), i === 0 ? brassMat : edgeSteel);
  collar.rotation.x = Math.PI / 2; collar.position.z = 0.075;
  terminalGroup.add(collar);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.075, 24), insetMat);
  socket.rotation.x = Math.PI / 2; socket.position.z = 0.112;
  terminalGroup.add(socket);
  const socketCore = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.079, 20), i === 0 ? brassMat : screwMat);
  socketCore.rotation.x = Math.PI / 2; socketCore.position.z = 0.14;
  terminalGroup.add(socketCore);
}

// Cable endpoints float in front of the machine and can be dragged in 3D.
const cableStartPositions = terminalPositions.map((p) => p.clone().add(new THREE.Vector3(0, 0, 0.15)));
const tipPositions = [new THREE.Vector3(-2.68, -1.09, 1.32), new THREE.Vector3(2.68, -1.09, 1.32)];
const tipGroups: THREE.Group[] = [];
const cableMeshes: THREE.Mesh[] = [];
const tipTargets: THREE.Object3D[] = [];
const tipRings: Array<{ ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; glow: THREE.Mesh; glowMat: THREE.MeshBasicMaterial }> = [];
const cableMaterials = [redCableMat, blackCableMat];
for (let i = 0; i < 2; i++) {
  const initialCurve = new THREE.QuadraticBezierCurve3(
    cableStartPositions[i],
    new THREE.Vector3((cableStartPositions[i].x + tipPositions[i].x) / 2, -1.10, 1.23),
    tipPositions[i],
  );
  const cable = new THREE.Mesh(new THREE.TubeGeometry(initialCurve, 42, 0.052, 10, false), cableMaterials[i]);
  cable.castShadow = true;
  scene.add(cable);
  cableMeshes.push(cable);

  const tipGroup = new THREE.Group();
  tipGroup.position.copy(tipPositions[i]);
  const direction = i === 0 ? 1 : -1;
  const jacketMaterial = i === 0 ? mat('#8e1720', 0.12, 0.66) : mat('#191c20', 0.12, 0.64);
  const strainRelief = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.21, 20), jacketMaterial);
  strainRelief.rotation.z = Math.PI / 2;
  strainRelief.position.x = -direction * 0.035;
  strainRelief.castShadow = true;
  tipGroup.add(strainRelief);
  for (let ring = 0; ring < 4; ring++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.009, 6, 20), rubberMat);
    rib.rotation.y = Math.PI / 2;
    rib.position.x = -direction * (0.005 + ring * 0.034);
    tipGroup.add(rib);
  }
  const exposedMetal = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.19, 20), copperTipMat);
  exposedMetal.rotation.z = Math.PI / 2;
  exposedMetal.position.x = direction * 0.135;
  exposedMetal.castShadow = true;
  exposedMetal.userData.tipIndex = i;
  tipGroup.add(exposedMetal);
  const endCap = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 16), screwMat);
  endCap.position.x = direction * 0.23;
  endCap.userData.tipIndex = i;
  tipGroup.add(endCap);
  const tipHalo = new THREE.Mesh(new THREE.TorusGeometry(0.067, 0.009, 6, 20), i === 0 ? brassMat : screwMat);
  tipHalo.position.x = direction * 0.23;
  tipHalo.userData.tipIndex = i;
  tipGroup.add(tipHalo);
  tipGroup.traverse((child: THREE.Object3D) => { child.userData.tipIndex = i; });
  scene.add(tipGroup);
  tipGroups.push(tipGroup);
  // Generous invisible hit sphere around the exposed metal end (≈35 px radius at the default view) — the ONLY wire
  // object the raycaster tests, so the middle of the cable and the rest of the machine can never be picked as a tip.
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.x = direction * 0.17;
  hit.userData.tipIndex = i;
  tipGroup.add(hit);
  tipTargets.push(hit);
  // Affordance ring: a camera-facing ring around the grip. It is a child of the tip group, so it follows the true
  // 3D position; it never changes the conductor itself.
  const ringMat = new THREE.MeshBasicMaterial({ color: '#6fb7d6', transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.172, 40), ringMat);
  ring.position.x = direction * 0.17;
  ring.renderOrder = 20;
  tipGroup.add(ring);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#6fb7d6', transparent: true, opacity: 0.0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), glowMat);
  glow.position.x = direction * 0.17;
  glow.renderOrder = 19;
  tipGroup.add(glow);
  tipRings.push({ ring, ringMat, glow, glowMat });
}
function rebuildCable(index: number) {
  const start = cableStartPositions[index];
  const end = tipGroups[index].position;
  const sag = Math.min(0.33, Math.abs(end.x - start.x) * 0.075);
  const control = new THREE.Vector3((start.x + end.x) / 2, (start.y + end.y) / 2 - sag, (start.z + end.z) / 2 - 0.23);
  const curve = new THREE.QuadraticBezierCurve3(start, control, end);
  const oldGeometry = cableMeshes[index].geometry;
  cableMeshes[index].geometry = new THREE.TubeGeometry(curve, 42, 0.052, 10, false);
  oldGeometry.dispose();
}

// Stylized spark particles and branching bolts; voltage scales appearance only.
const sparkPositions = new Float32Array(SPARK_MAX * 3);
const sparkVelocities: THREE.Vector3[] = [];
const sparkGeometry = new THREE.BufferGeometry();
sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
const sparkMaterial = new THREE.PointsMaterial({ color: '#fff3d5', size: 0.07, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
sparkPoints.frustumCulled = false;
scene.add(sparkPoints);
const boltGroup = new THREE.Group();
scene.add(boltGroup);
let sparkLife = 0;
let sparkIntensity = 1;
let sparkParticleCount = 96;
let sparkLifeMax = 0.24;
let lastSparkAt = 0;
function triggerSpark(center: THREE.Vector3) {
  // Not clamped to 1: above 220 V the spark/flame keeps growing (about 1.9x at 415 V).
  sparkIntensity = THREE.MathUtils.clamp(targetVoltage / SPARK_REF_VOLTAGE, 0.04, MAX_VOLTAGE / SPARK_REF_VOLTAGE);
  sparkParticleCount = Math.max(5, Math.min(SPARK_MAX, Math.round(96 * sparkIntensity)));
  sparkLifeMax = 0.2 + 0.1 * sparkIntensity;
  sparkLife = sparkLifeMax;
  lastSparkAt = performance.now();
  sparkGeometry.setDrawRange(0, sparkParticleCount);
  sparkMaterial.size = 0.02 + sparkIntensity * 0.055;
  for (let i = 0; i < SPARK_MAX; i++) {
    if (i < sparkParticleCount) {
      const spread = 0.035 + sparkIntensity * 0.17;
      sparkPositions[i * 3] = center.x + (Math.random() - 0.5) * spread;
      sparkPositions[i * 3 + 1] = center.y + (Math.random() - 0.5) * spread;
      sparkPositions[i * 3 + 2] = center.z + (Math.random() - 0.5) * spread * 0.5;
      sparkVelocities[i] = new THREE.Vector3(
        (Math.random() - 0.5) * (0.7 + sparkIntensity * 3.8),
        (Math.random() - 0.5) * (0.7 + sparkIntensity * 3.8),
        (Math.random() - 0.5) * (0.2 + sparkIntensity * 1.1),
      );
    } else {
      sparkPositions[i * 3] = center.x; sparkPositions[i * 3 + 1] = center.y; sparkPositions[i * 3 + 2] = center.z;
      sparkVelocities[i] = new THREE.Vector3();
    }
  }
  sparkGeometry.attributes.position.needsUpdate = true;
  sparkMaterial.opacity = Math.min(1, 0.28 + sparkIntensity * 0.72);
  while (boltGroup.children.length) {
    const child = boltGroup.children[0] as THREE.Line;
    boltGroup.remove(child); child.geometry.dispose();
    const m = child.material; if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m.dispose();
  }
  const tipA = exposedTipPosition(0);
  const tipB = exposedTipPosition(1);
  const palette = ['#fff5d9', '#bafaff', '#ffbd81', '#f6f8ff'];
  const boltCount = Math.max(2, Math.round(12 * Math.sqrt(sparkIntensity)));
  for (let b = 0; b < boltCount; b++) {
    const points: THREE.Vector3[] = [];
    const sections = 6 + Math.floor(Math.random() * 4);
    const branch = b > boltCount - 4;
    const startT = branch ? 0.22 + Math.random() * 0.5 : 0;
    const endT = branch ? Math.min(0.96, startT + 0.13 + Math.random() * 0.2) : 1;
    const offset = new THREE.Vector3((Math.random() - 0.5) * (0.12 + 0.34 * sparkIntensity), (Math.random() - 0.5) * (0.12 + 0.4 * sparkIntensity), 0.03 + Math.random() * 0.1 * sparkIntensity);
    for (let j = 0; j <= sections; j++) {
      const t = startT + (endT - startT) * j / sections;
      const p = tipA.clone().lerp(tipB, t);
      if (j !== 0 && j !== sections) {
        p.x += (Math.random() - 0.5) * (branch ? 0.06 : 0.07 + 0.12 * sparkIntensity);
        p.y += (Math.random() - 0.5) * (branch ? 0.06 : 0.07 + 0.18 * sparkIntensity);
        p.z += (Math.random() - 0.5) * (0.03 + 0.07 * sparkIntensity);
      }
      if (branch) p.add(offset.clone().multiplyScalar(Math.sin(Math.PI * j / sections)));
      points.push(p);
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: palette[b % palette.length], transparent: true, opacity: (b < 3 ? 1 : 0.66) * (0.3 + 0.7 * sparkIntensity), blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    boltGroup.add(line);
  }
}

// -----------------------------------------------------------------------------
// UI and interaction state
// -----------------------------------------------------------------------------
let isOn = false;
let sourceMode: SourceMode = 'AC';
let snap: Snapshot = engine.snapshot(); // single authoritative electrical state (see ./sim/engine.ts)
const OPEN_CONNECTION: Connection = { kind: 'open' };
const SHORT_CONNECTION: Connection = { kind: 'short' };
let attachedLoad: Connection | null = null; // optional engine-level load (see window.voltaLab)
let lastSyncKey = '';
function syncEngineInputs(contact: boolean) {
  const connection = contact ? SHORT_CONNECTION : attachedLoad ?? OPEN_CONNECTION;
  const key = `${isOn}|${sourceMode}|${targetVoltage}|${contact ? 's' : attachedLoad ? 'l' : 'o'}`;
  if (key === lastSyncKey) return;
  lastSyncKey = key;
  engine.setInputs({ powerOn: isOn, mode: sourceMode === 'AC' ? 'ac' : 'dc', setpointV: targetVoltage, connection });
}
let targetVoltage = 220;
let previousContact = false;
let activeTip = -1;
let activeDial = false;
let lastDialX = 0;
let detailView = false;
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.32);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const dragPoint = new THREE.Vector3();
function setMouse(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}
function setTip(index: number, x: number, y: number) {
  tipGroups[index].position.set(THREE.MathUtils.clamp(x, -3.45, 3.45), THREE.MathUtils.clamp(y, -1.09, 0.12), 1.32);
  rebuildCable(index);
}
function exposedTipPosition(index: number) {
  return tipGroups[index].position.clone().add(new THREE.Vector3(index === 0 ? 0.23 : -0.23, 0, 0));
}
function hasContact() { return exposedTipPosition(0).distanceTo(exposedTipPosition(1)) < 0.14; }

const powerBtn = $('powerBtn') as HTMLButtonElement;
const voltageSlider = $('voltageSlider') as HTMLInputElement;
const voltageValue = $('voltageValue');
const metricVoltage = $('metricVoltage');
const metricCurrent = $('metricCurrent');
const metricPower = $('metricPower');
const metricFrequency = $('metricFrequency');
const arcStatus = $('arcStatus');
const arcState = $('arcState');
const connectionPill = $('connectionPill');
const powerDescription = $('powerDescription');
const leadAState = $('leadAState');
const leadBState = $('leadBState');
const voltageBar = $('voltageBar') as HTMLElement;
const currentBar = $('currentBar') as HTMLElement;
const powerBar = $('powerBar') as HTMLElement;
const frequencyBar = $('frequencyBar') as HTMLElement;
const voltageUnit = $('voltageUnit');
const metricVoltageUnit = $('metricVoltageUnit');
const batteryText = $('batteryState');
const convInputText = $('convInput');
const convEffText = $('convEff');
const srStatus = $('srStatus');

function updateRangePaint() {
  voltageSlider.style.setProperty('--range-fill', `${(targetVoltage / MAX_VOLTAGE) * 100}%`);
}
function updatePhysicalDial() {
  dialNeedle.rotation.z = THREE.MathUtils.degToRad(145 - (targetVoltage / MAX_VOLTAGE) * 290);
}
function setVoltage(value: number) {
  targetVoltage = THREE.MathUtils.clamp(Math.round(value), 0, MAX_VOLTAGE);
  voltageSlider.value = String(targetVoltage);
  voltageValue.textContent = String(targetVoltage);
  updateRangePaint();
  updatePhysicalDial();
  document.querySelectorAll<HTMLButtonElement>('[data-voltage]').forEach((button) => {
    button.classList.toggle('preset-active', Number(button.dataset.voltage) === targetVoltage);
  });
}
function announce(message: string) { srStatus.textContent = message; }
const modeAcBtn = $('modeAcBtn') as HTMLButtonElement;
const modeDcBtn = $('modeDcBtn') as HTMLButtonElement;
const modeDesc = $('modeDesc');
function setMode(mode: SourceMode) {
  sourceMode = mode;
  modeLeverTarget = mode === 'AC' ? MODE_LEVER_ANGLE : -MODE_LEVER_ANGLE;
  modeAcMat.color.set(mode === 'AC' ? '#5cf2bf' : '#5d6a74');
  modeDcMat.color.set(mode === 'DC' ? '#5cf2bf' : '#5d6a74');
  voltageUnit.textContent = mode === 'AC' ? 'V AC RMS' : 'V DC';
  metricVoltageUnit.textContent = mode === 'AC' ? 'V RMS' : 'V DC';
  canvas.dataset.sourceMode = mode;
  for (const b of [modeAcBtn, modeDcBtn]) { const on = b.dataset.mode === mode; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  modeDesc.textContent = mode === 'AC' ? 'AC: single-phase, two-wire, 50 Hz' : 'DC: steady voltage, 0 Hz';
  announce(mode === 'AC' ? 'Source mode AC, single-phase two-wire, 50 hertz, voltage shown as RMS between the two leads.' : 'Source mode DC, steady voltage, frequency 0 hertz.');
}
function setPower(value: boolean) {
  isOn = value;
  powerBtn.setAttribute('aria-checked', String(isOn));
  powerBtn.classList.toggle('is-on', isOn);
  physicalPowerLedMat.color.set(isOn ? '#35d89d' : '#762e32');
  physicalPowerLedMat.emissive.set(isOn ? '#20e98a' : '#ff2638');
  physicalPowerLedMat.emissiveIntensity = isOn ? 1.5 : 0.45;
  rockerTarget = isOn ? -0.2 : 0.2; // top edge pressed in = ON (animated in the render loop)
  symbolOnMat.color.set(isOn ? '#5cf2bf' : '#7d8890');
  symbolOffMat.color.set(isOn ? '#56606a' : '#ff6f78');
  rockerMat.color.set(isOn ? '#174e3d' : '#242a2e');
  rockerMat.emissive.set(isOn ? '#1d9a6d' : '#000000');
  rockerMat.emissiveIntensity = isOn ? 0.35 : 0;
  if (!isOn) { arcStatus.classList.remove('active'); arcState.textContent = 'IDLE'; }
  announce(isOn ? 'Main power on.' : 'Main power off.');
}
function touchWires() {
  setTip(0, -0.23, -1.09);
  setTip(1, 0.23, -1.09);
  tipsAtRest = false;
  clearWireSelection();
}
// Rest (separated) position of the tips. On wide screens it is the original ±2.68; on narrow/portrait screens the visible
// half-width at the tips' depth is smaller, so the rest position is pulled in to keep BOTH tips on screen (otherwise a phone
// user could not reach them). The machine itself is untouched.
const TIP_REST_X = 2.68;
let tipRestX = TIP_REST_X;
let tipsAtRest = true;
function updateTipRestX() {
  const dist = camera.position.distanceTo(new THREE.Vector3(0, -1.09, 1.32)); // default camera → tip plane
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * dist;
  // Wide screens (aspect ≥ 1.45, where the original layout was tuned) keep the original position exactly.
  tipRestX = camera.aspect >= 1.45 ? TIP_REST_X : Math.min(TIP_REST_X, Math.max(0.9, halfWidth - 0.3));
}
function separateWires() {
  setTip(0, -tipRestX, -1.09);
  setTip(1, tipRestX, -1.09);
  tipsAtRest = true;
  clearWireSelection();
}
const viewPresetLabel = $('viewPresetLabel');
// The label names the CURRENT view (aria-pressed = close-up detail view); the accessible name says what a click does.
function paintViewButton() {
  const btn = $('explodeBtn');
  viewPresetLabel.textContent = detailView ? 'DETAIL VIEW' : 'WIDE VIEW';
  const tip = detailView ? 'Detail view. Click to return to the wide view.' : 'Wide view. Click to switch to the close-up detail view.';
  btn.setAttribute('aria-label', tip); btn.title = tip;
}
function resetCamera() {
  camera.position.copy(defaultCamera);
  controls.target.copy(defaultTarget);
  stopCameraMomentum();
  detailView = false;
  $('explodeBtn').classList.remove('active');
  $('explodeBtn').setAttribute('aria-pressed', 'false');
  paintViewButton();
}

// ---- Cable tips: hover / selected affordance and two-click connection -------------------------------------
const wireHint = $('wireHint');
const LEAD_NAME = ['Lead A', 'Lead B'] as const;
let selectedTip = -1;
let hoverTip = -1;
let hintTimer = 0;
function showWireHint(text: string, persistent: boolean) {
  wireHint.textContent = text;
  wireHint.classList.add('show');
  window.clearTimeout(hintTimer);
  if (!persistent) hintTimer = window.setTimeout(() => wireHint.classList.remove('show'), 2800);
  announce(text);
}
function hideWireHint() {
  window.clearTimeout(hintTimer);
  wireHint.classList.remove('show');
}
function clearWireSelection() {
  selectedTip = -1;
  canvas.dataset.wireSelected = '';
  hideWireHint(); // never leave "Lead A selected…" on screen when nothing is selected (T / S / buttons / connect / cancel)
}
function selectTip(i: number) {
  selectedTip = i;
  canvas.dataset.wireSelected = i === 0 ? 'A' : 'B';
  showWireHint(`${LEAD_NAME[i]} selected — click ${LEAD_NAME[1 - i]} to connect (click ${LEAD_NAME[i]} again to cancel)`, true);
}
/** A click (not a drag) on a tip: select, cancel, or connect to the other lead. */
function clickTip(i: number) {
  if (selectedTip < 0) selectTip(i);
  else if (selectedTip === i) { clearWireSelection(); showWireHint(`${LEAD_NAME[i]} deselected.`, false); }
  else { touchWires(); showWireHint('Leads connected — output terminals are shorted together.', false); }
}
const tmpColor = new THREE.Color();
function updateTipVisuals(elapsed: number) {
  for (let i = 0; i < 2; i++) {
    const v = tipRings[i];
    v.ring.quaternion.copy(camera.quaternion); v.glow.quaternion.copy(camera.quaternion); // always face the viewer
    const selected = selectedTip === i, hover = hoverTip === i || activeTip === i;
    const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * 2.4 + i * 1.7);
    // idle: a calm, always-visible ring (this is the touch-device cue); hover: brighter green; selected: amber + glow.
    tmpColor.set(selected ? '#ffc94d' : hover ? '#4be1ac' : '#6fb7d6');
    v.ringMat.color.copy(tmpColor); v.glowMat.color.copy(tmpColor);
    v.ringMat.opacity = selected ? 1 : hover ? 0.95 : 0.32 + 0.16 * pulse;
    v.glowMat.opacity = selected ? 0.34 + 0.16 * pulse : hover ? 0.2 : 0.05 * pulse;
    const scale = selected ? 1.18 + 0.06 * pulse : hover ? 1.1 : 1;
    v.ring.scale.setScalar(scale); v.glow.scale.setScalar(scale);
  }
}

// Click vs drag: a tip only starts to move after the pointer travels past a small threshold.
const DRAG_THRESHOLD_MOUSE = 6, DRAG_THRESHOLD_TOUCH = 10; // CSS px
let downX = 0, downY = 0, tipDragging = false, dragThreshold = DRAG_THRESHOLD_MOUSE;
const grabOffset = new THREE.Vector3();
function pickTip(): number {
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(tipTargets, false); // sorted nearest-first
  return hits.length ? Number(hits[0].object.userData.tipIndex) : -1;
}
function lockPointer(event: PointerEvent) {
  pointerLock = true; applyCameraControls();
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopImmediatePropagation(); // OrbitControls never sees a press that belongs to a machine control
}
canvas.addEventListener('pointerdown', (event) => {
  setMouse(event);
  const tip = pickTip();
  if (tip >= 0) {
    activeTip = tip; tipDragging = false; downX = event.clientX; downY = event.clientY;
    dragThreshold = event.pointerType === 'mouse' ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
    dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -tipGroups[activeTip].position.z);
    // remember where inside the tip the user grabbed it, so it does not jump to the pointer when the drag starts
    if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) grabOffset.copy(tipGroups[activeTip].position).sub(dragPoint); else grabOffset.set(0, 0, 0);
    lockPointer(event);
    return;
  }
  const controlsHits = raycaster.intersectObjects([powerButtonGroup, dialGroup, modeGroup], true);
  if (controlsHits.length) {
    let node: THREE.Object3D | null = controlsHits[0].object;
    while (node && !node.userData.control) node = node.parent;
    if (node?.userData.control === 'power') {
      lockPointer(event);
      setPower(!isOn);
      canvas.style.cursor = 'pointer';
      return;
    }
    if (node?.userData.control === 'mode') {
      lockPointer(event);
      setMode(sourceMode === 'AC' ? 'DC' : 'AC');
      canvas.style.cursor = 'pointer';
      return;
    }
    if (node?.userData.control === 'dial') {
      activeDial = true;
      lastDialX = event.clientX;
      lockPointer(event);
      canvas.style.cursor = 'ew-resize';
    }
  }
}, { capture: true });
canvas.addEventListener('pointermove', (event) => {
  if (activeTip >= 0) {
    if (!tipDragging && Math.hypot(event.clientX - downX, event.clientY - downY) > dragThreshold) { tipDragging = true; tipsAtRest = false; }
    if (tipDragging) {
      setMouse(event); raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) setTip(activeTip, dragPoint.x + grabOffset.x, dragPoint.y + grabOffset.y);
    }
    event.preventDefault();
    return;
  }
  if (activeDial) {
    setVoltage(targetVoltage + (event.clientX - lastDialX) * 1.25 * (MAX_VOLTAGE / 220));
    lastDialX = event.clientX;
    event.preventDefault();
    return;
  }
  setMouse(event);
  hoverTip = event.pointerType === 'mouse' || event.pointerType === 'pen' ? pickTip() : -1;
  const hits = hoverTip >= 0 || raycaster.intersectObjects([powerButtonGroup, dialGroup, modeGroup], true).length;
  canvas.style.cursor = hits ? 'pointer' : 'grab';
});
function endPointer(event?: PointerEvent) {
  if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  // A tip press that never became a drag is a click. A cancelled pointer is never a click.
  if (event?.type === 'pointerup' && activeTip >= 0 && !tipDragging) clickTip(activeTip);
  activeTip = -1; tipDragging = false;
  activeDial = false;
  pointerLock = false; applyCameraControls(); // only lifts the temporary lock; the selected camera mode is untouched
  canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { hoverTip = -1; if (activeTip < 0 && !activeDial) canvas.style.cursor = 'grab'; });
canvas.addEventListener('lostpointercapture', () => { if (activeTip >= 0 || activeDial) endPointer(); });

// Camera-mode button: FREE → LOCKED → ZOOM ONLY → ROTATE ONLY → FREE.
const cameraBtn = $('cameraModeBtn') as HTMLButtonElement;
const cameraBtnLabel = $('cameraModeLabel');
function paintCameraButton() {
  const next = CAMERA_CYCLE[(CAMERA_CYCLE.indexOf(cameraMode) + 1) % CAMERA_CYCLE.length];
  cameraBtnLabel.textContent = CAMERA_LABEL[cameraMode];
  cameraBtn.dataset.mode = cameraMode;
  const tip = `Camera control: ${CAMERA_LABEL[cameraMode]}. Click to switch to ${CAMERA_LABEL[next]}.`;
  cameraBtn.setAttribute('aria-label', tip); cameraBtn.title = tip;
  // Keep the Settings radio group (same setting) in step with the header button.
  document.querySelectorAll<HTMLButtonElement>('#cameraModeRadios [role="radio"]').forEach((r) => { const on = r.dataset.cameraMode === cameraMode; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; });
}
cameraBtn.addEventListener('click', () => {
  setCameraMode(CAMERA_CYCLE[(CAMERA_CYCLE.indexOf(cameraMode) + 1) % CAMERA_CYCLE.length]);
  paintCameraButton();
  announce(`Camera mode: ${CAMERA_LABEL[cameraMode]}.`);
});
applyCameraControls();
paintCameraButton();

powerBtn.addEventListener('click', () => setPower(!isOn));
// AC / DC radio group (synchronised with the 3D lever and the M key through setMode): click, or arrow keys with roving focus.
for (const b of [modeAcBtn, modeDcBtn]) b.addEventListener('click', () => setMode(b.dataset.mode === 'DC' ? 'DC' : 'AC'));
document.getElementById('modeAcBtn')!.parentElement!.addEventListener('keydown', (event) => {
  const key = (event as KeyboardEvent).key;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
  event.preventDefault(); event.stopPropagation();
  const next = key === 'Home' ? 'AC' : key === 'End' ? 'DC' : sourceMode === 'AC' ? 'DC' : 'AC'; // two options: any arrow toggles
  setMode(next); (next === 'AC' ? modeAcBtn : modeDcBtn).focus();
});
voltageSlider.addEventListener('input', () => setVoltage(Number(voltageSlider.value)));
document.querySelectorAll<HTMLButtonElement>('[data-voltage]').forEach((button) => button.addEventListener('click', () => setVoltage(Number(button.dataset.voltage))));
$('touchWiresBtn').addEventListener('click', touchWires);
$('separateWiresBtn').addEventListener('click', separateWires);
$('explodeBtn').addEventListener('click', () => {
  detailView = !detailView;
  $('explodeBtn').classList.toggle('active', detailView);
  $('explodeBtn').setAttribute('aria-pressed', String(detailView));
  paintViewButton();
  camera.position.copy(detailView ? detailCamera : defaultCamera);
  controls.target.copy(detailView ? detailTarget : defaultTarget);
  stopCameraMomentum(); // preset moves the camera on purpose; the selected camera mode is left untouched
});

// Controls panel: one drawer holds Controls, Settings, Help, Learning Hub and Limitations & Safety as tabs. The header Controls
// button, P and Escape open / close it; ? opens it on the Help tab. Focus moves in on open and back to the button on close.
const stageEl = document.querySelector('.stage') as HTMLElement;
const panelToggle = $('panelToggle') as HTMLButtonElement;
const controlPanel = $('controlPanel');
controlPanel.tabIndex = -1; // focusable by script only
const TAB_IDS = ['controls', 'settings', 'help', 'learn', 'safety'] as const;
type TabId = (typeof TAB_IDS)[number];
const tabButtons = TAB_IDS.map((id) => $(`tab-${id}`) as HTMLButtonElement);
const tabPanes = TAB_IDS.map((id) => $(`pane-${id}`));
let activeTab: TabId = 'controls';
function selectTab(id: TabId, focusTab = false) {
  activeTab = id;
  TAB_IDS.forEach((t, i) => {
    const on = t === id;
    tabButtons[i].setAttribute('aria-selected', String(on));
    tabButtons[i].tabIndex = on ? 0 : -1;
    tabPanes[i].hidden = !on;
  });
  if (focusTab) tabButtons[TAB_IDS.indexOf(id)].focus();
  ($('panelBody') as HTMLElement).scrollTop = 0;
}
tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => selectTab(TAB_IDS[i]));
  btn.addEventListener('keydown', (event) => {
    const n = TAB_IDS.length;
    const k = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
    event.preventDefault(); event.stopPropagation();
    const next = k === 'Home' ? 0 : k === 'End' ? n - 1 : (i + (k === 'ArrowRight' ? 1 : n - 1)) % n;
    selectTab(TAB_IDS[next], true);
  });
});
function isPanelOpen() { return stageEl.classList.contains('panel-open'); }
function setPanel(open: boolean, tab?: TabId) {
  const was = isPanelOpen();
  const focusWasInside = controlPanel.contains(document.activeElement);
  if (tab) selectTab(tab);
  stageEl.classList.toggle('panel-open', open);
  panelToggle.setAttribute('aria-expanded', String(open));
  panelToggle.setAttribute('aria-label', open ? 'Close controls panel' : 'Controls');
  if (open && (!was || tab)) tabButtons[TAB_IDS.indexOf(activeTab)].focus({ preventScroll: true }); // opening: focus lands on the active tab
  else if (!open && was && focusWasInside) panelToggle.focus({ preventScroll: true });              // closing: never leave focus in a hidden panel
}
panelToggle.addEventListener('click', () => setPanel(!isPanelOpen()));
$('panelClose').addEventListener('click', () => setPanel(false));
function openHelp() { setPanel(true, 'help'); }
$('resetCameraBtn').addEventListener('click', () => { resetCamera(); announce('Camera view reset.'); });
// Settings: camera behaviour radio group, the same setting as the header View button.
const cameraRadios = Array.from(document.querySelectorAll<HTMLButtonElement>('#cameraModeRadios [role="radio"]'));
cameraRadios.forEach((r, i) => {
  r.addEventListener('click', () => { setCameraMode(r.dataset.cameraMode as CameraMode); paintCameraButton(); announce(`Camera mode: ${CAMERA_LABEL[cameraMode]}.`); });
  r.addEventListener('keydown', (event) => {
    const k = event.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) return;
    event.preventDefault(); event.stopPropagation();
    const n = cameraRadios.length;
    const next = k === 'Home' ? 0 : k === 'End' ? n - 1 : (i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : n - 1)) % n;
    cameraRadios[next].focus(); cameraRadios[next].click();
  });
});
$('motionSetting').textContent = `Follows your system “reduce motion” setting. Currently: ${reduceMotion ? 'reduced motion is ON (no camera inertia or pulsing effects).' : 'normal motion.'}`;

// Keyboard shortcuts: Space power, arrows voltage, T connect tips, S separate,
// X emergency power-off, M switch AC/DC, R reset camera, P panel, ? help.
window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.matches('input,textarea,button,select') && (event.key === ' ' || event.key.startsWith('Arrow'))) return;
  if (event.code === 'Space') { event.preventDefault(); setPower(!isOn); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); setVoltage(targetVoltage + 5); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); setVoltage(targetVoltage - 5); }
  else if (event.key.toLowerCase() === 't') touchWires();
  else if (event.key.toLowerCase() === 's') separateWires();
  else if (event.key.toLowerCase() === 'x') setPower(false);
  else if (event.key.toLowerCase() === 'm') setMode(sourceMode === 'AC' ? 'DC' : 'AC');
  else if (event.key.toLowerCase() === 'r') resetCamera();
  else if (event.key.toLowerCase() === 'p') setPanel(!isPanelOpen());
  else if (event.key === 'Escape') setPanel(false);
  else if (event.key === '?') openHelp();
});

// The top bar can wrap (phones, large text, browser zoom), so its real height drives the layout instead of a fixed number.
const topbarEl = document.querySelector('.topbar') as HTMLElement;
function syncTopbarHeight() { document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(topbarEl.getBoundingClientRect().height)}px`); }
new ResizeObserver(syncTopbarHeight).observe(topbarEl);
syncTopbarHeight();
reducedMotionQuery.addEventListener('change', () => {
  reduceMotion = reducedMotionQuery.matches; canvas.dataset.reducedMotion = String(reduceMotion);
  controls.enableDamping = !reduceMotion;
});

function resize() {
  // Whole-pixel sizes avoid the sub-pixel resampling that makes a canvas look soft.
  const width = Math.max(1, Math.round(sceneWrap.clientWidth));
  const height = Math.max(1, Math.round(sceneWrap.clientHeight));
  renderer.setPixelRatio(renderPixelRatio());
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // Narrow viewports widen the vertical FOV so the machine + both cable tips stay in frame.
  const minAspect = 1.45;
  camera.fov = camera.aspect >= minAspect
    ? BASE_FOV
    : Math.min(66, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * minAspect / camera.aspect)));
  camera.updateProjectionMatrix();
  const before = tipRestX;
  updateTipRestX();
  if (tipsAtRest && Math.abs(tipRestX - before) > 1e-6) { setTip(0, -tipRestX, -1.09); setTip(1, tipRestX, -1.09); } // keep untouched tips on screen
}
new ResizeObserver(resize).observe(sceneWrap);
window.addEventListener('resize', resize);
resize();
setVoltage(220);
setPower(false);
setMode('AC');
srStatus.textContent = '';
rocker.rotation.x = rockerTarget;
modeLever.rotation.z = modeLeverTarget;
separateWires();
syncEngineInputs(hasContact());
snap = engine.snapshot();
paintMachineDisplay(snap);

const clock = new THREE.Clock();
let lastHudUpdate = 0;
// Browsers already pause requestAnimationFrame in a hidden tab; this resets the clock on return so the simulation never sees one long frame.
document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  const elapsed = clock.elapsedTime;
  controls.update();
  updateTipVisuals(elapsed);
  const ease = reduceMotion ? 1 : 0; // reduced motion: switches jump to their position instead of easing
  rocker.rotation.x += (rockerTarget - rocker.rotation.x) * Math.max(ease, Math.min(1, dt * 18)); // smooth rocker tilt
  modeLever.rotation.z += (modeLeverTarget - modeLever.rotation.z) * Math.max(ease, Math.min(1, dt * 16)); // smooth AC/DC lever

  // The object remains an enclosed machine; only studio lights and status LEDs move.
  frontFill.intensity = isOn ? 24 + (reduceMotion ? 0 : Math.sin(elapsed * 3.4) * 1.2) : 18;
  rimLight.intensity = isOn ? 20 + (reduceMotion ? 0 : Math.sin(elapsed * 2.7) * 1.4) : 13;
  const contact = hasContact();
  // Single authoritative electrical state: inputs go in, the deterministic engine advances in fixed
  // steps (decoupled from this render loop), and everything below only reads the Snapshot.
  const prevTrip = snap.protection.trip;
  syncEngineInputs(contact);
  engine.advance(dt);
  snap = engine.snapshot();
  if (snap.protection.trip && snap.protection.trip !== prevTrip) {
    announce(`Protective shutdown: ${snap.protection.message} Turn main power off and on to reset.`);
  }
  const dState = displayState(snap);
  const poweredContact = dState === 'short' && snap.output.currentA > 0;
  if (poweredContact && (!previousContact || performance.now() - lastSparkAt > 125)) {
    const mid = exposedTipPosition(0).lerp(exposedTipPosition(1), 0.5).add(new THREE.Vector3(0, 0, 0.08));
    triggerSpark(mid);
  }
  previousContact = contact;
  if (sparkLife > 0) {
    sparkLife -= dt;
    sparkMaterial.opacity = Math.max(0, sparkLife / sparkLifeMax) * (0.28 + sparkIntensity * 0.72);
    const attr = sparkGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sparkParticleCount; i++) {
      if (reduceMotion) break; // no drifting particles
      sparkPositions[i * 3] += sparkVelocities[i].x * dt;
      sparkPositions[i * 3 + 1] += sparkVelocities[i].y * dt;
      sparkPositions[i * 3 + 2] += sparkVelocities[i].z * dt;
      sparkVelocities[i].multiplyScalar(0.965);
    }
    attr.needsUpdate = true;
    for (const child of boltGroup.children) {
      const line = child as THREE.Line;
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(0, sparkLife / sparkLifeMax) * (0.3 + 0.7 * sparkIntensity) * (reduceMotion ? 0.8 : 0.62 + Math.random() * 0.38); // reduced motion: steady, no flicker (WCAG 2.3.1/2.3.3)
    }
  } else {
    sparkMaterial.opacity = 0;
    for (const child of boltGroup.children) (child as THREE.Line).visible = false;
  }

  if (elapsed - lastHudUpdate > 0.065) {
    lastHudUpdate = elapsed;
    const o = snap.output;
    powerDescription.textContent = outputStageDescription(snap); // from the snapshot, never from the UI's own switch state
    const voltage = o.voltage;
    metricVoltage.textContent = voltage.toFixed(1);
    metricCurrent.textContent = o.currentA.toFixed(2);
    metricPower.textContent = Math.round(o.pRealW).toLocaleString('en-US');
    metricFrequency.textContent = o.freqHz.toFixed(1);
    batteryText.textContent = `${(snap.battery.socFrac * 100).toFixed(1)} % · ${snap.battery.remainingWh.toFixed(0)} Wh`;
    const cv = snap.converter;
    convInputText.textContent = cv.vInV > 0 ? `${cv.iInA.toFixed(2)} A @ ${cv.vInV.toFixed(0)} V` : 'n/a';
    convEffText.textContent = cv.efficiency === null ? 'n/a' : `${(cv.efficiency * 100).toFixed(1)} % · ${cv.lossW.toFixed(1)} W loss`;
    voltageBar.style.width = `${voltage / MAX_VOLTAGE * 100}%`;
    currentBar.style.width = `${Math.min(1, o.currentA / CURRENT_LIMIT_A) * 100}%`;
    powerBar.style.width = `${Math.min(1, o.pRealW / (MAX_VOLTAGE * CURRENT_LIMIT_A)) * 100}%`;
    frequencyBar.style.width = `${o.freqHz / 50 * 100}%`;
    const protectedOff = dState === 'protected';
    const batteryEmpty = dState === 'empty';
    const loadOn = dState === 'load';
    connectionPill.classList.toggle('connected', contact || loadOn);
    connectionPill.innerHTML = `<i></i> ${protectedOff ? 'PROTECTED SHUTDOWN' : batteryEmpty ? 'BATTERY EMPTY' : contact ? (isOn ? 'SHORT CIRCUIT' : 'CONTACT / OFF') : attachedLoad ? 'LOAD CONNECTED' : 'OPEN CIRCUIT'}`;
    leadAState.textContent = batteryEmpty ? 'DISABLED' : protectedOff ? 'TRIPPED' : contact ? (isOn ? 'SHORT' : 'CONTACT') : isOn ? 'LIVE' : 'READY';
    leadBState.textContent = batteryEmpty ? 'DISABLED' : protectedOff ? 'TRIPPED' : contact ? (isOn ? 'SHORT' : 'CONTACT') : 'READY';
    leadAState.classList.toggle('hot', poweredContact); leadBState.classList.toggle('hot', poweredContact);
    arcStatus.classList.toggle('active', poweredContact);
    arcState.textContent = batteryEmpty ? 'EMPTY' : protectedOff ? 'TRIPPED' : poweredContact ? (o.currentLimited ? 'LIMITED' : 'ACTIVE') : contact ? 'NO POWER' : 'IDLE';
    const arcNote = $('arcStatus').querySelector('small')!;
    if (protectedOff) {
      arcNote.textContent = `${snap.protection.message ?? 'Protective shutdown latched.'} Turn MAIN POWER off, then on, to reset.`;
    } else if (batteryEmpty) {
      arcNote.textContent = snap.protection.message ?? 'Battery is empty.';
    } else if (poweredContact) {
      arcNote.textContent = `Short circuit · ${o.currentA.toFixed(1)} A ${o.kind === 'ac' ? 'RMS' : 'DC'}${o.currentLimited ? ` (current limit ${CURRENT_LIMIT_A} A; trips in ${TRIP_DELAY_S} s)` : ''} · spark is visual only`;
    } else {
      const lh = snap.load?.health;
      // Causal feedback for an attached load (state + which rating was exceeded); otherwise the usual hint.
      arcNote.textContent = lh && lh.state !== 'normal' && lh.reasons.length
        ? `Load ${lh.state.toUpperCase()} (${lh.tempC.toFixed(0)} °C): ${lh.reasons.join(' ')}`
        : contact ? 'Wire ends touch, but output is OFF.' : 'Bring both exposed cable ends together while power is ON.';
    }
    paintMachineDisplay(snap);
  }
  const pos = camera.position;
  canvas.dataset.cameraPosition = `${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}`; // diagnostic attribute for the browser check (the coordinate overlay was removed)
  canvas.dataset.cameraTarget = `${controls.target.x.toFixed(3)},${controls.target.y.toFixed(3)},${controls.target.z.toFixed(3)}`; // read-only view of the orbit target (used by the browser check)
  renderer.render(scene, camera);
}
animate();

// Engine-level load API (no new UI): lets a later application layer attach a load with an explicit
// electrical specification. Example fixtures are illustrative, not real products.
interface VoltaLabApi {
  engine: Engine;
  snapshot: () => Snapshot;
  attachLoad: (load: Load, reversed?: boolean) => void;
  detachLoad: () => void;
  loads: { resistiveLoad: typeof resistiveLoad; inductiveLoad: typeof inductiveLoad; capacitiveLoad: typeof capacitiveLoad; rlcLoad: typeof rlcLoad; acInputSupplyLoad: typeof acInputSupplyLoad; dcMotorLoad: typeof dcMotorLoad; dcModuleLoad: typeof dcModuleLoad };
}
(window as unknown as { voltaLab: VoltaLabApi }).voltaLab = {
  engine,
  snapshot: () => engine.snapshot(),
  // Validated at the API boundary: an invalid load throws a RangeError naming the parameter and is NOT attached.
  attachLoad: (load, reversed = false) => {
    validateLoad(load);
    if (typeof reversed !== 'boolean') throw new RangeError(`reversed must be a boolean; got ${String(reversed)}`);
    attachedLoad = { kind: 'load', load: deepFreeze(structuredClone(load)), reversed }; lastSyncKey = ''; // own frozen copy: later mutation of the caller's object cannot bypass validation
  },
  detachLoad: () => { attachedLoad = null; lastSyncKey = ''; },
  loads: { resistiveLoad, inductiveLoad, capacitiveLoad, rlcLoad, acInputSupplyLoad, dcMotorLoad, dcModuleLoad },
};
