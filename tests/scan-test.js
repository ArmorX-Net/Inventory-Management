// Browser test of the Scan station: drives the real app in headless Chrome and checks the warehouse rules.
// Needs Playwright (`npm i -g playwright` or any machine that has it). Run: `node tests/scan-test.js`.
// It never talks to the Google Sheet: the test starts with no sheet connected and blocks Google requests.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

// 11 Nov 2026: no R6 backup boxes for now; extra stock sits on top of the racks (TOP, old labels 2F still work).
const NET = 'DN-185x90-BK', PICK = 'AR-C4-R3', OLD_R6 = 'AR-C4-R6', BIN = 'AR-C4-R1';
function batch(id, made) {
  return { id, net: NET, qty: 20, good: 20, stage: 5, created: made, by: 'Manager', history: [{ stage: 0, by: 'Manager', qty: 20, rej: 0, t: made }], loc: null };
}
const STATE = {
  seq: 2, stock: {}, log: [], boxes: {}, demo: false, layout: 'v7', settings: { batchSize: '50x25' },
  workers: [{ id: 'EMP-06', name: 'Test Picker', role: 'Racks & dispatch' }, { id: 'EMP-07', name: 'Test Stitcher', role: 'Stitching' }],
  auth: { t: 'test-token', exp: Date.now() + 864e5, id: 'EMP-06', name: 'Test Picker', level: 'Admin' }, // signed in (no sheet in this test)
  batches: { 'WO-0001': batch('WO-0001', '2026-11-01T08:00:00.000Z'), 'WO-0002': batch('WO-0002', '2026-11-05T08:00:00.000Z') },
};

