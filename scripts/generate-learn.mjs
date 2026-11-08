// Generates the static Learning Hub (public/learn/**), public/learn/learn.css and public/sitemap.xml.
// Run: node scripts/generate-learn.mjs   (no dependencies; output is committed so the Vite/Vercel build needs no extra step).
// Every statement about the model is taken from ELECTRICAL_MODEL.md and src/sim/*.ts. Numbers that are model assumptions are labelled as such.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://volta-lab-sable.vercel.app';
const MODIFIED = '2026-11-08';
const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap';

const T = {
  law: '<span class="tag tag-law"><span aria-hidden="true">◆</span> Physical law</span>',
  approx: '<span class="tag tag-approx"><span aria-hidden="true">≈</span> Engineering approximation</span>',
  assumed: '<span class="tag tag-assumed"><span aria-hidden="true">◇</span> Illustrative assumption</span>',
};

const pages = [
  {
    slug: 'dc-dc-converter-fundamentals',
    title: 'DC-DC Converter Fundamentals',
    description: 'How buck and boost DC-DC converters change a DC voltage level, what duty cycle means, and how Volta Lab models converter losses and limits. Educational, simulation only.',
    lead: 'A DC-DC converter changes one steady voltage into another. Volta Lab needs one because its battery pack sits at a fixed voltage while the output can be set anywhere from 0 to 415 V.',
    body: `
<h2>Switching, not dissipating</h2>
<p>A resistor can lower a voltage, but it turns the difference into heat. A switching converter instead chops the input on and off many thousands of times per second and uses an inductor and a capacitor to smooth the result. The fraction of each switching period during which the transistor is on is the <strong>duty cycle</strong>, <var>D</var>.</p>
<h2>The two ideal relations</h2>
<p>${T.law} For an ideal converter in continuous conduction mode (the inductor current never falls to zero), balancing the inductor's volt-seconds over one period gives:</p>
<ul>
<li><strong>Buck (step-down):</strong> <var>V<sub>out</sub> = D · V<sub>in</sub></var>, so <var>D = V<sub>out</sub> / V<sub>in</sub></var>.</li>
<li><strong>Boost (step-up):</strong> <var>V<sub>out</sub> = V<sub>in</sub> / (1 − D)</var>, so <var>D = 1 − V<sub>in</sub> / V<sub>out</sub></var>.</li>
</ul>
<p>Illustrative ideal (loss-free) arithmetic using the default pack's nominal voltage of about 372.6 V: a 220 V DC output needs a buck duty of about 220 / 372.6 ≈ 0.59, and a 415 V DC output needs a boost duty of about 1 − 372.6 / 415 ≈ 0.10. Real converters need slightly more because of losses.</p>
<h2>Losses and efficiency</h2>
<p>${T.approx} Volta Lab uses an <em>averaged</em> model: it follows the cycle-averaged behaviour and does not simulate individual switching edges. Input power is the output power plus three loss terms:</p>
<p class="formula"><var>P<sub>in</sub> = P<sub>out</sub> · (1 + k<sub>sw</sub>) + P<sub>fixed</sub> + R<sub>cond</sub> · I<sub>in</sub><sup>2</sup></var></p>
<p>The terms are a switching loss proportional to output power, a fixed control and gate-drive loss, and a conduction loss that grows with the square of the input current. Efficiency is then a <em>result</em>, <var>η = P<sub>out</sub> / P<sub>in</sub></var>, never a number typed in. Because the battery has internal resistance, the input current is found by solving a quadratic; if the discriminant is negative the source simply cannot deliver that power.</p>
<h2>Duty limits</h2>
<p>${T.assumed} The machine's converter is limited to a duty cycle of at most 0.9 (a model assumption). With a non-isolated boost, the maximum ideal gain is therefore 1 / (1 − 0.9) = 10, and a request beyond what the limit allows is reported as a duty-limit condition rather than silently shown as achieved.</p>
<h2>Ripple</h2>
<p>${T.approx} Inductor ripple uses the standard continuous-conduction formula <var>ΔI<sub>L</sub> = V<sub>in</sub> · D / (L · f<sub>sw</sub>)</var> for a boost stage. Only the formulas are used; no waveform is drawn.</p>
<h2>What Volta Lab does with it</h2>
<ul>
<li>In DC mode the machine compares the requested voltage with the battery's open-circuit voltage and treats the stage as a buck if the request is lower, a boost if it is higher.</li>
<li>The Controls panel shows the converter's input current, efficiency and loss, so you can watch loss rise with load.</li>
<li>The converter has a thermal model and shuts down above a shutdown temperature, restarting only after it cools below a lower restart temperature (hysteresis). Both temperatures are assumed values.</li>
</ul>
<h2>What it does not do</h2>
<p>It does not model discontinuous conduction, individual transistor switching, electromagnetic interference, or any specific commercial converter. All loss coefficients, the switching frequency (50 kHz), the inductor and capacitor values are illustrative assumptions, not datasheet values.</p>`,
  },
  {
    slug: 'single-phase-h-bridge-inverter',
    title: 'Single-Phase H-Bridge Inverter',
    description: 'How a full H-bridge turns a DC link into single-phase AC with sine-PWM, and how Volta Lab models modulation limits, losses and the two-wire output. Simulation only.',
    lead: 'An inverter turns direct current into alternating current. In AC mode, Volta Lab sends the DC-DC stage\'s output through an H-bridge to make a single-phase, two-wire AC output.',
    body: `
<h2>Four switches in an H</h2>
<p>A full bridge has two switches on each side of the load. Closing one diagonal pair drives current through the load in one direction; closing the other pair reverses it. Switching between the pairs fast enough, and varying how long each is on, lets the average output follow a sine wave. This is <strong>sine-PWM</strong> (pulse-width modulation).</p>
<h2>Modulation index and the DC link</h2>
<p>${T.approx} For a single-phase full bridge in its linear range, the peak output voltage is the modulation index <var>m</var> times the DC-link voltage: <var>V<sub>ac,pk</sub> = m · V<sub>link</sub></var>, and the RMS value is <var>V<sub>ac,rms</sub> = V<sub>ac,pk</sub> / √2</var>.</p>
<p>${T.assumed} The model limits <var>m</var> to 0.95. To deliver the 415 V RMS maximum, the peak is √2 × 415 ≈ 586.9 V, so the DC link must be at least about 586.9 / 0.95 ≈ 617.8 V. The model allows a link between 60 V and 700 V (assumed limits). If the link cannot reach what the requested AC voltage needs, the converter reports a modulation limit instead of pretending.</p>
<h2>Real power comes from the DC side</h2>
<p>${T.law} Only real power (the part that does work, <var>P = V<sub>rms</sub> · I<sub>rms</sub> · cos φ</var>) must be supplied by the DC link. Reactive power circulates between the load and the bridge without being drawn from the battery. Volta Lab books link power as:</p>
<p class="formula"><var>P<sub>link</sub> = P<sub>out,real</sub> + P<sub>fixed</sub> + k<sub>sw</sub> · S<sub>out</sub> + R<sub>bridge</sub> · I<sub>rms</sub><sup>2</sup></var></p>
<p>${T.assumed} The bridge's fixed loss (3 W), switching-loss fraction (1.5 % of apparent power) and resistance (0.08 Ω) are illustrative numbers. All inverter losses are also supplied through the DC-DC stage, which has its own losses.</p>
<h2>Single-phase, two-wire</h2>
<p>The machine has two output leads, Lead A and Lead B. The AC set-point is the RMS voltage <em>between those two leads</em>. It is not a three-phase line-to-line voltage, and 415 V is just the top of the machine's range, not a statement about household supply.</p>
<h2>What Volta Lab does with it</h2>
<ul>
<li>With the AC/DC switch on AC the chain is battery → DC-DC stage → DC link → H-bridge → output; on DC the bridge is bypassed.</li>
<li>The default output frequency is 50 Hz (an assumed default; the equations support others).</li>
<li>The output current limit is 10 A RMS, with a protective trip described in <a href="/learn/model-limitations-and-safety/">Model limitations and safety</a>.</li>
</ul>
<h2>What it does not do</h2>
<p>The model assumes an ideal, perfectly filtered sine wave: no harmonic distortion, no dead-time effects, no switching waveforms. There is no grid connection, no synchronisation to a grid, no anti-islanding behaviour, and no three-phase output.</p>`,
  },
  {
    slug: 'battery-equivalent-circuit-model',
    title: 'Battery Equivalent-Circuit Model',
    description: 'How a Thevenin 1-RC equivalent circuit represents a battery pack, how state of charge is counted, and which Volta Lab battery values are assumptions. Simulation only.',
    lead: 'Volta Lab does not simulate battery chemistry. It uses a small electrical circuit that behaves like a battery: a voltage source, a resistor and one resistor-capacitor pair.',
    body: `
<h2>The circuit</h2>
<p>${T.approx} This is a first-order Thevenin (1-RC) equivalent circuit. The terminal voltage while discharging at current <var>I</var> is:</p>
<p class="formula"><var>V<sub>t</sub> = OCV(SOC, T) − I · R<sub>0</sub> − V<sub>1</sub></var></p>
<ul>
<li><var>OCV</var> is the open-circuit voltage, which depends on state of charge and temperature.</li>
<li><var>R<sub>0</sub></var> is the instantaneous series resistance: the immediate voltage sag when current starts.</li>
<li><var>V<sub>1</sub></var> is the voltage across a resistor-capacitor pair <var>R<sub>1</sub>, C<sub>1</sub></var>. It follows <var>dV<sub>1</sub>/dt = (I · R<sub>1</sub> − V<sub>1</sub>) / (R<sub>1</sub> · C<sub>1</sub>)</var>, so the sag builds up and relaxes over seconds rather than instantly. Volta Lab advances it with an exact exponential step, which stays stable at any step size.</li>
</ul>
<h2>Counting charge</h2>
<p>${T.law} State of charge is tracked by Coulomb counting: remove <var>I · Δt</var> of charge each step and divide by the capacity. If the remaining charge would go below zero, delivery is truncated, so an empty battery gives nothing and never creates energy.</p>
<h2>From cell to pack</h2>
<p>${T.law} Cells in series add voltage and cells in parallel add capacity: <var>V<sub>pack</sub> = N<sub>s</sub> · V<sub>cell</sub></var>, <var>Ah = N<sub>p</sub> · Ah<sub>cell</sub></var>, <var>R<sub>pack</sub> = N<sub>s</sub> · R<sub>cell</sub> / N<sub>p</sub></var>.</p>
<p>${T.assumed} The default machine pack is 100 lithium-ion cells in series by 2 in parallel, 5 Ah per cell. That gives 10 Ah, about 372.6 V nominal and about 3.73 kWh nominal, starting at 90 % state of charge. This is an illustrative pack, not a commercial product.</p>
<h2>Heat and protection</h2>
<p>${T.approx} Battery heating uses a lumped thermal model (<var>C<sub>th</sub> · dT/dt</var> equals heat generated minus heat lost to ambient). The model enforces a low-voltage cutoff, an empty-battery state, an over-discharge current limit and an over-temperature limit, each of which latches a protective shutdown.</p>
<h2>Where the numbers come from</h2>
<p>The shape of the open-circuit-voltage curve, the cutoff voltages and the coulombic efficiency are literature-typical values. The resistances, the time constant, their dependence on charge and temperature, and the thermal values are <em>assumed</em> by the author. <strong>No battery parameter in Volta Lab is a manufacturer datasheet value or a measurement.</strong></p>
<h2>What it does not do</h2>
<p>There is no charging feature, no ageing or capacity fade, no thermal runaway, and no cell-to-cell imbalance. A 12 V lead-acid profile exists only inside the test suite to check the maths; the machine itself always uses the lithium-ion pack above.</p>`,
  },
  {
    slug: 'ac-vs-dc-output',
    title: 'AC vs DC Output',
    description: 'The difference between DC and single-phase AC output, RMS and peak voltage, and what the AC/DC selector changes inside Volta Lab. Educational, simulation only.',
    lead: 'Direct current (DC) keeps one polarity and, in the ideal case, a constant value. Alternating current (AC) reverses direction many times per second. Volta Lab can produce either.',
    body: `
<h2>DC</h2>
<p>A DC source holds a steady voltage between its two terminals. A battery is naturally DC. In Volta Lab's DC mode the output is the DC-DC stage's output, with a displayed frequency of 0 Hz.</p>
<h2>AC, peak and RMS</h2>
<p>${T.law} A sinusoidal AC voltage is <var>v(t) = √2 · V<sub>rms</sub> · sin(2π f t)</var>. Its peak is <var>V<sub>pk</sub> = √2 · V<sub>rms</sub></var>, and its period is <var>T = 1 / f</var>. The RMS value is the DC voltage that would heat a resistor equally, which is why AC voltages are normally quoted in RMS.</p>
<table>
<caption>Peak voltage for example RMS settings (ideal sine wave)</caption>
<thead><tr><th scope="col">RMS voltage</th><th scope="col">Peak voltage</th><th scope="col">Peak-to-peak</th></tr></thead>
<tbody>
<tr><td>110 V</td><td>155.6 V</td><td>311.1 V</td></tr>
<tr><td>220 V</td><td>311.1 V</td><td>622.3 V</td></tr>
<tr><td>415 V</td><td>586.9 V</td><td>1173.8 V</td></tr>
</tbody>
</table>
<p>At the default 50 Hz, one cycle takes 20 ms.</p>
<h2>Single-phase, two-wire</h2>
<p>Volta Lab's AC output has two conductors, so it is single-phase and two-wire. The displayed voltage is the RMS voltage between Lead A and Lead B. It is not a three-phase line-to-line value, and the machine does not model any mains supply.</p>
<h2>What the AC/DC selector does</h2>
<p>${T.approx} The selector chooses which <em>chain</em> is active; it does not convert anything by itself.</p>
<ul>
<li><strong>DC:</strong> battery → DC-DC stage → output terminals.</li>
<li><strong>AC:</strong> battery → DC-DC stage → DC link → H-bridge inverter → output terminals.</li>
</ul>
<p>Switching mode re-solves the circuit and clears timers that belonged to the previous mode. It cannot create energy: only the solved currents change, and the energy ledger still has to balance. See <a href="/learn/single-phase-h-bridge-inverter/">Single-phase H-bridge inverter</a> and <a href="/learn/dc-dc-converter-fundamentals/">DC-DC converter fundamentals</a>.</p>
<h2>Power</h2>
<p>${T.law} For AC the real power is <var>P = V<sub>rms</sub> · I<sub>rms</sub> · cos φ</var>, apparent power is <var>S = V<sub>rms</sub> · I<sub>rms</sub></var>, and the power factor is <var>P / S</var>. For a purely resistive load, φ = 0 and the power factor is 1. For DC, power is simply <var>V · I</var>.</p>
<h2>What it does not do</h2>
<p>There is no rectification stage in the machine itself. A bridge-rectifier model exists only inside the optional "AC-input supply" load type, which represents a device that rectifies the AC it receives.</p>`,
  },
  {
    slug: 'model-limitations-and-safety',
    title: 'Model Limitations and Safety',
    description: 'What Volta Lab simulates and what it does not: parameter sources, the short-circuit fault test, protection behaviour, and why the simulator must not guide real wiring. Simulation only.',
    lead: 'Volta Lab is a teaching tool. It runs entirely in your browser and cannot generate, measure or deliver real electricity. Please read this page before you trust any number it shows.',
    body: `
<h2>Simulation only</h2>
<p>Every voltage, current, power and temperature on screen is computed by a software model. Nothing is measured from hardware, and the simulator cannot power an LED or any real device. Do not use it to make decisions about real wiring, protection or equipment design.</p>
<h2>The cable-contact test is a fault</h2>
<p>Touching the two cable ends together while the power is on simulates a <strong>terminal short circuit</strong>. That is a fault condition, not how a lamp or appliance is connected. To model a normal load you attach a load across the leads instead.</p>
<ul>
<li>${T.assumed} The contact between the leads has a resistance of 0.05 Ω.</li>
<li>${T.assumed} The converter limits the output current to 10 A. If it stays at that limit for 2 seconds, the machine trips and latches off.</li>
<li>A latched trip is reset by switching main power off and on again.</li>
<li>The spark you see is a visual effect only; it is not a calculation of a real arc.</li>
</ul>
<h2>Other protections modelled</h2>
<p>The battery model has a low-voltage cutoff, an empty state, an over-discharge current limit and an over-temperature limit. The converter has thermal shutdown with a restart temperature below the shutdown temperature. Attached loads move through normal, warning, overloaded, overheating, protection and damaged states, judged only against ratings the load actually specifies.</p>
<h2>How trustworthy is each number?</h2>
<table>
<caption>Where Volta Lab's values come from</caption>
<thead><tr><th scope="col">Kind</th><th scope="col">Examples</th></tr></thead>
<tbody>
<tr><th scope="row">${T.law}</th><td>V<sub>pk</sub> = √2 · V<sub>rms</sub>; series and parallel rules; Coulomb counting; P = V · I · cos φ</td></tr>
<tr><th scope="row">${T.approx}</th><td>The 1-RC battery structure; averaged converter and inverter models; continuous-conduction duty formulas</td></tr>
<tr><th scope="row">${T.assumed}</th><td>Internal resistances, loss coefficients, the default pack, the 10 A limit, the 2 s trip delay, temperatures</td></tr>
</tbody>
</table>
<p>No parameter in the project is taken from a manufacturer datasheet or from a measurement.</p>
<h2>What is not simulated</h2>
<ul>
<li>Solar panels, maximum-power-point tracking or any solar charger.</li>
<li>Mains supply, grid connection or grid synchronisation.</li>
<li>Three-phase systems.</li>
<li>Battery charging, ageing or thermal runaway.</li>
<li>Individual switching waveforms, harmonics or electromagnetic interference.</li>
<li>Real electric arcs or the effects of electric shock on a person.</li>
</ul>
<h2>Real-world safety</h2>
<p>Mains-level voltage can kill. Real arc and shock hazards depend on the source's impedance, the contact geometry, insulation, the environment and the exposure, none of which this model represents. Never copy wire-touching or sparking experiments with a real supply. Work on real electrical equipment only if you are qualified and follow the applicable standards and local regulations.</p>
<p>Return to the <a href="/">simulator</a> or the <a href="/learn/">Learning Hub</a>.</p>`,
  },
];

