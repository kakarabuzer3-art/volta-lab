// Targeted browser check (usage: BASE_URL=http://localhost:4173/ node scripts/load-drag-check.cjs [width height touch]). Prints PASS/FAIL lines and ALL PASS or N FAILED.
const { chromium } = require('playwright');
const [w, h, touch] = [Number(process.argv[2] || 1440), Number(process.argv[3] || 900), process.argv[4] === 'touch'];
let fails = 0; const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  ' + (d || ''))); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch });
  const errs = []; const pg = await ctx.newPage(); pg.setDefaultTimeout(6000); pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto((process.env.BASE_URL || 'http://localhost:4173/')); await pg.waitForFunction(() => !!window.voltaLab, null, { timeout: 40000 });
  const conn = () => pg.evaluate(() => window.voltaLab.snapshot().inputs.connection);
  await pg.click('#workbenchBtn'); await pg.waitForSelector('#llLibrary [data-load]', { timeout: 15000 });
  ok('start: no load connected, drop area and five grips exist', (await conn()) !== 'load' && (await pg.locator('#llDrop').isVisible()) && (await pg.locator('.ll-grip').count()) === 5);
  const gripBox = async (id) => { const g = pg.locator(`.ll-grip[data-grip="${id}"]`); await g.scrollIntoViewIfNeeded(); return g.boundingBox(); };
  // 1. release outside the drop area
  let g = await gripBox('resistor');
  await pg.mouse.move(g.x + 8, g.y + 8); await pg.mouse.down(); await pg.mouse.move(g.x + 8, g.y + 60, { steps: 4 });
  ok('while dragging: ghost visible and drop area armed', (await pg.locator('.tb-ghost').count()) === 1 && (await pg.evaluate(() => document.getElementById('llDrop').classList.contains('is-armed'))));
  await pg.mouse.up();
  ok('release outside connects nothing and removes the ghost', (await conn()) !== 'load' && (await pg.locator('.tb-ghost').count()) === 0);
  // 2. a click on the card still just selects it (no connection)
  await pg.click('#llLibrary [data-load="resistor"]'); await pg.waitForTimeout(150);
  // go back to library area
  await pg.click('[data-wb-area=library]'); await pg.waitForTimeout(120);
  ok('clicking a card selects but does not connect', (await conn()) !== 'load');
  // 3. drop on the machine output
  await pg.locator('#llDrop').scrollIntoViewIfNeeded();
  g = await gripBox('resistor'); let d = await pg.locator('#llDrop').boundingBox();
  if (d.y > 0 && d.y + d.height < h) {
    await pg.mouse.move(g.x + 8, g.y + 8); await pg.mouse.down(); await pg.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 8 });
    ok('over the drop area it highlights', await pg.evaluate(() => document.getElementById('llDrop').classList.contains('is-over')));
    await pg.mouse.up(); await pg.waitForTimeout(400);
  } else {
    // bench not simultaneously visible: use scroll-friendly drag with the drop area at the top of the region
    await pg.mouse.move(g.x + 8, g.y + 8); await pg.mouse.down(); await pg.mouse.move(Math.max(d.x + 5, 5), Math.min(Math.max(d.y + 5, 5), h - 5), { steps: 8 }); await pg.mouse.up(); await pg.waitForTimeout(400);
  }
  await pg.waitForFunction(() => window.voltaLab.snapshot().inputs.connection === 'load', null, { timeout: 8000 }).catch(() => {});
  ok('dropping a model on the machine output connects it to the ENGINE (snapshot connection = load)', (await conn()) === 'load', await conn());
  const msg = await pg.evaluate(() => document.getElementById('llDropMsg').textContent);
  ok('the drop area reports the result honestly', /Connected: /.test(msg) && /Work area/.test(msg), msg);
  await pg.click('[data-wb-area=workspace]'); await pg.waitForTimeout(1200);
  ok('Work area shows LOAD CONNECTED and live results from the engine', /LOAD CONNECTED/.test(await pg.evaluate(() => document.getElementById('llStatus').textContent)) && /\d/.test(await pg.evaluate(() => document.getElementById('llResults').textContent)));
  const readOhm = () => pg.evaluate(() => { const rows = {}; document.querySelectorAll('#llResults .ll-results > div').forEach((d) => { rows[d.querySelector('dt').textContent.trim()] = d.querySelector('dd').textContent.trim(); }); return rows; });
  const off = await readOhm();
  ok("machine OFF: the Ohm's law check says 'not available' instead of inventing numbers", Object.entries(off).filter(([k]) => /V ÷ I|V × I/.test(k)).every(([, v]) => /not available/.test(v)) && Object.keys(off).some((k) => /V ÷ I/.test(k)), JSON.stringify(off));
  await pg.evaluate(() => { document.getElementById('powerBtn').click(); const el = document.getElementById('voltageSlider'); el.value = '120'; el.dispatchEvent(new Event('input', { bubbles: true })); }); // power on, setpoint 120 V
  await pg.waitForFunction(() => window.voltaLab.snapshot().inputs.powerOn === true, null, { timeout: 8000 }).catch(() => {});
  await pg.waitForFunction(() => /[1-9]/.test(document.querySelector('#llResults .ll-results')?.textContent.split('Terminal voltage (V)')[1]?.slice(0, 12) || ''), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  const ohm = await readOhm();
  const num = (t) => parseFloat(String(t).replace(/[^0-9.\-]/g, ''));
  const vOut = num(ohm['Terminal voltage (V)']), iOut = num(ohm['Load current (I)']), rShown = num(Object.entries(ohm).find(([k]) => /\(V ÷ I\)/.test(k))?.[1]), viShown = num(ohm['V × I']);
  ok("Ohm's law check is shown and agrees with the displayed V and I (V ÷ I and V × I within rounding)", iOut > 0 && Math.abs(rShown - vOut / iOut) <= 0.02 * (vOut / iOut) + 0.1 && Math.abs(viShown - vOut * iOut) <= 0.02 * vOut * iOut + 0.2, JSON.stringify(ohm));
  // 4. keyboard path unchanged
  await pg.click('[data-wb-area=properties]'); await pg.click('#llDisconnectBtn'); await pg.waitForTimeout(200);
  ok('Disconnect (keyboard path) still works', (await conn()) !== 'load');
  await pg.click('#llConnectBtn'); await pg.waitForFunction(() => window.voltaLab.snapshot().inputs.connection === 'load', null, { timeout: 8000 }).catch(() => {});
  ok('Connect load button still connects the selected model', (await conn()) === 'load');
  ok('no page errors, no horizontal overflow', errs.length === 0 && !(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), errs.join('|'));
  await pg.click('[data-wb-area=workspace]'); await pg.waitForTimeout(600); await pg.screenshot({ path: process.env.SHOT || `./loaddrag-${w}.png` });
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
})().catch((e) => { console.log('CRASH ' + e.message.split('\n').slice(0,9).join(' / ')); process.exit(1); });
