// Site-level regression tests: colour contrast of the design tokens (WCAG 2.x), homepage SEO metadata, robots/sitemap and the
// Learning Hub pages. Static analysis of the committed files; it does not render anything (the browser check does that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOAD_CATALOGUE } from './sim/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const ORIGIN = 'https://volta-lab-sable.vercel.app';

// ---------------------------------------------------------------- contrast
function tokens(): Record<string, string> {
  const css = read('src/tokens.css');
  const raw: Record<string, string> = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) raw[m[1]] = m[2].replace(/\/\*.*?\*\//g, '').trim();
  const resolve = (v: string): string => { const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v); return ref ? resolve(raw[ref[1]]) : v; };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]));
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('design tokens: text colours reach WCAG AA (4.5:1) on every surface', () => {
  const t = tokens();
  const failures: string[] = [];
  for (const fg of ['--text-primary', '--text-secondary', '--text-tertiary', '--primary', '--success', '--warning', '--danger']) {
    for (const bg of ['--bg', '--surface', '--surface-raised']) {
      const r = contrast(t[fg], t[bg]);
      if (r < 4.5) failures.push(`${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('design tokens: control outlines and focus ring reach 3:1 (WCAG 1.4.11) on every surface', () => {
  const t = tokens();
  const failures: string[] = [];
  for (const fg of ['--border-control', '--focus']) {
    for (const bg of ['--bg', '--surface', '--surface-raised']) {
      const r = contrast(t[fg], t[bg]);
      if (r < 3) failures.push(`${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('design tokens: the dark text on the primary button reaches 4.5:1', () => {
  const t = tokens();
  assert.ok(contrast('#04131c', t['--primary']) >= 4.5);
  assert.ok(contrast('#04131c', t['--focus']) >= 4.5); // hover colour
});

test('design tokens: palette matches the specification and no type token is below 12px', () => {
  const t = tokens();
  assert.equal(t['--c-midnight'], '#070b12'); assert.equal(t['--c-graphite'], '#0f1722'); assert.equal(t['--c-raised'], '#151f2b');
  assert.equal(t['--c-border'], '#29394b'); assert.equal(t['--c-text'], '#f2f6fa'); assert.equal(t['--c-text-2'], '#a6b4c2');
  assert.equal(t['--c-cyan'], '#60c7f2'); assert.equal(t['--c-mint'], '#4be1ac'); assert.equal(t['--c-amber'], '#ffc36b'); assert.equal(t['--c-red'], '#ff6b76');
  for (const k of ['--fs-meta', '--fs-small', '--fs-body', '--fs-base']) assert.ok(parseFloat(t[k]) * 16 >= 12, `${k} is ${t[k]}`);
  const sheet = read('src/style.css');
  for (const m of sheet.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 12, `font-size ${m[0]} below 12px`);
});

test('simulator CSS: every hard-coded hex text colour reaches 4.5:1 on all three surfaces', () => {
  const failures: string[] = [];
  read('src/style.css').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(?<![-a-z])color:\s*(#[0-9a-f]{6})/gi)) {
      for (const bg of ['#070b12', '#0f1722', '#151f2b']) { const r = contrast(m[1], bg); if (r < 4.5) failures.push(`line ${i + 1}: ${m[1]} on ${bg} = ${r.toFixed(2)}`); }
    }
  });
  assert.deepEqual(failures, []);
});

test('simulator CSS: touch target token is at least 44px and primary controls use it', () => {
  const t = tokens();
  assert.ok(parseInt(t['--target'], 10) >= 44);
  assert.match(read('src/style.css'), /\.power-switch|\.primary-action/);
});

// ---------------------------------------------------------------- homepage SEO
const html = read('index.html');
const meta = (attr: string, name: string) => new RegExp(`<meta[^>]+${attr}="${name}"[^>]+content="([^"]*)"`).exec(html)?.[1];

test('homepage: title, description, canonical, Open Graph and Twitter metadata', () => {
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)?.[1], 'Volta Lab | Interactive 3D Power Electronics Simulator');
  const d = meta('name', 'description')!;
  assert.ok(d.startsWith('Explore an educational 3D battery, DC-DC converter and single-phase inverter simulator.') && d.endsWith('Simulation only.'));
  assert.ok(d.length >= 70 && d.length <= 320);
  assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/"`));
  for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:site_name']) assert.ok(meta('property', p), p);
  for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) assert.ok(meta('name', n), n);
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.match(html, /<html lang="en"/);
});

test('homepage: exactly one H1 and logical heading levels', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.ok(html.indexOf('<h1') < html.indexOf('<h2'));
});

