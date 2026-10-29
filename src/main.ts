import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('sceneCanvas') as HTMLCanvasElement;
const sceneWrap = $('sceneWrap');

// -----------------------------------------------------------------------------
// Volta Lab Industrial Edition. The 3D model is an enclosed consumer/workshop-
// style power unit. Telemetry and sparks are intentionally labelled simulation.
// This is not a validated electrical, arc, or human-shock model.
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.target.copy(defaultTarget);
controls.minDistance = 5.2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.82;
controls.update();

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

// Stage / studio floor.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#0a0d11', 0.2, 0.78));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.21;
floor.receiveShadow = true;
scene.add(floor);
const floorHalo = new THREE.Mesh(
  new THREE.CircleGeometry(3.7, 72),
  new THREE.MeshBasicMaterial({ color: '#193244', transparent: true, opacity: 0.13, depthWrite: false }),
);
floorHalo.rotation.x = -Math.PI / 2;
floorHalo.position.set(0, -1.195, -0.05);
scene.add(floorHalo);

// Real floor grid in 3D (replaces the old CSS overlay that sat on top of the
// canvas and drew lines across the machine). Fades out radially.
function makeFloorGridTexture() {
  const size = 2048, cell = 128;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const line = (step: number, width: number, alpha: number) => {
    ctx.strokeStyle = `rgba(160,182,196,${alpha})`; ctx.lineWidth = width; ctx.beginPath();
    for (let p = 0; p <= size; p += step) { ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.moveTo(0, p); ctx.lineTo(size, p); }
    ctx.stroke();
  };
  line(cell / 4, 1, 0.07);
  line(cell, 2, 0.22);
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, size, size);
  return sharpen(new THREE.CanvasTexture(c));
}
const floorGrid = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.MeshBasicMaterial({ map: makeFloorGridTexture(), transparent: true, depthWrite: false, toneMapped: false }),
);
floorGrid.rotation.x = -Math.PI / 2;
floorGrid.position.set(0, -1.203, 0);
scene.add(floorGrid);

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
  new THREE.MeshBasicMaterial({ map: makeLabelTexture('VOLTA LAB  /  V-220', 'INDUSTRIAL POWER UNIT'), transparent: true, toneMapped: false }),
);
brandLabel.position.set(-0.74, 0.655, 0.755);
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
function paintMachineDisplay(voltage: number, current: number, frequency: number, on: boolean, arc: boolean) {
  // Only re-upload the texture when something visible actually changed.
  const key = `${voltage.toFixed(1)}|${current.toFixed(2)}|${frequency.toFixed(1)}|${on}|${arc}`;
  if (key === lastDisplayKey) return;
  lastDisplayKey = key;

  const ctx = displayContext;
  const W = DISPLAY_W, H = DISPLAY_H;
  const accent = arc ? '#ffa56b' : on ? '#4be1ac' : '#5b7068';
  const bright = on ? '#c4ffec' : '#4d6a5f';
  const soft = on ? '#8fe6c6' : '#4d6a5f';
  const label = '#68a592';
  const power = voltage * current;

  ctx.setTransform(DISPLAY_SCALE, 0, 0, DISPLAY_SCALE, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#07130f'); bg.addColorStop(1, '#0a211a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Header bar: title + status chip.
  ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, W, 42);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = label; ctx.font = `500 18px ${MONO}`; ctx.fillText('AC OUTPUT  ·  V-220  ·  SIM', 24, 22);
  const status = arc ? 'ARC' : on ? 'RUN' : 'OFF';
  ctx.beginPath(); ctx.roundRect(574, 9, 122, 25, 12.5);
  ctx.fillStyle = on || arc ? `${accent}26` : 'rgba(255,255,255,0.05)'; ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(592, 21.5, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.font = `500 16px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(status, 647, 22); ctx.textAlign = 'left';

  // Main voltage read-out.
  ctx.textBaseline = 'alphabetic';
  const vText = voltage.toFixed(1);
  ctx.fillStyle = bright; ctx.font = `500 78px ${MONO}`; ctx.fillText(vText, 24, 114);
  const vw = ctx.measureText(vText).width;
  ctx.fillStyle = soft; ctx.font = `500 32px ${MONO}`; ctx.fillText('V', 24 + vw + 8, 114);

  // Output-level bar with ticks.
  const bx = 430, bw = 266;
  ctx.fillStyle = label; ctx.font = `500 14px ${MONO}`; ctx.fillText('OUTPUT LEVEL', bx, 72);
  ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.beginPath(); ctx.roundRect(bx, 84, bw, 10, 5); ctx.fill();
  const frac = Math.max(0, Math.min(1, voltage / 220));
  if (frac > 0.005) {
    const fill = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    fill.addColorStop(0, '#2fa77f'); fill.addColorStop(1, accent);
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(bx, 84, Math.max(10, bw * frac), 10, 5); ctx.fill();
  }
  ctx.fillStyle = 'rgba(160,220,196,0.35)';
  for (let i = 0; i <= 4; i++) ctx.fillRect(bx + (bw * i) / 4 - 0.5, 100, 1, 6);
  ctx.fillStyle = '#5a8574'; ctx.font = `500 13px ${MONO}`;
  ctx.textAlign = 'left'; ctx.fillText('0', bx, 122);
  ctx.textAlign = 'center'; ctx.fillText('110', bx + bw / 2, 122);
  ctx.textAlign = 'right'; ctx.fillText('220', bx + bw, 122); ctx.textAlign = 'left';

  // Secondary read-outs.
  ctx.fillStyle = 'rgba(120,200,170,0.16)'; ctx.fillRect(24, 130, W - 48, 1);
  const cells: Array<[string, string, string]> = [
    ['CURRENT', current.toFixed(2), 'A'],
    ['FREQUENCY', frequency.toFixed(1), 'Hz'],
    ['POWER', Math.round(power).toLocaleString('en-US'), 'W'],
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
const dialLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.1), new THREE.MeshBasicMaterial({ map: makeLabelTexture('OUTPUT LEVEL', '0 - 220 V AC', 5.2), transparent: true, toneMapped: false }));
dialLabel.position.set(0.81, -0.47, 0.795);
machine.add(dialLabel);

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
const tipPositions = [new THREE.Vector3(-2.68, -1.10, 1.32), new THREE.Vector3(2.68, -1.10, 1.32)];
const tipGroups: THREE.Group[] = [];
const cableMeshes: THREE.Mesh[] = [];
const tipTargets: THREE.Object3D[] = [];
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
  tipTargets.push(exposedMetal, endCap, tipHalo);
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
const sparkPositions = new Float32Array(96 * 3);
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
let lastSparkAt = 0;
function triggerSpark(center: THREE.Vector3) {
  sparkIntensity = THREE.MathUtils.clamp(targetVoltage / 220, 0.04, 1);
  sparkParticleCount = Math.max(5, Math.round(96 * sparkIntensity));
  sparkLife = 0.24;
  lastSparkAt = performance.now();
  sparkGeometry.setDrawRange(0, sparkParticleCount);
  sparkMaterial.size = 0.02 + sparkIntensity * 0.055;
  for (let i = 0; i < 96; i++) {
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
  sparkMaterial.opacity = 0.28 + sparkIntensity * 0.72;
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
  tipGroups[index].position.set(THREE.MathUtils.clamp(x, -3.45, 3.45), THREE.MathUtils.clamp(y, -1.16, 0.12), 1.32);
  rebuildCable(index);
}
function exposedTipPosition(index: number) {
  return tipGroups[index].position.clone().add(new THREE.Vector3(index === 0 ? 0.23 : -0.23, 0, 0));
}
function hasContact() { return exposedTipPosition(0).distanceTo(exposedTipPosition(1)) < 0.14; }

const powerBtn = $('powerBtn') as HTMLButtonElement;
const voltageSlider = $('voltageSlider') as HTMLInputElement;
const voltageValue = $('voltageValue');
const floatingVoltage = $('floatingVoltage');
const metricVoltage = $('metricVoltage');
const metricCurrent = $('metricCurrent');
const metricPower = $('metricPower');
const metricFrequency = $('metricFrequency');
const arcStatus = $('arcStatus');
const arcState = $('arcState');
const connectionPill = $('connectionPill');
const sceneStatusText = $('sceneStatusText');
const flowText = $('flowText');
const powerFlow = $('powerFlow');
const powerDescription = $('powerDescription');
const leadAState = $('leadAState');
const leadBState = $('leadBState');
const voltageBar = $('voltageBar') as HTMLElement;
const currentBar = $('currentBar') as HTMLElement;
const powerBar = $('powerBar') as HTMLElement;
const frequencyBar = $('frequencyBar') as HTMLElement;

function updateRangePaint() {
  voltageSlider.style.setProperty('--range-fill', `${(targetVoltage / 220) * 100}%`);
}
function updatePhysicalDial() {
  dialNeedle.rotation.z = THREE.MathUtils.degToRad(145 - (targetVoltage / 220) * 290);
}
function setVoltage(value: number) {
  targetVoltage = THREE.MathUtils.clamp(Math.round(value), 0, 220);
  voltageSlider.value = String(targetVoltage);
  voltageValue.textContent = String(targetVoltage);
  updateRangePaint();
  updatePhysicalDial();
  document.querySelectorAll<HTMLButtonElement>('[data-voltage]').forEach((button) => {
    button.classList.toggle('preset-active', Number(button.dataset.voltage) === targetVoltage);
  });
}
function setPower(value: boolean) {
  isOn = value;
  powerBtn.setAttribute('aria-checked', String(isOn));
  powerBtn.classList.toggle('is-on', isOn);
  powerDescription.textContent = isOn ? 'Output stage is running' : 'Output stage is disabled';
  flowText.textContent = isOn ? 'READY' : 'INACTIVE';
  powerFlow.classList.toggle('active', isOn);
  sceneStatusText.textContent = isOn ? 'OUTPUT ENABLED' : 'MACHINE STANDBY';
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
}
function touchWires() {
  setTip(0, -0.23, -1.12);
  setTip(1, 0.23, -1.12);
}
function separateWires() {
  setTip(0, -2.68, -1.10);
  setTip(1, 2.68, -1.10);
}
function resetCamera() {
  camera.position.copy(defaultCamera);
  controls.target.copy(defaultTarget);
  controls.update();
  detailView = false;
  $('explodeBtn').classList.remove('active');
  $('explodeBtn').setAttribute('aria-pressed', 'false');
  $('explodeBtn').innerHTML = 'DETAIL VIEW <span class="toggle-track"><i></i></span>';
}

canvas.addEventListener('pointerdown', (event) => {
  setMouse(event); raycaster.setFromCamera(mouse, camera);
  const wireHits = raycaster.intersectObjects(tipTargets, true);
  if (wireHits.length) {
    activeTip = Number(wireHits[0].object.userData.tipIndex);
    dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -tipGroups[activeTip].position.z);
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const controlsHits = raycaster.intersectObjects([powerButtonGroup, dialGroup], true);
  if (controlsHits.length) {
    let node: THREE.Object3D | null = controlsHits[0].object;
    while (node && !node.userData.control) node = node.parent;
    if (node?.userData.control === 'power') {
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      setPower(!isOn);
      canvas.style.cursor = 'pointer';
      event.preventDefault();
      return;
    }
    if (node?.userData.control === 'dial') {
      activeDial = true;
      lastDialX = event.clientX;
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'ew-resize';
      event.preventDefault();
    }
  }
});
canvas.addEventListener('pointermove', (event) => {
  if (activeTip >= 0) {
    setMouse(event); raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) setTip(activeTip, dragPoint.x, dragPoint.y);
    event.preventDefault();
    return;
  }
  if (activeDial) {
    setVoltage(targetVoltage + (event.clientX - lastDialX) * 1.25);
    lastDialX = event.clientX;
    event.preventDefault();
    return;
  }
  setMouse(event); raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(tipTargets, true).length || raycaster.intersectObjects([powerButtonGroup, dialGroup], true).length;
  canvas.style.cursor = hits ? 'pointer' : 'grab';
});
function endPointer(event?: PointerEvent) {
  if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  activeTip = -1;
  activeDial = false;
  controls.enabled = true;
  canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (activeTip < 0 && !activeDial) canvas.style.cursor = 'grab'; });

powerBtn.addEventListener('click', () => setPower(!isOn));
voltageSlider.addEventListener('input', () => setVoltage(Number(voltageSlider.value)));
document.querySelectorAll<HTMLButtonElement>('[data-voltage]').forEach((button) => button.addEventListener('click', () => setVoltage(Number(button.dataset.voltage))));
$('touchWiresBtn').addEventListener('click', touchWires);
$('separateWiresBtn').addEventListener('click', separateWires);
$('explodeBtn').addEventListener('click', () => {
  detailView = !detailView;
  $('explodeBtn').classList.toggle('active', detailView);
  $('explodeBtn').setAttribute('aria-pressed', String(detailView));
  $('explodeBtn').innerHTML = detailView ? 'WIDE VIEW <span class="toggle-track"><i></i></span>' : 'DETAIL VIEW <span class="toggle-track"><i></i></span>';
  camera.position.copy(detailView ? detailCamera : defaultCamera);
  controls.target.copy(detailView ? detailTarget : defaultTarget);
  controls.update();
});

// Control panel drawer: small corner button opens / closes it (also P / Escape).
const stageEl = document.querySelector('.stage') as HTMLElement;
const panelToggle = $('panelToggle') as HTMLButtonElement;
function setPanel(open: boolean) {
  stageEl.classList.toggle('panel-open', open);
  panelToggle.setAttribute('aria-expanded', String(open));
  panelToggle.setAttribute('aria-label', open ? 'Close control panel' : 'Open control panel');
}
panelToggle.addEventListener('click', () => setPanel(!stageEl.classList.contains('panel-open')));

// Keyboard shortcuts: Space power, arrows voltage, T connect tips, S separate,
// X emergency power-off, R reset camera.
window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.matches('input,textarea,button,select') && (event.key === ' ' || event.key.startsWith('Arrow'))) return;
  if (event.code === 'Space') { event.preventDefault(); setPower(!isOn); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); setVoltage(targetVoltage + 5); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); setVoltage(targetVoltage - 5); }
  else if (event.key.toLowerCase() === 't') touchWires();
  else if (event.key.toLowerCase() === 's') separateWires();
  else if (event.key.toLowerCase() === 'x') setPower(false);
  else if (event.key.toLowerCase() === 'r') resetCamera();
  else if (event.key.toLowerCase() === 'p') setPanel(!stageEl.classList.contains('panel-open'));
  else if (event.key === 'Escape') setPanel(false);
});

function resize() {
  // Whole-pixel sizes avoid the sub-pixel resampling that makes a canvas look soft.
  const width = Math.max(1, Math.round(sceneWrap.clientWidth));
  const height = Math.max(1, Math.round(sceneWrap.clientHeight));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // Narrow viewports widen the vertical FOV so the machine + both cable tips stay in frame.
  const minAspect = 1.45;
  camera.fov = camera.aspect >= minAspect
    ? BASE_FOV
    : Math.min(66, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * minAspect / camera.aspect)));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(sceneWrap);
window.addEventListener('resize', resize);
resize();
setVoltage(220);
setPower(false);
rocker.rotation.x = rockerTarget;
separateWires();
paintMachineDisplay(0, 0, 0, false, false);

const clock = new THREE.Clock();
let lastHudUpdate = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  const elapsed = clock.elapsedTime;
  controls.update();
  rocker.rotation.x += (rockerTarget - rocker.rotation.x) * Math.min(1, dt * 18); // smooth rocker tilt

  // The object remains an enclosed machine; only studio lights and status LEDs move.
  frontFill.intensity = isOn ? 24 + Math.sin(elapsed * 3.4) * 1.2 : 18;
  rimLight.intensity = isOn ? 20 + Math.sin(elapsed * 2.7) * 1.4 : 13;
  const contact = hasContact();
  const poweredContact = isOn && contact && targetVoltage > 0;
  if (poweredContact && (!previousContact || performance.now() - lastSparkAt > 125)) {
    const mid = exposedTipPosition(0).lerp(exposedTipPosition(1), 0.5).add(new THREE.Vector3(0, 0, 0.08));
    triggerSpark(mid);
  }
  previousContact = contact;
  if (sparkLife > 0) {
    sparkLife -= dt;
    sparkMaterial.opacity = Math.max(0, sparkLife / 0.24) * (0.28 + sparkIntensity * 0.72);
    const attr = sparkGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sparkParticleCount; i++) {
      sparkPositions[i * 3] += sparkVelocities[i].x * dt;
      sparkPositions[i * 3 + 1] += sparkVelocities[i].y * dt;
      sparkPositions[i * 3 + 2] += sparkVelocities[i].z * dt;
      sparkVelocities[i].multiplyScalar(0.965);
    }
    attr.needsUpdate = true;
    for (const child of boltGroup.children) {
      const line = child as THREE.Line;
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(0, sparkLife / 0.24) * (0.3 + 0.7 * sparkIntensity) * (0.62 + Math.random() * 0.38);
    }
  } else {
    sparkMaterial.opacity = 0;
    for (const child of boltGroup.children) (child as THREE.Line).visible = false;
  }

  const voltage = isOn ? targetVoltage : 0;
  // Illustrative readings only. The capped current is a display rule, not a real
  // source impedance calculation, arc calculation, or safe-current threshold.
  const current = poweredContact ? Math.min(voltage / 27.5, 8) : 0;
  const power = voltage * current;
  const frequency = isOn ? 50 : 0; // Pakistan mains frequency shown as a configurable-model default.

  if (elapsed - lastHudUpdate > 0.065) {
    lastHudUpdate = elapsed;
    metricVoltage.textContent = voltage.toFixed(1);
    metricCurrent.textContent = current.toFixed(2);
    metricPower.textContent = Math.round(power).toLocaleString('en-US');
    metricFrequency.textContent = frequency.toFixed(1);
    floatingVoltage.textContent = String(Math.round(voltage)).padStart(3, '0');
    voltageBar.style.width = `${voltage / 220 * 100}%`;
    currentBar.style.width = `${current / 8 * 100}%`;
    powerBar.style.width = `${power / 1760 * 100}%`;
    frequencyBar.style.width = `${frequency / 50 * 100}%`;
    connectionPill.classList.toggle('connected', contact);
    connectionPill.innerHTML = `<i></i> ${contact ? (isOn ? 'CONTACT / LIVE' : 'CONTACT / OFF') : 'OPEN CIRCUIT'}`;
    leadAState.textContent = contact ? 'CONTACT' : isOn ? 'LIVE' : 'READY';
    leadBState.textContent = contact ? 'CONTACT' : 'READY';
    leadAState.classList.toggle('hot', poweredContact); leadBState.classList.toggle('hot', poweredContact);
    arcStatus.classList.toggle('active', poweredContact);
    arcState.textContent = poweredContact ? 'ACTIVE' : contact ? 'NO POWER' : 'IDLE';
    if (poweredContact) {
      $('arcStatus').querySelector('small')!.textContent = `Visual spark · ${Math.round(voltage)} V setting · illustrative current model`;
      sceneStatusText.textContent = 'WIRE CONTACT / SPARK';
      flowText.textContent = 'CONTACT';
      powerFlow.classList.add('active');
    } else {
      $('arcStatus').querySelector('small')!.textContent = contact ? 'Wire ends touch, but output is OFF.' : 'Bring both exposed cable ends together while power is ON.';
      sceneStatusText.textContent = isOn ? 'OUTPUT ENABLED' : 'MACHINE STANDBY';
      flowText.textContent = isOn ? 'READY' : 'INACTIVE';
      powerFlow.classList.toggle('active', isOn);
    }
    paintMachineDisplay(voltage, current, frequency, isOn, poweredContact);
  }
  const pos = camera.position;
  $('coordX').textContent = pos.x.toFixed(2);
  $('coordY').textContent = pos.y.toFixed(2);
  $('coordZ').textContent = pos.z.toFixed(2);
  renderer.render(scene, camera);
}
animate();
