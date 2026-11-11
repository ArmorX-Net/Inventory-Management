// Browser test of the Scan station: drives the real app in headless Chrome and checks the warehouse rules.
// Needs Playwright (`npm i -g playwright` or any machine that has it). Run: `node tests/scan-test.js`.
// It never talks to the Google Sheet: the test starts with no sheet connected and blocks Google requests.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const NET = 'DN-185x90-BK', PICK = 'AR-C4-R3', BACKUP = 'AR-C4-R6';
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
  for (const [code, want] of STEPS) {
    await page.fill('#scanIn', code);
    await page.press('#scanIn', 'Enter');
    const got = (await page.textContent('#fb')).replace(/\s+/g, ' ').trim();
    const ok = got.includes(want);
    if (!ok) failed++;
    console.log((ok ? 'ok    ' : 'FAIL  ') + code.padEnd(11) + (ok ? want : 'wanted "' + want + '"\n      got    "' + got + '"'));
  }
  const stock = await page.evaluate((n) => JSON.parse(localStorage.getItem('armorx-inv-v1')).stock[n], NET);
  const stockOk = stock === 37; // 20 in, 3 out, 20 in
  if (!stockOk) failed++;
  console.log((stockOk ? 'ok    ' : 'FAIL  ') + 'stock of ' + NET + ' is ' + stock + ' (want 37)');

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