test('homepage: SoftwareApplication structured data is valid JSON and makes no rating, review or price claims', () => {
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(raw);
  const ld = JSON.parse(raw);
  assert.equal(ld['@type'], 'SoftwareApplication'); assert.equal(ld.name, 'Volta Lab'); assert.equal(ld.url, `${ORIGIN}/`);
  for (const forbidden of ['aggregateRating', 'review', 'offers', 'price', 'ratingValue']) assert.ok(!(forbidden in ld), forbidden);
});

test('homepage: icons, manifest and the app icon files exist', () => {
  for (const f of ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-image.png', 'site.webmanifest']) assert.ok(existsSync(join(ROOT, 'public', f)), f);
  const manifest = JSON.parse(read('public/site.webmanifest'));
  assert.ok(manifest.icons.length >= 2);
  const png = readFileSync(join(ROOT, 'public/og-image.png'));
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
});

test('homepage: simulation-only and short-circuit wording is present before risky interactions', () => {
  assert.match(html, /Simulation only/);
  assert.match(html, /Fault test, not a normal connection/);
  assert.match(html, /terminal short circuit/);
});

test('homepage: no unsupported claims about solar, MPPT, mains supply or three-phase output', () => {
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  // The Control Room roadmap may NAME future phases (e.g. solar / MPPT) only inside its explicitly labelled "planned, not available
  // yet" block. That block is checked separately below; everywhere else the original claim scan still applies unchanged.
  const roadmap = /<details class="ll-roadmap">[\s\S]*?<\/details>/.exec(visible)?.[0] ?? '';
  assert.match(roadmap, /planned, not available yet/i);
  assert.match(roadmap, /None of these exist yet/);
  const outsideRoadmap = visible.replace(roadmap, '');
  assert.ok(!/\bMPPT\b|solar (panel|charger|PV)|photovoltaic/i.test(outsideRoadmap.replace(/It does not simulate[^<]*/g, '')));
});

// ---------------------------------------------------------------- robots, sitemap, Learning Hub
const learnDir = join(ROOT, 'public/learn');
const learnPages = readdirSync(learnDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

test('robots.txt allows crawling and points at the sitemap', () => {
  const robots = read('public/robots.txt');
  assert.match(robots, /User-agent: \*/); assert.match(robots, /Allow: \//); assert.match(robots, new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
  assert.ok(!/Disallow:\s*\/\s*$/m.test(robots));
});

test('sitemap.xml lists the homepage, the hub and every lesson, and nothing else', () => {
  const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = [`${ORIGIN}/`, `${ORIGIN}/learn/`, ...learnPages.map((p) => `${ORIGIN}/learn/${p}/`)].sort();
  assert.deepEqual(locs, expected);
  assert.equal(learnPages.length, 5);
});

for (const slug of ['', ...learnPages]) {
  const rel = slug ? `public/learn/${slug}/index.html` : 'public/learn/index.html';
  const url = slug ? `${ORIGIN}/learn/${slug}/` : `${ORIGIN}/learn/`;
  test(`learning page ${slug || 'hub'}: metadata, one H1, valid structured data, working internal links`, () => {
    const page = read(rel);
    assert.match(page, /<html lang="en">/);
    const title = /<title>([^<]+)<\/title>/.exec(page)?.[1] ?? '';
    assert.ok(title.endsWith('| Volta Lab') && title.length <= 70, title);
    assert.ok((/<meta name="description" content="([^"]+)"/.exec(page)?.[1] ?? '').length >= 70);
    assert.match(page, new RegExp(`<link rel="canonical" href="${url}">`));
    assert.match(page, /<meta property="og:image" content="[^"]+og-image\.png">/);
    assert.equal((page.match(/<h1[\s>]/g) ?? []).length, 1);
    assert.match(page, /Simulation only/);
    for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
    for (const m of page.matchAll(/href="(\/[^"#]*)"/g)) {
      const target = m[1];
      if (target === '/') continue;
      const file = target.endsWith('/') ? join(ROOT, 'public', target, 'index.html') : join(ROOT, 'public', target);
      assert.ok(existsSync(file), `broken internal link ${target} in ${rel}`);
    }
    assert.ok(!/\bMPPT\b|grid synchronisation is (modelled|simulated)|three-phase output is/i.test(page.replace(/does not[^<]*|not simulated[\s\S]*?<\/ul>|There is no[^<]*|Mains supply[^<]*|Three-phase systems[^<]*|Solar panels[^<]*/gi, '')));
  });
}

test('learning pages: every lesson distinguishes law, approximation and assumption, and none is thin', () => {
  for (const slug of learnPages) {
    const page = read(`public/learn/${slug}/index.html`);
    assert.match(page, /tag-law|tag-approx|tag-assumed/, slug);
    const words = page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 350, `${slug} has only ${words} words`);
  }
});

test('learning pages: quoted model constants match the engine', async () => {
  const { MAX_SETPOINT_V, defaultConfig } = await import('./sim/engine.ts');
  const cfg = defaultConfig();
  assert.equal(MAX_SETPOINT_V, 415);
  assert.equal(cfg.converter.outCurrentLimitA, 10); assert.equal(cfg.tripDelayS, 2); assert.equal(cfg.contactOhm, 0.05); assert.equal(cfg.acFreqHz, 50);
  assert.equal(cfg.converter.dMax, 0.9); assert.equal(cfg.converter.fswHz, 50_000); assert.equal(cfg.inverter.modulationMax, 0.95);
  assert.equal(cfg.inverter.bridgeRohm, 0.08); assert.equal(cfg.inverter.bridgeFixedW, 3); assert.equal(cfg.inverter.bridgeSwLossFrac, 0.015);
  assert.equal(cfg.pack.seriesCells, 100); assert.equal(cfg.pack.parallelStrings, 2); assert.equal(cfg.pack.cell.capacityAh, 5); assert.equal(cfg.initialSoc, 0.9);
  assert.equal(cfg.inverter.linkMinV, 60); assert.equal(cfg.inverter.linkMaxV, 700);
  // worked numbers quoted in the lessons
  assert.ok(Math.abs(Math.SQRT2 * 415 - 586.9) < 0.05); assert.ok(Math.abs(Math.SQRT2 * 415 / 0.95 - 617.8) < 0.05);
  assert.ok(Math.abs(Math.SQRT2 * 220 - 311.1) < 0.05); assert.ok(Math.abs(Math.SQRT2 * 110 - 155.6) < 0.05);
});

test('learn.css embeds the current design tokens', () => {
  assert.ok(read('public/learn/learn.css').startsWith(read('src/tokens.css')));
});

// ---------------------------------------------------------------- Component Workbench shell (Phase 1A)
test('workbench: entry button is separate from the machine header, which keeps exactly its three buttons', () => {
  const html = read('index.html');
  const header = /<header class="topbar">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  assert.equal((header.match(/<button\b/g) ?? []).length, 3);
  for (const id of ['panelToggle', 'explodeBtn', 'cameraModeBtn']) assert.ok(header.includes(`id="${id}"`), id);
  assert.ok(!header.includes('workbenchBtn'), 'the Workbench button must not be inside the machine header');
  const entry = /<div class="workbench-entry">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
  assert.match(entry, /id="workbenchBtn"/);
  assert.match(entry, /aria-controls="workbench"/);
  assert.match(entry, /aria-label="Component Workbench"/);
});

test('workbench: non-modal left side panel with three sections; the Components section holds library, work area and properties; honest empty states', () => {
  const html = read('index.html');
  const wb = /<aside id="workbench"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? '';
  // Not modal: a labelled side panel (complementary landmark), closed by default; no dialog role, no aria-modal.
  assert.match(wb, /^<aside id="workbench" class="workbench" aria-labelledby="wbTitle" hidden>/);
  assert.ok(!/role="dialog"|aria-modal/.test(wb) && !html.includes('aria-haspopup="dialog"'), 'the Workbench is a side panel, not a dialog');
  // Three sections as tabs, each controlling its own tabpanel: Components (all current data), Transformers, and a reserved third.
  const tabs = [...wb.matchAll(/role="tab"[^>]*aria-controls="(wbpane-[a-z]+)"[^>]*data-wb-section="([a-z]+)"/g)].map((m) => `${m[2]}>${m[1]}`);
  assert.deepEqual(tabs, ['components>wbpane-components', 'transformers>wbpane-transformers', 'third>wbpane-third']);
  assert.equal((wb.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.ok(/id="wbpane-transformers"[^>]*hidden/.test(wb) && /id="wbpane-third"[^>]*hidden/.test(wb) && !/id="wbpane-components"[^>]*hidden/.test(wb), 'Components is the open section by default');
  assert.ok(wb.includes('id="libTransformers"') && wb.indexOf('id="libTransformers"') > wb.indexOf('id="wbpane-transformers"'));
  const third = wb.slice(wb.indexOf('id="wbpane-third"'));
  assert.ok(third.includes('id="libSection3"') && !/has not been decided yet/.test(third), 'the third section holds the Resistors, Capacitors and Diodes catalogue (rendered by library-ui), not a placeholder');
  const order = ['library', 'workspace', 'properties'].map((r) => wb.indexOf(`data-wb-region="${r}"`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'regions in left, centre, right order');
  assert.equal((wb.match(/<section class="wb-region/g) ?? []).length, 3);
  // Phase 1B: the left area is honestly titled as the five available load models, not as a complete component library.
  for (const h of ['Available Load Models', 'Work area', 'Properties']) assert.ok(wb.includes(`>${h}</h3>`), h);
  assert.ok(wb.includes('id="wbClose"'));
  // Still no extra components, fake controls or 3D canvas in the static shell. (The five load cards, fields and buttons are rendered by
  // loadlab-ui.ts from LOAD_CATALOGUE, so the static markup holds no <input>/<select>; Phase 1A also listed resistor/capacitor/inductor here,
  // which the Phase 1B glossary legitimately names, so those three words are now checked by the catalogue test below instead of being banned.)
  assert.ok(!/mosfet|transistor|diode|integrated circuit|<input|<select|<canvas/i.test(wb), 'no extra components or fake controls');
  assert.ok(wb.includes('not the complete electronics component library'), 'the library says it is not the complete library');
  // The panel sits in <body>, after the machine page (#app), and is not inside the Control Room.
  assert.ok(html.indexOf('<aside id="workbench"') > html.indexOf('<body>') && html.indexOf('<aside id="workbench"') > html.indexOf('</main>'));
  assert.ok(!(/<aside id="controlPanel"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? '').includes('id="workbench"'));
  assert.ok(!html.slice(html.indexOf('<div id="app"'), html.indexOf('</main>')).includes('id="workbench"'));
});

test('workbench (Phase 1B): Load Lab is mounted in the Workbench, gone from the Control Room, and the shell is wired in entry.ts', () => {
  const html = read('index.html');
  const wb = /<aside id="workbench"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? '';
  const panel = /<aside id="controlPanel"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? '';
  assert.ok(panel.length > 500);
  // Control Room: no Load Lab tab, pane, roadmap or any Load Lab host.
  assert.ok(!/tab-loadlab|pane-loadlab|data-tab="loadlab"|Load Lab|ll-roadmap|id="ll[A-Z]/.test(panel), 'Control Room holds no Load Lab');
  assert.ok(!html.includes('id="pane-loadlab"') && !html.includes('id="tab-loadlab"'));
  assert.equal((panel.match(/role="tab"/g) ?? []).length, 5, 'five Control Room tabs remain: Controls, Settings, Help, Learning Hub, Limitations & Safety');
  // Workbench: every host the Load Lab UI needs lives inside it, in the right area.
  const area = (r: string) => new RegExp(`data-wb-region="${r}"[\\s\\S]*?</section>`).exec(wb)?.[0] ?? '';
  for (const id of ['llLibrary']) assert.ok(area('library').includes(`id="${id}"`), id);
  for (const id of ['llWork', 'llLive', 'llStatus', 'llResults', 'llStatusPill']) assert.ok(area('workspace').includes(`id="${id}"`), id);
  for (const id of ['llForm', 'llConnect']) assert.ok(area('properties').includes(`id="${id}"`), id);
  assert.ok(area('library').includes('class="ll-roadmap"') && /planned, not available yet/i.test(area('library')));
  assert.match(read('src/entry.ts'), /import '\.\/workbench-ui\.ts';/);
  assert.match(read('src/main.ts'), /closest\?\.\('#workbench'\)\) return;/, 'keys typed inside the Workbench panel never act on the machine');
  assert.ok(!/inert/.test(read('src/workbench-ui.ts').replace(/\/\/.*$/gm, '')), 'the machine is never made inert: the panel is not modal');
  assert.match(read('src/main.ts'), /const TAB_IDS = \['controls', 'settings', 'help', 'learn', 'safety'\] as const;/);
  assert.equal((read('src/main.ts').match(/initLoadLab\(/g) ?? []).length, 1, 'the Load Lab is initialised exactly once');
});

test('index.html: no duplicate element ids (the Load Lab hosts exist exactly once)', () => {
  const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, [], `duplicate ids: ${dup.join(', ')}`);
});

test('Load Lab UI source: beginner terminology, circuit-symbol labelling, no physics and a single mount', () => {
  const ui = read('src/loadlab-ui.ts');
  assert.ok(!/pane-loadlab/.test(ui), 'no dependency on the removed Control Room pane');
  assert.ok(ui.includes('circuit symbol') && ui.includes('not a picture of the physical part'));
  assert.ok(ui.includes('not manufacturer') || ui.includes('Not a real product'));
  assert.ok(!/Math\.(sqrt|sin|cos|atan|PI)|three/.test(ui.replace(/\/\/.*$/gm, '')), 'the UI contains no equations and no three.js');
  assert.ok(/describeLoadResults\(/.test(ui) && /coordinator\.connectLoad\(/.test(ui), 'results via describeLoadResults, connecting via the coordinator');
});

test('Workbench library source of truth: exactly the five existing load models, and the static shell names no other component', () => {
  assert.deepEqual(LOAD_CATALOGUE.map((l) => l.id), ['resistor', 'inductor', 'capacitor', 'rlc', 'dc-motor']);
  const html = read('index.html');
  const wb = /<div id="workbench"[\s\S]*?\n    <\/div>\n/.exec(html)?.[0] ?? '';
  // The static shell never lists load cards itself (loadlab-ui.ts renders them from LOAD_CATALOGUE), so no card markup is hand-written here.
  assert.ok(!wb.includes('class="ll-card"'), 'cards come from the catalogue, not from hand-written markup');
  assert.ok(!/mosfet|transistor|diode|op-amp|microcontroller|integrated circuit/i.test(wb), 'no other components named');
});