const css = readFileSync(join(ROOT, 'src/tokens.css'), 'utf8') + `
/* ==========================================================================
   Learning Hub layout (generated by scripts/generate-learn.mjs; do not edit by hand)
   ========================================================================== */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text-primary); font: var(--fs-base)/1.65 var(--font-ui); }
a { color: var(--primary); text-underline-offset: 3px; }
a:hover { color: var(--focus); }
a:focus-visible, summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.skip-link { position: absolute; left: 12px; top: -64px; z-index: 10; padding: 12px 16px; background: var(--surface-raised); color: var(--text-primary); border: 2px solid var(--focus); border-radius: var(--radius-sm); }
.skip-link:focus { top: 12px; }
.site-header { border-bottom: 1px solid var(--border); background: var(--surface); }
.site-header-inner { max-width: 1040px; margin: 0 auto; padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.site-brand { display: inline-flex; align-items: center; gap: 10px; min-height: var(--target); color: var(--text-primary); font-weight: 700; font-size: var(--fs-h3); text-decoration: none; }
.site-brand img { width: 32px; height: 32px; }
.site-nav { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.site-nav a { display: inline-flex; align-items: center; min-height: var(--target); padding: 0 12px; border-radius: var(--radius-sm); color: var(--text-secondary); text-decoration: none; font-weight: 500; font-size: var(--fs-body); }
.site-nav a:hover, .site-nav a[aria-current="page"] { color: var(--text-primary); background: rgba(166, 180, 194, 0.1); }
main { max-width: 760px; margin: 0 auto; padding: 24px max(16px, env(safe-area-inset-right)) 56px max(16px, env(safe-area-inset-left)); }
.crumbs { font-size: var(--fs-small); color: var(--text-secondary); margin: 0 0 12px; }
.crumbs a { color: var(--text-secondary); }
h1 { font-size: clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem); line-height: 1.2; margin: 0 0 12px; letter-spacing: -0.01em; }
h2 { font-size: var(--fs-h2); line-height: 1.3; margin: 36px 0 8px; }
h3 { font-size: var(--fs-h3); margin: 24px 0 6px; }
p, li { max-width: 68ch; }
.lead { font-size: 1.125rem; color: var(--text-secondary); margin: 0 0 8px; }
var { font-family: var(--font-mono); font-style: normal; font-size: 0.94em; color: #cfe9f7; }
.formula { padding: 12px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow-x: auto; }
.sim-note { margin: 20px 0; padding: 12px 16px; border: 1px solid var(--warning); border-radius: var(--radius-sm); background: rgba(255, 195, 107, 0.07); }
.sim-note strong { color: var(--warning); }
.tag { display: inline-block; padding: 1px 8px; border: 1px solid currentColor; border-radius: 999px; font-size: var(--fs-meta); font-weight: 600; line-height: 1.6; white-space: nowrap; }
.tag-law { color: var(--success); }
.tag-approx { color: var(--primary); }
.tag-assumed { color: var(--warning); }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: var(--fs-body); }
caption { text-align: left; font-weight: 600; padding-bottom: 8px; color: var(--text-secondary); }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border: 1px solid var(--border); }
thead th { background: var(--surface-raised); }
.cards { list-style: none; margin: 24px 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
.cards li { max-width: none; }
.cards a { display: block; height: 100%; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text-primary); text-decoration: none; }
.cards a:hover { border-color: var(--primary); }
.cards strong { display: block; margin-bottom: 4px; color: var(--primary); }
.cards span { font-size: var(--fs-body); color: var(--text-secondary); }
.pager { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); }
.pager a { display: inline-flex; align-items: center; min-height: var(--target); }
.cta { display: inline-flex; align-items: center; min-height: var(--target); padding: 0 20px; border-radius: var(--radius); background: var(--primary); color: #04131c; font-weight: 700; text-decoration: none; }
.cta:hover { background: var(--focus); color: #04131c; }
footer { max-width: 760px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-right)) 32px max(16px, env(safe-area-inset-left)); color: var(--text-secondary); font-size: var(--fs-small); }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;

const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

function shell({ path, title, description, h1, lead, body, crumbs, prev, next, article }) {
  const url = ORIGIN + path;
  const fullTitle = `${title} | Volta Lab`;
  const crumbLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: ORIGIN + c.href })),
  };
  const articleLd = article ? {
    '@context': 'https://schema.org', '@type': 'TechArticle', headline: title, description, url, inLanguage: 'en',
    dateModified: MODIFIED, isPartOf: { '@type': 'WebSite', name: 'Volta Lab', url: ORIGIN + '/' },
  } : null;
  const nav = (href, text) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${text}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#070b12">
<meta property="og:type" content="${article ? 'article' : 'website'}">
<meta property="og:site_name" content="Volta Lab">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Volta Lab logo and the text Interactive 3D Power Electronics Simulator">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${fullTitle}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${ORIGIN}/og-image.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/learn/learn.css">
${jsonLd(crumbLd)}
${articleLd ? jsonLd(articleLd) : ''}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="site-header-inner">
<a class="site-brand" href="/"><img src="/favicon.svg" alt="" width="32" height="32">Volta Lab</a>
<nav class="site-nav" aria-label="Primary">${nav('/', 'Simulator')}${nav('/learn/', 'Learning Hub')}${nav('/learn/model-limitations-and-safety/', 'Limitations &amp; safety')}</nav>
</div></header>
<main id="main">
<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${c.href}">${c.name}</a> / ` : `<span aria-current="page">${c.name}</span>`)).join('')}</nav>
<h1>${h1}</h1>
<p class="lead">${lead}</p>
<p class="sim-note"><strong>Simulation only.</strong> This page explains a software model. It is educational material, not engineering or safety advice.</p>
${body}
${prev || next ? `<nav class="pager" aria-label="More lessons">${prev ? `<a href="${prev.href}" rel="prev">← ${prev.title}</a>` : '<span></span>'}${next ? `<a href="${next.href}" rel="next">${next.title} →</a>` : '<span></span>'}</nav>` : ''}
</main>
<footer><p>Volta Lab is an educational simulator. <a href="/">Open the 3D simulator</a> · <a href="/learn/">Learning Hub</a></p></footer>
</body>
</html>
`;
}

const write = (rel, text) => { const f = join(ROOT, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };

write('public/learn/learn.css', css);

const hubBody = `
<h2>Five short lessons</h2>
<p>Each lesson explains one block of the simulator and is based on how it is actually implemented. Every statement is tagged so you can tell what kind of claim it is:</p>
<ul>
<li>${T.law}: established physics that does not depend on this project.</li>
<li>${T.approx}: a standard simplification, valid only within stated limits.</li>
<li>${T.assumed}: a number or choice picked by the author to make the demonstration work, not a real product's value.</li>
</ul>
<ul class="cards">
${pages.map((p) => `<li><a href="/learn/${p.slug}/"><strong>${p.title}</strong><span>${p.lead}</span></a></li>`).join('\n')}
</ul>
<p><a class="cta" href="/">Open the 3D simulator</a></p>
<h2>What Volta Lab is</h2>
<p>Volta Lab is a browser-based 3D simulation of a battery, a DC-DC converter and a single-phase inverter feeding two output cables. You can switch between AC and DC, set the output between 0 and 415 V, bring the cable ends together to see a simulated fault, and read live telemetry. It does not simulate solar panels, grid connection or three-phase systems, and it never produces real electricity.</p>`;

const hubPath = '/learn/';
write('public/learn/index.html', shell({
  path: hubPath, title: 'Learning Hub: Power Electronics Basics',
  description: 'Short, original lessons on DC-DC converters, single-phase H-bridge inverters, battery equivalent circuits and AC versus DC output, based on the Volta Lab simulator. Simulation only.',
  h1: 'Learning Hub', lead: 'Plain-language lessons on the electronics inside the Volta Lab simulator, with clear labels for what is physics, what is approximation and what is assumption.',
  body: hubBody, crumbs: [{ name: 'Volta Lab', href: '/' }, { name: 'Learning Hub', href: hubPath }], article: false,
}));

pages.forEach((p, i) => {
  const path = `/learn/${p.slug}/`;
  const prev = i > 0 ? { href: `/learn/${pages[i - 1].slug}/`, title: pages[i - 1].title } : { href: hubPath, title: 'Learning Hub' };
  const next = i < pages.length - 1 ? { href: `/learn/${pages[i + 1].slug}/`, title: pages[i + 1].title } : null;
  write(`public/learn${path.slice('/learn'.length)}index.html`, shell({
    path, title: p.title, description: p.description, h1: p.title, lead: p.lead, body: p.body,
    crumbs: [{ name: 'Volta Lab', href: '/' }, { name: 'Learning Hub', href: hubPath }, { name: p.title, href: path }], prev, next, article: true,
  }));
});

const urls = ['/', hubPath, ...pages.map((p) => `/learn/${p.slug}/`)];
write('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${MODIFIED}</lastmod></url>`).join('\n')}\n</urlset>\n`);
write('public/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
console.log(`generated ${pages.length + 1} pages, learn.css, sitemap.xml (${urls.length} URLs), robots.txt`);
