# Volta Lab — Industrial Edition: Design Plan

## Product goal
Create a cinematic, interactive 3D lab centred on a real-world-looking enclosed electrical machine. The experience should look like a product on a workshop test bench, not a cutaway animation that explains electromagnetic generation.

## Visual specification
1. **Machine body:** matte-black/charcoal metal enclosure; believable box proportions; softened industrial edges; fasteners, seams, cooling louvers, carry handle, and rubber feet.
2. **Built-in display:** an inset screen mounted on the front fascia. It shows the simulator's voltage, current, frequency, and power state in a compact industrial UI.
3. **Physical controls:** front rocker switch and rotary voltage-level dial. They are interactive in the 3D model and synchronized with the software controls.
4. **Output connections:** two front-mounted terminals feed a red and a black thick insulated lead, each with a metallic exposed end. Cable ends can be dragged in 3D or moved with quick-action buttons.
5. **Scene:** dark product-studio / lab backdrop, restrained metallic highlights, soft shadows and a free-orbit camera. The object remains enclosed; internal generator parts are not shown.
6. **Supporting UI:** machine ON/OFF, 0–220 V level control, common voltage presets, live readouts, connection state, detail/wide view, reset camera, and concise keyboard help.
7. **Wire contact effect:** when powered wire tips touch, play a voltage-scaled, stylized spark. Separate tips or switch power off to stop the effect.

## Behaviour model
- OFF: displayed output reads zero.
- ON with separated wires: target voltage is displayed; illustrative current is zero.
- ON with wire tips touching: show a contact state and animated spark. The displayed current follows a capped demonstration rule, not a validated short-circuit calculation.
- Changing voltage updates the slider, physical dial position, machine screen, floating HUD, and visual spark intensity.

## Technical approach
- TypeScript and Vite for the application/runtime.
- Three.js + OrbitControls + RoundedBoxGeometry for the 3D object and camera.
- HTML CanvasTexture for the display and printed product labels.
- HTML/CSS for responsive lab controls, telemetry and status.
- No Ruby runtime is required for a browser-only front end. Additional languages should only be introduced when they solve a concrete architectural need.

## Scope exclusions
This build is not a real electrical simulator, electromagnetic solver, medical shock model, arc-flash calculator, chemistry simulator, or real power source. The display values and spark effects are explicitly illustrative. Do not use it to make real-world wiring, safety, or equipment-design decisions.

## Acceptance checklist
- [ ] Machine body reads visually as a closed industrial product, not exposed rotor/stator parts.
- [ ] The display is visibly mounted on the 3D machine.
- [ ] Clicking the physical 3D power rocker toggles output.
- [ ] Dragging the 3D dial changes the target voltage and visible readouts.
- [ ] Both realistic-looking leads can be dragged and reconnected.
- [ ] Contact while powered produces the stylized spark; OFF suppresses it.
- [ ] Camera orbit, zoom, detail framing and reset work.
- [ ] Production build and manual browser smoke test pass before declaring full verification.
