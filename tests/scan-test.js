// Browser test of the Scan station: drives the real app in headless Chrome and checks the warehouse rules.
// Needs Playwright (`npm i -g playwright` or any machine that has it). Run: `node tests/scan-test.js`.
// It never talks to the Google Sheet: the test starts with no sheet connected and blocks Google requests.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const NET = 'DN-185x90-BK', PICK = 'AR-C4-R3', BACKUP = 'AR-C4-R6', BIN = 'AR-C4-R1';
function batch(id, made) {
  return { id, net: NET, qty: 20, good: 20, stage: 5, created: made, by: 'Manager', history: [{ stage: 0, by: 'Manager', qty: 20, rej: 0, t: made }], loc: null };
}
const STATE = {
  seq: 2, stock: {}, log: [], boxes: {}, demo: false, layout: 'v7', settings: { batchSize: '50x25' },
  workers: [{ id: 'EMP-06', name: 'Test Picker', role: 'Racks & dispatch' }],
  batches: { 'WO-0001': batch('WO-0001', '2026-11-01T08:00:00.000Z'), 'WO-0002': batch('WO-0002', '2026-11-05T08:00:00.000Z') },
};

// [what we scan, text the feedback must contain]
const STEPS = [
  ['WO-0001', 'Scan your worker badge first'],
  ['EMP-06', 'Hello Test Picker'],
  ['WO-0001', 'ready for the rack'],
  [PICK, 'still has older nets'],               // FIFO: never rack-in on top of older nets
  ['2F', '20 nets in'],                          // bulk goes to the second floor
  ['CMD-OUT', 'OUT mode on'],
  [BACKUP, 'is a backup box'],                   // pickers never pick from a backup box
  [PICK, 'Enter the quantity'],
  ['3', 'now 17 in total'],
  [PICK, 'Enter the quantity'],
  ['50', 'Only 17 on hand'],                     // cannot ship more than we have
  ['CMD-EMPTY', 'EMPTY mode on'],
  [PICK, 'marked empty'],
  ['CMD-SWAP', 'SWAP mode on'],
  [BACKUP, 'Swap:'],                              // backup comes down into the pick box
  ['CMD-REFILL', 'REFILL mode on'],
  [PICK, 'is not empty'],                        // FIFO: never pour new nets on top
  [BACKUP, 'take batch WO-0001'],                // refill takes the oldest second-floor batch
  ['CMD-EMPTY', 'EMPTY mode on'],
  [PICK, 'marked empty'],
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
  ['50', 'more than this box can hold'],
  ['18', 'AR-C4-R3: 18 counted'],
  [BACKUP, 'Count the nets'],
  ['0', 'AR-C4-R6: 0 counted'],
  [BIN, 'color 1 of 3'],                         // 3-bin box: one number per color
  ['4', 'color 2 of 3'],
  ['3', 'color 3 of 3'],
  ['2', 'AR-C4-R1: 2 counted'],
  ['@tap', '[data-undo]', 'Tap why'],
  ['@tap', '[data-why="Wrong number"]', 'Undone:'],
  ['2F', 'Second floor'],
  ['@floor', 'Black', 'Count the nets'],
  ['5', 'on the second floor: 5 counted'],
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
  expect('box count: ' + Object.keys(S.counts).sort().join(' '), Object.keys(S.counts).sort().join(' ') === ['2F|' + NET, BACKUP + '|' + NET, BIN + '|DN-185x100-BK', BIN + '|DN-185x100-BR', PICK + '|' + NET].sort().join(' '));

  // the manager applies the box count on the Stock page; a change needs a reason
  await page.evaluate(() => { location.hash = 'stock'; });
  await page.click('#bcOpen');
  await page.click('#bcApply');
  expect('apply without a reason is refused', (await page.textContent('#bcMsg')).includes('Pick a reason first'));
  await page.selectOption('#bcWhy', 'Opening count');
  await page.click('#bcApply');
  S = await st();
  expect('applied: ' + NET + ' is ' + S.stock[NET] + ' (want 23 = 18 + 0 + 5 on 2F)', S.stock[NET] === 23);
  expect('applied: 185x100 Black 4, Brown 3, Grey not counted so unchanged', S.stock['DN-185x100-BK'] === 4 && S.stock['DN-185x100-BR'] === 3 && !S.stock['DN-185x100-GR']);
  expect('box counted 0 is marked empty', (S.boxes[BACKUP] || {}).state === 'empty');
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

  for (const tab of ['dashboard', 'pick', 'batches', 'stock', 'racks', 'refill', 'print', 'log', 'settings']) {
    await page.evaluate((t) => { location.hash = t; }, tab);
    await page.waitForTimeout(150);
  }
  if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }
  else console.log('ok    every tab opens without errors');

  await browser.close();
  console.log(failed ? failed + ' FAILED' : 'All scan tests passed.');
  process.exit(failed ? 1 : 0);
})();