// [what we scan, text the feedback must contain]
const STEPS = [
  ['EMP-06', 'Hello Test Picker'],             // signed in: your own badge just says hello
  ['EMP-07', 'Sign out first'],                 // another person's badge never switches without their PIN
  ['WO-0001', 'ready for the rack'],
  [PICK, 'still has older nets'],               // FIFO: never rack-in on top of older nets
  ['2F', '20 nets in'],                          // extra stock goes on top of the racks; an old 2F label still works
  ['CMD-OUT', 'OUT mode on'],
  [OLD_R6, 'Unknown code'],                      // R6 backup boxes are not in use
  [PICK, 'Enter the quantity'],
  ['3', 'now 17 in total'],
  [PICK, 'Enter the quantity'],
  ['50', 'Only 17 on hand'],                     // cannot ship more than we have
  ['CMD-EMPTY', 'EMPTY mode on'],
  [PICK, 'marked empty'],
  ['CMD-SWAP', 'SWAP mode on'],
  [PICK, 'Fill it from the top of the racks'],   // no backup box: refill straight from TOP
  ['CMD-REFILL', 'REFILL mode on'],
  [PICK, 'take batch WO-0001'],                  // refill takes the oldest batch on top of the racks
  [PICK, 'is not empty'],                        // FIFO: never pour new nets on top
  ['CMD-EMPTY', 'EMPTY mode on'],
  [PICK, 'marked empty'],
  ['CMD-EMPTY', 'EMPTY mode on'],
  ['AR-C1-R3', 'Swap now'],                      // 210x100 keeps its backups on R1-R5 in AR C1-C3
  ['CMD-SWAP', 'SWAP mode on'],
  ['AR-C1-R2', 'Swap:'],
  ['CMD-CANCEL', 'Cleared'],
  ['CMD-CANCEL', 'Cleared'],
  ['WO-0002', 'ready for the rack'],
  [PICK, '20 nets in'],                          // rack-in into an EMPTY box is allowed
  ['XYZ-1', 'Unknown code'],
  // undo my last scan: needs a reason, puts everything back, only once
  ['CMD-UNDO', 'Tap why'],
  ['@tap', '[data-why="Wrong box"]', 'Undone:'],
  ['CMD-UNDO', 'Nothing to undo'],
  ['WO-0002', 'ready for the rack'],             // the batch is back at Packing, so it can be racked again
  [PICK, '20 nets in'],
  // a count that changes stock asks for a reason
  ['CMD-COUNT', 'COUNT mode on'],
  [PICK, 'Enter the quantity'],
  ['35', 'Why is it different'],
  ['5', 'Tap a reason first'],
  ['@tap', '[data-why="Picked without scanning"]', 'now 35 in total'],
  ['@tap', '[data-undo]', 'Tap why'],              // undo button on screen
  ['@tap', '[data-why="Wrong number"]', 'is 37 in total'],
  [PICK, 'Enter the quantity'],
  ['37', 'now 37 in total'],                     // same as the system: no reason needed
  // box count (opening count): scan the shelf, type the number
  ['CMD-BOXCOUNT', 'BOX COUNT mode on'],
  [PICK, 'Count the nets'],
  ['50', 'type 50 again'],                       // a big number is checked once, never blocked
  ['18', 'AR-C4-R3: 18 counted'],
  ['AR-C4-R2', 'Count the nets'],
  ['0', 'AR-C4-R2: 0 counted'],                  // an empty box is just 0
  [BIN, 'color 1 of 3'],                         // 3-bin box: one number per color
  ['4', 'color 2 of 3'],
  ['3', 'color 3 of 3'],
  ['2', 'AR-C4-R1: 2 counted'],
  ['@tap', '[data-undo]', 'Tap why'],
  ['@tap', '[data-why="Wrong number"]', 'Undone:'],
  ['TOP', 'Top of racks'],
  ['@floor', 'Black', 'Count the nets'],
  ['5', 'on top of the racks: 5 counted'],
  ['CMD-CANCEL', 'Cleared'],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/google|googleapis|gstatic/, (r) => r.abort());
  await page.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('armorx-inv-v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(STATE));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html') + '#scan');
  await page.waitForSelector('#scanIn');

  let failed = 0;
  for (const step of STEPS) {
    let code = step[0], want = step[1];
    if (code === '@tap') { await page.click(step[1]); code = 'tap ' + step[1].replace(/\[data-|\]|"/g, ''); want = step[2]; }
    else if (code === '@floor') { await page.selectOption('#bcSize', '185x90'); await page.click('[data-col="' + step[1] + '"]'); code = '185x90 ' + step[1]; want = step[2]; }
    else { await page.fill('#scanIn', code); await page.press('#scanIn', 'Enter'); }
    const got = (await page.textContent('#fb')).replace(/\s+/g, ' ').trim();
    const ok = got.includes(want);
    if (!ok) failed++;
    console.log((ok ? 'ok    ' : 'FAIL  ') + code.padEnd(11) + (ok ? want : 'wanted "' + want + '"\n      got    "' + got + '"'));
  }
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem('armorx-inv-v1')));
  function expect(name, ok) { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + name); }
  let S = await st();
  expect('stock of ' + NET + ' is ' + S.stock[NET] + ' (want 37: 20 in, 3 out, 20 in, undo, 20 in again)', S.stock[NET] === 37);
  expect('undone rack-in is marked UNDONE in the log', S.log.some((e) => e.type === 'IN' && e.wo === 'WO-0002' && / · UNDONE/.test(e.note)));
  expect('every undo saved its reason', S.log.filter((e) => e.type === 'UNDO').map((e) => e.reason).join() === 'Wrong number,Wrong number,Wrong box');
  expect('count change saved with its reason', S.log.some((e) => e.type === 'COUNT' && e.qty === 35 && e.reason === 'Picked without scanning'));
  expect('box count: ' + Object.keys(S.counts).sort().join(' '), Object.keys(S.counts).sort().join(' ') === ['TOP|' + NET, 'AR-C4-R2|DN-185x95-BK', BIN + '|DN-185x100-BK', BIN + '|DN-185x100-BR', PICK + '|' + NET].sort().join(' '));

  // the manager applies the box count on the Stock page; a change needs a reason
  await page.evaluate(() => { location.hash = 'stock'; });
  await page.click('#bcOpen');
  await page.click('#bcApply');
  expect('apply without a reason is refused', (await page.textContent('#bcMsg')).includes('Pick a reason first'));
  await page.selectOption('#bcWhy', 'Opening count');
  await page.click('#bcApply');
  S = await st();
  expect('applied: ' + NET + ' is ' + S.stock[NET] + ' (want 23 = 18 in box + 5 on top)', S.stock[NET] === 23);
  expect('applied: 185x100 Black 4, Brown 3, Grey not counted so unchanged', S.stock['DN-185x100-BK'] === 4 && S.stock['DN-185x100-BR'] === 3 && !S.stock['DN-185x100-GR']);
  expect('box counted 0 is marked empty', (S.boxes['AR-C4-R2'] || {}).state === 'empty' && S.stock['DN-185x95-BK'] === 0);
  expect('applied counts are cleared, nothing left over', Object.keys(S.counts).length === 0);
  expect('apply logged with the reason', S.log.some((e) => e.type === 'COUNT' && e.net === NET && e.qty === 23 && e.reason === 'Opening count'));

  // the count sheet also needs a reason for a change
  await page.click('#cntMode');
  await page.fill('tr[data-id="' + NET + '"] [data-k=r]', '30');
  await page.click('#cntSave');
  expect('count sheet without a reason is refused', (await page.textContent('#cntMsg')).includes('Pick a reason first'));
  await page.selectOption('#cntWhy', 'Found extra nets');
  await page.click('#cntSave');
  S = await st();
  expect('count sheet saved 30 with its reason', S.stock[NET] === 30 && S.log[0].reason === 'Found extra nets');

  // put away (opening count, net first): type the size, tap the color, the app shows the box; adds add up
  await page.evaluate(() => { location.hash = 'scan'; }); await page.waitForSelector('#scanIn');
  const fbText = async () => (await page.textContent('#fb')).replace(/\s+/g, ' ');
  const scan = async (c) => { await page.fill('#scanIn', c); await page.press('#scanIn', 'Enter'); };
  const PA = 'DN-210x90-BK', PA_BOX = 'CR-C4-R4';
  await scan('CMD-PUTAWAY');
  expect('put away mode asks for the size', (await fbText()).includes('Type the size') && !!(await page.$('#paSize')));
  await page.fill('#paSize', '210 9');
  expect('typing 210 9 lists 210 x 90 and friends', !!(await page.$('[data-pa-size="210x90"]')) && !(await page.$('[data-pa-size="205x90"]')));
  await page.click('[data-pa-size="210x90"]');
  await page.click('[data-pa-net="' + PA + '"]');
  expect('the box shows in big letters with a plain hint', (await page.textContent('.pa-loc')) === PA_BOX && (await page.textContent('.pa-hint')).includes('Rack C · right side · column 4 · row 4'));
  await page.click('[data-pa-add="1"]');
  expect('+1 recorded', (await fbText()).includes('Now 1 there'));
  await page.click('.pa-same');
  await page.fill('#paQty', '4'); await page.press('#paQty', 'Enter');   // other number: type it
  expect('+4 adds up to 5', (await fbText()).includes('Now 5 there'));
  await page.click('.pa-same');
  await scan(PICK);
  expect('scanning the wrong shelf says where it goes', (await fbText()).includes('Wrong box'));
  await scan(PA_BOX);
  expect('scanning the right shelf confirms it', (await fbText()).includes('Right box'));
  await page.click('[data-pa-top="3"]');
  expect('box full: 3 on top of the rack', (await fbText()).includes('top of the rack'));
  await page.click('[data-undo]'); await page.click('[data-why="Wrong number"]');
  S = await st();
  expect('undo takes only the last add back off: box 5, nothing on top', S.counts[PA_BOX + '|' + PA].qty === 5 && !S.counts['TOP|' + PA] && !!(await page.$('#paSize')));
  await page.fill('#paSize', '210100'); await page.click('[data-pa-size="210x100"]'); await page.click('[data-pa-net="DN-210x100-BK"]');
  await scan('20');
  await page.click('.pa-same');
  expect('a full box sends the next nets to the next box with room', (await page.textContent('.pa-loc')) === 'AR-C1-R1');
  await scan('CMD-CANCEL');

  for (const tab of ['dashboard', 'pick', 'batches', 'stock', 'racks', 'refill', 'print', 'log', 'people', 'settings']) {
    await page.evaluate((t) => { location.hash = t; }, tab);
    await page.waitForTimeout(150);
  }
  if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }
  else console.log('ok    every tab opens without errors');

  // ---- sign-in: a new phone sees only the sign-in screen; a worker gets floor pages only ----
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.route(/google|googleapis|gstatic/, (r) => r.abort());
  const gets = [];
  await p2.route(/script\.google\.com/, async (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'login') {
        const ok = b.badge === '7' && b.pin === '1234';
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify(ok ? { ok: true, v: 5, token: 'EMP-07.' + (Date.now() + 30 * 864e5) + '.sig', exp: Date.now() + 30 * 864e5, me: { id: 'EMP-07', name: 'Test Stitcher', level: 'Worker' } } : { ok: false, auth: true, error: 'Wrong employee number or PIN. 4 tries left.' }) });
      }
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, saved: (b.events || []).map((e) => e.id), refused: [] }) });
    }
    gets.push(req.url());
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, v: 5, me: { id: 'EMP-07', name: 'Test Stitcher', level: 'Worker' }, stock: {}, batches: [], workers: [{ id: 'EMP-07', name: 'Test Stitcher', role: 'Stitching' }], log: [], rates: {}, boxes: {}, counts: {}, at: new Date().toISOString() }) });
  });
  await p2.goto('file://' + path.join(__dirname, '..', 'index.html') + '#stock');
  await p2.waitForSelector('#siId');
  expect('new phone: sign-in screen, no tabs, no data', await p2.isHidden('#tabs') && !(await p2.$('#scanIn')) && !(await p2.textContent('body')).includes('(sample)'));
  await p2.fill('#siId', '7'); await p2.fill('#siPin', '1111'); await p2.click('#siGo');
  await p2.waitForFunction(() => /tries left/.test(document.getElementById('siMsg').textContent));
  expect('wrong PIN: stays on sign-in with the message', !!(await p2.$('#siId')));
  await p2.fill('#siPin', '1234'); await p2.click('#siGo');
  await p2.waitForSelector('#scanIn');
  expect('right PIN: scan station, name in the top bar', (await p2.textContent('#meChip')).includes('Test Stitcher'));
  expect('reads send the sign-in token, never a key', gets.length > 0 && gets.every((u) => /[?&]t=EMP-07\./.test(u) && !/key=/.test(u)));
  const vis = await p2.$$eval('#tabs a', (as) => as.filter((a) => !a.hidden).map((a) => a.getAttribute('href')).join(' '));
  expect('worker tabs: ' + vis, vis === '#scan #pick #racks #refill');
  expect('worker has no Count button', !(await p2.$('[data-act="COUNT"]')) && !!(await p2.$('[data-act="BOXCOUNT"]')));
  await p2.fill('#scanIn', 'CMD-COUNT'); await p2.press('#scanIn', 'Enter');
  expect('worker CMD-COUNT refused', (await p2.textContent('#fb')).includes('Only a manager'));
  await p2.evaluate(() => { location.hash = 'stock'; });
  await p2.waitForTimeout(100);
  expect('worker opening #stock lands on the scan station', (await p2.evaluate(() => location.hash)) === '#scan' && !!(await p2.$('#scanIn')));
  const S2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('armorx-inv-v1')));
  expect('stays signed in for 30 days, PIN not kept on the phone', S2.auth.exp - Date.now() > 29 * 864e5 && !JSON.stringify(S2).includes('1234'));
  await p2.click('#soBtn');
  await p2.waitForSelector('#siId');
  expect('sign out: back to sign-in, employee number remembered', (await p2.inputValue('#siId')) === 'EMP-07' && await p2.isHidden('#tabs'));
  if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }

  await browser.close();
  console.log(failed ? failed + ' FAILED' : 'All scan tests passed.');
  process.exit(failed ? 1 : 0);
})();
