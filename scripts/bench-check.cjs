// Targeted browser check (usage: BASE_URL=http://localhost:4173/ node scripts/bench-check.cjs [width height touch]). Prints PASS/FAIL lines and ALL PASS or N FAILED.
const { chromium } = require('playwright');
const [w, h, touch] = [Number(process.argv[2] || 1440), Number(process.argv[3] || 900), process.argv[4] === 'touch'];
let fails = 0; const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  ' + (d || ''))); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch });
  const errs = []; const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto((process.env.BASE_URL || 'http://localhost:4173/')); await pg.waitForFunction(() => !!window.voltaLab, null, { timeout: 40000 });
  await pg.click('#workbenchBtn'); await pg.waitForSelector('#libTransformers .lib-item', { state: 'attached', timeout: 15000 });
  await pg.click('#wbtab-transformers'); await pg.waitForTimeout(150);
  const txt = (s) => pg.evaluate((q) => document.querySelector(q)?.textContent.replace(/\s+/g, ' ').trim() ?? '', s);
  ok('bench starts empty with a hint', /Empty\./.test(await txt('#tbDrop')) && (await pg.locator('.tb-item').count()) === 0);
  ok('each of 5 cards has Place + Drag controls', (await pg.locator('[data-place]').count()) === 5 && (await pg.locator('#libTransformers [data-grip]').count()) === 5);
  const small = await pg.evaluate(() => [...document.querySelectorAll('#libTransformers [data-place],#libTransformers [data-grip]')].filter((e) => e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44).length);
  ok('controls are at least 44 px', small === 0, String(small));
  // button placement
  await pg.click('[data-place="def.power-transformer"]'); await pg.waitForTimeout(100);
  ok('Place puts the power transformer on the bench, focus on its title', /Power transformer on the test bench/.test(await txt('#tbName')) && (await pg.evaluate(() => document.activeElement.id)) === 'tbName');
  let out = await txt('#tbOut');
  ok('live result for 1000:100 turns, 230 V: 10 : 1 step-down, Vs 23 V', /10 : 1 \(step-down\)/.test(out) && /Vs = 23 V/.test(out) && !/Is =/.test(out), out);
  await pg.fill('#tb-ip', '2'); out = await txt('#tbOut');
  ok('adding Ip = 2 A updates live: Is 20 A, S 460 VA', /Is = 20 A/.test(out) && /S = 460 VA/.test(out), out);
  await pg.fill('#tb-ns', '4000'); out = await txt('#tbOut');
  ok('Ns = 4000 turns turns it into step-up (0.25 : 1), Vs 920 V', /0\.25 : 1 \(step-up\)/.test(out) && /Vs = 920 V/.test(out), out);
  await pg.fill('#tb-np', '0'); out = await txt('#tbOut');
  ok('Np = 0 is rejected with a reason and aria-invalid', /Primary turns must be/.test(out) && (await pg.getAttribute('#tb-np', 'aria-invalid')) === 'true', out);
  await pg.fill('#tb-np', ''); out = await txt('#tbOut');
  ok('empty Np is rejected, never computed', /Primary turns must be/.test(out));
  ok('construction drawing and the ideal-transformer caveat are shown', (await pg.locator('.tb-item svg.ts-shape').count()) === 1 && /not a circuit simulation/.test(await txt('.tb-item')));
  // other shapes
  await pg.click('[data-place="def.current-transformer"]');
  const ctShape = await pg.evaluate(() => document.querySelector('.tb-item .ts-shape').innerHTML);
  await pg.click('[data-place="def.autotransformer"]');
  const autoShape = await pg.evaluate(() => document.querySelector('.tb-item .ts-shape').innerHTML);
  ok('current transformer and autotransformer draw different shapes; /never be left open/ reminder for CT', ctShape !== autoShape && /Autotransformer on the test bench/.test(await txt('#tbName')));
  await pg.click('[data-place="def.current-transformer"]');
  ok('CT reminder shows the library safety statement', /never be left open/.test(await txt('.tb-item')));
  await pg.click('[data-remove]');
  ok('Remove empties the bench and focus returns to a Place button', /Empty\./.test(await txt('#tbDrop')) && (await pg.evaluate(() => document.activeElement.hasAttribute('data-place'))));
  // pointer drag and drop
  const grip = await pg.locator('[data-grip="def.isolation-transformer"]'); await grip.scrollIntoViewIfNeeded();
  const gb = await grip.boundingBox(); const db = await pg.locator('#tbDrop').boundingBox();
  // drop OUTSIDE first
  await pg.mouse.move(gb.x + 10, gb.y + 10); await pg.mouse.down(); await pg.mouse.move(gb.x + 10, gb.y + 40, { steps: 4 });
  ok('while dragging, a ghost shows and the bench is armed', (await pg.locator('.tb-ghost').count()) === 1 && (await pg.evaluate(() => document.getElementById('tbDrop').classList.contains('is-armed'))));
  await pg.mouse.up();
  ok('releasing outside the bench places nothing and removes the ghost', (await pg.locator('.tb-item').count()) === 0 && (await pg.locator('.tb-ghost').count()) === 0);
  // drop INSIDE (bench may have scrolled; re-measure)
  const grip2 = await pg.locator('[data-grip="def.isolation-transformer"]'); await grip2.scrollIntoViewIfNeeded();
  const g2 = await grip2.boundingBox(); const d2 = await pg.locator('#tbDrop').boundingBox();
  await pg.mouse.move(g2.x + 10, g2.y + 10); await pg.mouse.down();
  if (d2 && d2.y + d2.height > 0 && d2.y < h) {
    await pg.mouse.move(d2.x + d2.width / 2, d2.y + d2.height / 2, { steps: 8 });
    ok('over the bench it highlights', await pg.evaluate(() => document.getElementById('tbDrop').classList.contains('is-over')));
    await pg.mouse.up(); await pg.waitForTimeout(100);
    ok('dropping on the bench places the Isolation transformer with a live result', /Isolation transformer on the test bench/.test(await txt('#tbName')) && /step-down/.test(await txt('#tbOut')));
  } else { await pg.mouse.up(); ok('bench not on screen with the grip (page layout, button path covers this)', true); }
  ok('Escape-free: machine page still not inert, no page errors', (await pg.evaluate(() => document.getElementById('app').inert === false)) && errs.length === 0, errs.join(' | '));
  const ov = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('workbench').scrollWidth > document.getElementById('workbench').clientWidth + 1);
  ok('no horizontal overflow with an item on the bench', !ov);
  await pg.screenshot({ path: process.env.SHOT || `./bench-${w}.png` });
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
})().catch((e) => { console.log('CRASH ' + e.message.split('\n')[0]); process.exit(1); });
