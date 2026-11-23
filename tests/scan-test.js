// Browser test of the Scan station: drives the real app in headless Chrome and checks the warehouse rules.
// Needs Playwright (`npm i -g playwright` or any machine that has it). Run: `node tests/scan-test.js`.
// It never talks to the Google Sheet: the test starts with no sheet connected and blocks Google requests.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

// 11 Nov 2026: no R6 backup boxes for now; extra stock sits on top of the racks (TOP, old labels 2F still work).
const NET = 'DN-185x90-BK', PICK = 'AR-C4-R3', OLD_R6 = 'AR-C4-R6', SLOW = 'AR-C4-R1'; // 22 Nov 2026: no 3-colour boxes, every box one colour
function batch(id, made) {
  return { id, net: NET, qty: 20, good: 20, stage: 5, created: made, by: 'Manager', history: [{ stage: 0, by: 'Manager', qty: 20, rej: 0, t: made }], loc: null };
}
const STATE = {
  seq: 2, stock: {}, log: [], boxes: {}, demo: false, layout: 'v7', settings: { batchSize: '50x25', noCheck: { 'EMP-06': true } }, // check before saving: off for this tester (tested on its own below)
  workers: [{ id: 'EMP-06', name: 'Test Picker', role: 'Racks & dispatch' }, { id: 'EMP-07', name: 'Test Stitcher', role: 'Stitching' }],
  auth: { t: 'test-token', exp: Date.now() + 864e5, id: 'EMP-06', name: 'Test Picker', level: 'Owner' }, // signed in as the owner (no sheet in this test)
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
  ['CMD-BOXCOUNT', 'BOX RECOUNT mode on'],
  [PICK, 'Count the nets'],
  ['50', 'Check this number'],                   // a very high number asks "Are you sure?" once, never blocked
  ['@tap', '[data-cfm="0"]', 'Not saved'],
  ['18', 'AR-C4-R3: 18 counted'],
  ['AR-C4-R2', 'Count the nets'],
  ['0', 'AR-C4-R2: 0 counted'],                  // an empty box is just 0
  [SLOW, '185x100 Black'],                       // one colour per box: AR R1 C4-C6 = 185x100 Black, Brown, Grey
  ['4', 'AR-C4-R1: 4 counted'],
  ['AR-C5-R1', '185x100 Brown'],
  ['3', 'AR-C5-R1: 3 counted'],
  ['AR-C6-R1', '185x100 Grey'],
  ['2', 'AR-C6-R1: 2 counted'],
  ['@tap', '[data-undo]', 'Tap why'],
  ['@tap', '[data-why="Wrong number"]', 'Undone:'],
  ['TOP', 'Top of racks'],
  ['@floor', 'Black', 'Count the nets'],
  ['@toppart', '5', 'on top of the racks: 1 part box (5) = 5 counted'], // top of the racks: full boxes + part boxes
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
    else if (code === '@toppart') { await page.fill('#btAdd', step[1]); await page.click('#btAddB'); await page.click('#btSave'); code = 'part ' + step[1]; want = step[2]; }
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
  expect('box count: ' + Object.keys(S.counts).sort().join(' '), Object.keys(S.counts).sort().join(' ') === ['TOP|' + NET, 'AR-C4-R2|DN-185x85-BK', SLOW + '|DN-185x100-BK', 'AR-C5-R1|DN-185x100-BR', PICK + '|' + NET].sort().join(' '));

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
  expect('box counted 0 is marked empty', (S.boxes['AR-C4-R2'] || {}).state === 'empty' && S.stock['DN-185x85-BK'] === 0);
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
  const PA = 'DN-210x90-BK', PA_BOX = 'CL-C1-R3';
  const paBefore = (await st()).stock[PA] || 0;
  await scan('CMD-PUTAWAY');
  expect('put away mode asks for the size', (await fbText()).includes('Type the size') && !!(await page.$('#paSize')));
  await page.fill('#paSize', '210 9');
  expect('typing 210 9 lists 210 x 90 and friends', !!(await page.$('[data-pa-size="210x90"]')) && !(await page.$('[data-pa-size="205x90"]')));
  await page.click('[data-pa-size="210x90"]');
  await page.click('[data-pa-net="' + PA + '"]');
  expect('the box shows in big letters with a plain hint', (await page.textContent('.pa-loc')) === PA_BOX && (await page.textContent('.pa-hint')).includes('Rack C · left side · column 1 · row 3'));
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
  expect('the top block shows how many are on top now', (await page.textContent('.pa-top-now')).includes('On top now'));
  await page.click('[data-pa-topfull]');
  expect('box full: Full boxes 1, Put on top = a full box (25) on top', (await st()).shelf['TOP|' + PA].qty === 25 && /full box/.test(await fbText()));
  await page.click('[data-undo]'); await page.click('[data-why="Wrong number"]');
  expect('undo takes the full box back off the top', !(await st()).shelf['TOP|' + PA]);
  await page.fill('#paSize', '2109'); await page.click('[data-pa-size="210x90"]'); await page.click('[data-pa-net="' + PA + '"]');
  await page.fill('#paTopQty', '3'); await page.click('[data-pa-topother]');
  expect('part box: type 3, a part box of 3 on top of the rack', (await fbText()).includes('top of the rack') && (await st()).shelf['TOP|' + PA].qty === 3 && (await st()).shelf['TOP|' + PA].parts.join() === '3');
  await page.click('[data-undo]'); await page.click('[data-why="Wrong number"]');
  S = await st();
  expect('undo takes only the last add back off: box 5, nothing on top', S.shelf[PA_BOX + '|' + PA].qty === 5 && !S.shelf['TOP|' + PA] && !!(await page.$('#paSize')));
  expect('put away goes into stock straight away (+5), not into the box count list', S.stock[PA] === paBefore + 5 && !Object.keys(S.counts).some((k) => k.endsWith('|' + PA)));
  await page.fill('#paSize', '210100'); await page.click('[data-pa-size="210x100"]'); await page.click('[data-pa-net="DN-210x100-BK"]');
  await scan('20');
  await page.click('.pa-same');
  expect('a full box sends the next nets to the next box with room', (await page.textContent('.pa-loc')) === 'AR-C1-R2'); // 210x100: 3 boxes per colour (R2, R3, R4)
  await scan('CMD-CANCEL');
  // OUT: same steps as IN, the nets come out of the box
  expect('IN and OUT are the two big buttons at the bottom', (await page.$$eval('.acts-io .act.io', (a) => a.map((b) => b.textContent).join(','))) === 'IN,OUT');
  const outBefore = (await st()).stock[PA];
  await page.click('[data-act="TAKEOUT"]');
  expect('OUT asks for the size', (await fbText()).includes('OUT') && !!(await page.$('#paSize')));
  await page.fill('#paSize', '2109'); await page.click('[data-pa-size="210x90"]'); await page.click('[data-pa-net="' + PA + '"]');
  expect('OUT shows the box that has the nets', (await page.textContent('.pa-loc')) === PA_BOX && (await page.textContent('.pa-go')).includes('Take it out'));
  await page.click('[data-pa-add="2"]');
  S = await st();
  expect('OUT 2: box 5 -> 3, stock down 2, logged as OUT with the box', (await fbText()).includes('Took out 2') && S.shelf[PA_BOX + '|' + PA].qty === 3 && S.stock[PA] === outBefore - 2 && S.log[0].type === 'OUT' && S.log[0].loc === PA_BOX);
  await page.click('[data-undo]'); await page.click('[data-why="Wrong number"]');
  S = await st();
  expect('undo OUT puts the 2 back in the box and in stock', S.shelf[PA_BOX + '|' + PA].qty === 5 && S.stock[PA] === outBefore && !!(await page.$('#paSize')));
  await page.click('.pa-same'); await page.fill('#paQty', '150'); await page.press('#paQty', 'Enter');
  expect('OUT more than in stock is refused', (await fbText()).includes('in stock') && (await st()).stock[PA] === outBefore);
  await scan('WO-0002');
  expect('scanning a batch label in OUT fills in its size and color', (await fbText()).includes('185') && !!(await page.$('.pa-loc')));
  await scan('CMD-CANCEL');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForTimeout(150);
  expect('dashboard shows the put aways so far', (await page.textContent('#app')).includes('Put away so far'));

  // number per box: the rack map shows it, a manager changes one box with a reason, the total moves by the difference
  await page.evaluate(() => { location.hash = 'racks'; }); await page.waitForSelector('[data-b="' + PA_BOX + '"]');
  expect('rack map tile shows the number in the box', (await page.textContent('[data-b="' + PA_BOX + '"] .q')) === '5');
  await page.click('[data-b="' + PA_BOX + '"]');
  expect('box info marks this box', (await page.textContent('#boxInfo')).includes('this box'));
  const popTxt = await page.textContent('#boxInfo');
  expect('box pop-up: total first, a line per place (pick box, top), adds up, out today, no box pictures', /Total in stock/.test(popTxt) && /Pick box CL-C1-R3/.test(popTxt) && /On top of the racks/.test(popTxt) && /Adds up to/.test(popTxt) && /Out today/.test(popTxt) && /Ready to pick on the racks/.test(popTxt) && !(await page.$('#boxInfo .tb')));
  expect('box pop-up: the lines add up to the total', await page.$eval('#boxInfo', (e) => e.querySelector('.pop-tot b').textContent === e.querySelector('.pl.sum b').textContent));
  let s1 = (await st()).stock[PA];
  await page.click('.pop-edit summary'); await page.fill('#bqQty', '7'); await page.click('#bqSave');
  expect('box change needs a reason', (await page.textContent('#bqMsg')).includes('reason'));
  await page.selectOption('#bqWhy', 'Found extra nets'); await page.click('#bqSave');
  S = await st();
  expect('box change 5 → 7: box 7, total +2, logged with reason', S.shelf[PA_BOX + '|' + PA].qty === 7 && S.stock[PA] === s1 + 2 && S.log[0].type === 'BOXQTY' && S.log[0].reason === 'Found extra nets');
  // a pick from that box takes it off the box too
  await page.evaluate(() => { location.hash = 'scan'; }); await page.waitForSelector('#scanIn');
  await scan('CMD-OUT'); await scan(PA_BOX); await scan('2');
  S = await st();
  expect('a pick from a box takes 2 off that box', S.shelf[PA_BOX + '|' + PA].qty === 5 && S.stock[PA] === s1);
  await scan('CMD-CANCEL');

  // Excel: download, upload with preview, refused rows, save, undo the upload
  await page.evaluate(() => { location.hash = 'stock'; }); await page.waitForSelector('#xlDown');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xlDown')]);
  const xfile = await dl.path();
  expect('Excel download is an .xlsx file', /\.xlsx$/.test(dl.suggestedFilename()) && require('fs').readFileSync(xfile).slice(0, 2).toString() === 'PK');
  await page.setInputFiles('#xlUp', xfile);
  await page.waitForFunction(() => /rows read/.test(document.getElementById('xlMsg').textContent));
  expect('uploading the same file back: no changes', (await page.textContent('#xlMsg')).includes(' 0 changes') && (await page.textContent('#xlPrev')).includes('Nothing to save'));
  const csv = 'Net ID,Size,Color,Box,Box type,In box\n' + PA + ',210x90,Black,' + PA_BOX + ',pick,9\n' + PA + ',210x90,Black,TOP,top,3\nDN-999,x,x,AL-C1-R1,pick,3\n' + PA + ',210x90,Black,AL-C1-R1,pick,4\n' + PA + ',210x90,Black,' + PA_BOX + ',pick,lots\n';
  s1 = (await st()).stock[PA];
  await page.setInputFiles('#xlUp', { name: 'counts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForFunction(() => /rows read/.test(document.getElementById('xlMsg').textContent));
  const pvTxt = await page.textContent('#xlPrev');
  expect('upload preview: 2 changes, unknown net, wrong box and bad number refused', (await page.textContent('#xlMsg')).includes('2 changes') && pvTxt.includes('unknown Net ID') && pvTxt.includes('not a home') && pvTxt.includes('not a whole number'));
  expect('nothing saved before you press Save', (await st()).shelf[PA_BOX + '|' + PA].qty === 5);
  await page.selectOption('#xlWhy', 'Opening count'); await page.click('#xlOk');
  S = await st();
  expect('upload saved: box 9, top 3, total +7, each logged as Excel upload', S.shelf[PA_BOX + '|' + PA].qty === 9 && S.shelf['TOP|' + PA].qty === 3 && S.stock[PA] === s1 + 7 && S.log.filter((e) => e.type === 'BOXQTY' && e.upload).length === 2);
  await page.waitForSelector('#xlUndo'); await page.click('#xlUndo');
  S = await st();
  expect('undo the upload: numbers and total back', S.shelf[PA_BOX + '|' + PA].qty === 5 && S.shelf['TOP|' + PA].qty === 0 && S.stock[PA] === s1);
  await page.setInputFiles('#xlUp', { name: 'top.csv', mimeType: 'text/csv', buffer: Buffer.from('Net ID,Size,Color,Box,Box type,In box\n' + PA + ',210x90,Black,TOP,top,550\n') });
  await page.waitForFunction(() => /rows read/.test(document.getElementById('xlMsg').textContent));
  expect('upload: 550 on top (22 boxes of 25) is accepted, not refused', (await page.textContent('#xlMsg')).includes('1 change') && !(await page.textContent('#xlPrev')).includes('not a whole number'));
  // a real Excel file: compressed, shared strings, the first sheet stored as sheet2.xml
  await page.setInputFiles('#xlUp', path.join(__dirname, 'fixtures', 'excel-deflate.xlsx'));
  await page.waitForFunction(() => /rows read|Could not/.test(document.getElementById('xlMsg').textContent));
  expect('a compressed Excel file from Excel is read (2 changes: box 11, top 2)', (await page.textContent('#xlMsg')).includes('2 changes') && (await page.textContent('#xlPrev')).includes('11'));

  // pick list Final: the whole list comes off stock once; OUT then only ticks it off (and takes it off the box)
  s1 = (await st()).stock[PA];
  await page.evaluate(() => { location.hash = 'pick'; }); await page.waitForSelector('#pIn');
  await page.fill('#pIn', '210x90 Black 2'); await page.click('#pGo'); await page.click('#pFin');
  expect('Final asks: remove all these nets from stock now?', (await page.textContent('#pFinal')).includes('Remove all these nets from stock now?'));
  await page.click('#pYes');
  S = await st();
  const PL = Object.keys(S.picks || {})[0];
  expect('Yes: the list comes off stock and off the box at once (−2), logged once as PICKLIST', S.stock[PA] === s1 - 2 && S.shelf[PA_BOX + '|' + PA].qty === 3 && PL && S.picks[PL].lines[PA].qty === 2 && S.log[0].type === 'PICKLIST' && S.log[0].qty === 2);
  expect('the list has a number with date and time, and 0 of 2 picked', /Pick list #1 · \d+ \w+ · \d+:\d\d [AP]M · 0 of 2 picked/.test(await page.textContent('#pOpen')));
  await page.click('[data-plprint="' + PL + '"]');
  expect('any list prints again, any time, on A4 with its number', /Pick list #1/.test(await page.textContent('#print-area .sheet h3')) && /A4 portrait/.test(await page.textContent('#page-size')));
  await page.evaluate(() => { location.hash = 'scan'; }); await page.waitForSelector('#scanIn');
  await page.click('[data-act="TAKEOUT"]');
  await page.fill('#paSize', '2109'); await page.click('[data-pa-size="210x90"]'); await page.click('[data-pa-net="' + PA + '"]');
  expect('OUT says the net is on the pick list, already off the box', /On the pick list.*off the box/.test(await page.textContent('.pa-pick')));
  await page.click('[data-pa-add="1"]');
  S = await st();
  expect('OUT 1 of a listed net: only ticks the list, box and stock not taken twice', S.stock[PA] === s1 - 2 && S.shelf[PA_BOX + '|' + PA].qty === 3 && S.picks[PL].lines[PA].picked === 1 && S.log[0].type === 'PICKED' && !S.log[0].loc);
  await page.click('[data-undo]'); await page.click('[data-why="Wrong number"]');
  S = await st();
  expect('undo the pick: list back to 0 picked, box and stock unchanged', S.picks[PL].lines[PA].picked === 0 && S.shelf[PA_BOX + '|' + PA].qty === 3 && S.stock[PA] === s1 - 2);
  await page.click('.pa-same'); await page.click('[data-pa-add="1"]');
  await scan('CMD-CANCEL');
  await page.evaluate(() => { location.hash = 'pick'; }); await page.waitForSelector('#pIn');
  expect('the open list shows 1 of 2 picked', (await page.textContent('#pOpen')).includes('1 of 2 picked'));
  await page.click('[data-plback]'); await page.click('[data-plgo="1"]');
  S = await st();
  expect('not picked → back to stock: +1, back in its box, list all picked, logged as PICKBACK', S.stock[PA] === s1 - 1 && S.shelf[PA_BOX + '|' + PA].qty === 4 && S.picks[PL].state === 'done' && S.log[0].type === 'PICKBACK' && S.log[0].restock === true);
  await page.click('[data-pldone="' + PL + '"]');
  S = await st();
  expect('picking done: who and when shows on the list, no number changes', S.picks[PL].doneBy === 'EMP-06' && S.log[0].type === 'PICKDONE' && S.stock[PA] === s1 - 1 && S.shelf[PA_BOX + '|' + PA].qty === 4 && /Picked/.test(await page.textContent('#pOpen')));

  // Final with "No, don't remove": the list is still made (#2), stock stays; OUT then takes it off stock and ticks it
  await page.fill('#pIn', '210x90 Black 1'); await page.click('#pGo'); await page.click('#pFin'); await page.click('#pKeep');
  S = await st();
  const PL2 = Object.keys(S.picks).find((k) => k !== PL);
  expect("No, don't remove: list #2 is made, stock and box not changed", PL2 && S.picks[PL2].off === false && S.picks[PL2].no === 2 && S.stock[PA] === s1 - 1 && S.shelf[PA_BOX + '|' + PA].qty === 4 && S.log[0].type === 'PICKLIST' && S.log[0].keep === true);
  await page.click('[data-plundo="' + PL2 + '"]'); await page.click('[data-plmsg="' + PL2 + '"] [data-plyes="1"]');
  S = await st();
  expect('manager undoes Final: list gone, its lines are back in the box to change, stock unchanged', !S.picks[PL2] && S.log[0].type === 'PICKUNDO' && /210x90 Black 1/.test(await page.inputValue('#pIn')) && S.stock[PA] === s1 - 1);
  await page.click('#pFin'); await page.click('#pKeep');
  S = await st();
  const PL3 = Object.keys(S.picks).find((k) => k !== PL);
  expect('made again after the undo: number 2 again', S.picks[PL3].no === 2);
  await page.evaluate(() => { location.hash = 'scan'; }); await page.waitForSelector('#scanIn');
  await page.click('[data-act="TAKEOUT"]');
  await page.fill('#paSize', '2109'); await page.click('[data-pa-size="210x90"]'); await page.click('[data-pa-net="' + PA + '"]');
  await page.click('[data-pa-add="1"]');
  S = await st();
  expect("OUT of a net on a \"don't remove\" list: off stock and the box, list ticked", S.stock[PA] === s1 - 2 && S.shelf[PA_BOX + '|' + PA].qty === 3 && S.picks[PL3].state === 'done' && S.log[0].type === 'OUT');
  await scan('CMD-CANCEL');

  // shelf labels: size and colour big, box code small, barcode still there
  await page.evaluate(() => { location.hash = 'print'; }); await page.waitForSelector('#prevL .lbl-loc', { state: 'attached' });
  const lbl = await page.$eval('#prevL .lbl-loc', (e) => ({ size: (e.querySelector('.ll-size') || {}).textContent, col: (e.querySelector('.ll-col') || {}).textContent, code: (e.querySelector('.ll-code') || {}).textContent, bars: !!e.querySelector('svg.bc rect, svg.bc path') }));
  expect('shelf label: size and colour big, box code small, barcode', /\d+×\d+/.test(lbl.size || '') && /BLACK|BROWN|GREY/.test(lbl.col || '') && /-C\d-R\d/.test(lbl.code || '') && lbl.bars);

  // reset to zero: owner only, typed confirmation, everything back to 0
  await page.evaluate(() => { location.hash = 'settings'; }); await page.waitForTimeout(150);
  await page.waitForSelector('#rsGo');
  await page.click('#rsGo');
  expect('reset needs RESET typed first', (await page.textContent('#rsMsg')).includes('Type RESET') && Object.keys((await st()).stock).length > 0);
  await page.fill('#rsTxt', 'reset'); await page.fill('#rsWhy', 'testing'); await page.click('#rsGo');
  S = await st();
  expect('owner reset: every net 0, boxes, counts and put aways cleared, log kept with a RESET line', Object.keys(S.stock).length === 0 && !Object.keys(S.boxes).length && !Object.keys(S.shelf).length && !Object.keys(S.counts).length && S.log[0].type === 'RESET' && S.log.length > 5);

  for (const tab of ['dashboard', 'orders', 'production', 'pick', 'batches', 'stock', 'racks', 'refill', 'print', 'log', 'people', 'settings']) {
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
  expect('worker tabs: ' + vis, vis === '#scan #pick #racks #refill #help');
  expect('worker sees only IN and OUT (no Count, no Box recount, no other actions)', (await p2.$$eval('#acts [data-act]', (a) => a.map((b) => b.dataset.act).join())) === 'PUTAWAY,TAKEOUT');
  await p2.fill('#scanIn', 'CMD-BOXCOUNT'); await p2.press('#scanIn', 'Enter');
  expect('worker CMD-BOXCOUNT refused: box recount is for managers', (await p2.textContent('#fb')).includes('for managers'));
  expect('scan station fits a phone screen', (await p2.evaluate(() => document.documentElement.scrollWidth)) <= 390);
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

  // ---- background refresh (every 20 s, and once after opening the app) never wipes what someone is doing (owner, 12 Nov) ----
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push(e.message));
  await p3.clock.install();
  let gets3 = 0, slow = 0;
  await p3.route(/script\.google\.com/, async (r) => {
    const req = r.request();
    if (req.method() === 'POST') { const b = JSON.parse(req.postData() || '{}'); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, saved: (b.events || []).map((e) => e.id), refused: [] }) }); }
    gets3++;
    if (slow) await new Promise((res) => setTimeout(res, slow));
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, v: 8, me: { id: 'EMP-00', name: 'Owner', level: 'Owner' }, stock: { [NET]: gets3 }, batches: [], workers: [{ id: 'EMP-00', name: 'Owner', role: 'Owner', level: 'Owner', active: true, pin: true }, { id: 'EMP-07', name: 'Test Stitcher', role: 'Stitching', level: 'Worker', active: true, pin: true }], log: [], rates: {}, boxes: {}, counts: [], shelf: [], snaps: [], at: new Date().toISOString() }) });
  });
  const own = Object.assign({}, STATE, { settings: { batchSize: '50x25', sheetUrl: 'https://script.google.com/macros/s/TEST/exec' }, auth: { t: 'EMP-00.' + (Date.now() + 864e5) + '.sig', exp: Date.now() + 864e5, id: 'EMP-00', name: 'Owner', level: 'Owner' } });
  await p3.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('armorx-inv-v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(own));
  await p3.goto('file://' + path.join(__dirname, '..', 'index.html') + '#racks');
  await p3.waitForSelector('[data-b="' + PICK + '"]'); await p3.clock.runFor(1000);
  const tick = async () => { await p3.clock.runFor(21000); await p3.waitForTimeout(200); };
  await p3.evaluate(() => { document.getElementById('sides').dataset.mark = '1'; });
  await tick();
  expect('refresh: the rack map redraws with new numbers when nobody is using it', !(await p3.$('#sides[data-mark]')));
  await p3.click('[data-b="' + PICK + '"]'); await p3.click('.pop-edit summary'); await p3.fill('#bqQty', '12');
  await tick();
  expect('refresh: an open box with a typed number stays as it is', (await p3.inputValue('#bqQty')) === '12');
  await p3.evaluate(() => { location.hash = 'stock'; }); await p3.waitForSelector('#cntMode');
  await p3.click('#cntMode'); await p3.fill('#tb tr:first-child [data-k=r]', '7');
  await tick();
  expect('refresh: counts being typed on the Stock page stay', (await p3.inputValue('#tb tr:first-child [data-k=r]')) === '7' && !(await p3.$eval('#cntBar', (e) => e.hidden)));
  await p3.click('#cntCancel');
  await p3.evaluate(() => { location.hash = 'people'; }); await p3.waitForSelector('[data-pin="EMP-07"]');
  await p3.click('[data-pin="EMP-07"]'); await p3.fill('td > .pin-in', '12');
  await tick();
  expect('refresh: a PIN being typed on People stays', (await p3.inputValue('td > .pin-in')) === '12');
  // opening the app on a slow line: the first refresh comes back while the worker is already putting away
  slow = 3000;
  await p3.evaluate(() => { location.hash = 'scan'; }); await p3.reload(); await p3.waitForSelector('#scanIn');
  await p3.fill('#scanIn', 'CMD-PUTAWAY'); await p3.press('#scanIn', 'Enter'); await p3.fill('#paSize', '210 9');
  await p3.clock.runFor(4000); await p3.waitForTimeout(300);
  expect('refresh after opening the app does not throw the scan station back to the start', (await p3.inputValue('#paSize').catch(() => 'GONE')) === '210 9');
  await ctx3.close();

  // printouts: big side sign (one per A4 landscape) and the rack layout sheet
  const p4 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p4.on('pageerror', (e) => errors.push(e.message));
  await p4.route(/google|googleapis|gstatic/, (r) => r.abort());
  await p4.addInitScript((s) => { localStorage.setItem('armorx-inv-v1', s); window.print = () => {}; }, JSON.stringify(STATE));
  await p4.goto('file://' + path.join(__dirname, '..', 'index.html') + '#print'); await p4.waitForSelector('#pR');
  expect('setup labels page fits a phone screen', (await p4.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await p4.selectOption('#sSide', 'AR'); await p4.click('#pSB');
  expect('big side sign prints only the chosen side, on A4 landscape', (await p4.$$eval('#print-area .sign.big', (a) => a.map((e) => e.textContent).join('|'))).startsWith('AR185×80') && (await p4.$$('#print-area .sign')).length === 1 && /A4 landscape/.test(await p4.textContent('#page-size')));
  await p4.selectOption('#sSide', ''); await p4.click('#pS');
  const small = await p4.$$eval('#print-area .sign:not(.big)', (a) => a.map((e) => e.textContent));
  expect('small side signs print all 8 (racks A-D), 3 per A4 portrait', small.length === 8 && /A4 portrait/.test(await p4.textContent('#page-size')));
  await p4.click('#pR');
  const sheets = await p4.$$eval('#print-area .rsheet', (a) => a.map((e) => e.querySelectorAll('tbody td').length + ':' + e.querySelector('.rs-side').textContent));
  expect('side sign DR shows its range', small.some((t) => t.startsWith('DR') && t.includes('215×80') && t.includes('220×80')));
  expect('rack layout prints one page per side with 30 boxes each', sheets.join(',') === 'AR,AL,BR,BL,CR,CL,DR,DL'.split(',').map((x) => '30:' + x).join(','));
  expect('rack layout shows AR C1 R3 as 210x100 Black pick box', await p4.$eval('#print-area .rsheet', (e) => { const td = e.querySelectorAll('tbody tr')[2].querySelectorAll('td')[0]; return /210×100/.test(td.textContent) && /Black/.test(td.textContent) && !/BACKUP/.test(td.textContent); }));
  // labels (owner 23 Nov 2026): every label print asks Small 50x25 or Large 101.6x152.4, one label per page, exact page size
  await p4.click('#pL');
  expect('shelf labels ask: Small or Large', /Small[\s\S]*50 × 25 mm[\s\S]*Large[\s\S]*4 × 6 in, landscape/.test(await p4.textContent('#lblAsk')));
  await p4.click('[data-lsz="L"]');
  expect('Large: page 152.4 x 101.6 mm (landscape), no margins, 30 labels', /size:152.4mm 101.6mm;margin:0/.test(await p4.textContent('#page-size')) && (await p4.$$('#print-area.lbl-L .lbl-loc')).length === 30 && !(await p4.$('#lblAsk')));
  await p4.click('#pC'); await p4.click('[data-lsz="S"]');
  expect('Small: page 50.3 x 25.1 mm (the label template)', /size:50.3mm 25.1mm/.test(await p4.textContent('#page-size')) && !(await p4.$('#print-area.lbl-L')));
  await p4.click('#pW');
  expect('the last choice is remembered on this phone', (await p4.getAttribute('[data-lsz="S"]', 'class')).includes('primary'));
  await p4.click('[data-lsz=""]');
  expect('rack layout has no 3-colour boxes', !(await p4.$$eval('#print-area .rsheet', (a) => a.some((e) => /3 bins/.test(e.textContent)))));
  await p4.close();

  // rack change: a box number left under an old 3-colour box moves to the net's new box, totals unchanged
  const p5 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p5.on('pageerror', (e) => errors.push(e.message));
  await p5.route(/google|googleapis|gstatic/, (r) => r.abort());
  const old = JSON.parse(JSON.stringify(STATE));
  old.shelf = Object.assign({}, old.shelf, { 'AL-C2-R5|DN-185x120-BK': { box: 'AL-C2-R5', net: 'DN-185x120-BK', qty: 6 }, 'AR-C1-R1|DN-210x100-BK': { box: 'AR-C1-R1', net: 'DN-210x100-BK', qty: 15 } });
  old.stock = Object.assign({}, old.stock, { 'DN-185x120-BK': 6, 'DN-210x100-BK': 15 });
  await p5.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('armorx-inv-v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(old));
  await p5.goto('file://' + path.join(__dirname, '..', 'index.html') + '#stock'); await p5.waitForSelector('#mvCard:not([hidden])');
  const mv = await p5.textContent('#mvCard');
  expect('rack change card lists old boxes and their new box', mv.includes('AL-C2-R5') && mv.includes('AL-C4-R5') && mv.includes('AR-C1-R1') && mv.includes('TOP'));
  await p5.click('#mvGo');
  const S5 = await p5.evaluate(() => JSON.parse(localStorage.getItem('armorx-inv-v1')));
  expect('move numbers: new box has them, old box 0, totals unchanged',
    S5.shelf['AL-C4-R5|DN-185x120-BK'].qty === 6 && S5.shelf['AL-C2-R5|DN-185x120-BK'].qty === 0 && S5.stock['DN-185x120-BK'] === 6 &&
    S5.shelf['TOP|DN-210x100-BK'].qty === 15 && S5.shelf['AR-C1-R1|DN-210x100-BK'].qty === 0 && S5.stock['DN-210x100-BK'] === 15);
  expect('move numbers logged as box changes with reason Rack change', S5.log.filter((e) => e.type === 'BOXQTY' && e.reason === 'Rack change').length === 4);
  expect('rack change card is gone once moved', await p5.$eval('#mvCard', (e) => e.hidden));
  await p5.close();

  // help: type a question and the matching answer shows; box codes and sizes answer from the live data; cheat sheet prints on A4
  const p6 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p6.on('pageerror', (e) => errors.push(e.message));
  await p6.route(/google|googleapis|gstatic/, (r) => r.abort());
  const hs = JSON.parse(JSON.stringify(STATE)); hs.auth.level = 'Worker';
  hs.shelf = { 'AL-C5-R3|DN-190x100-BR': { box: 'AL-C5-R3', net: 'DN-190x100-BR', qty: 9 } };
  await p6.addInitScript((s) => { localStorage.setItem('armorx-inv-v1', s); window.print = () => {}; }, JSON.stringify(hs));
  await p6.goto('file://' + path.join(__dirname, '..', 'index.html') + '#help'); await p6.waitForSelector('#hq');
  expect('help page is open to a worker and fits a phone screen', (await p6.isVisible('#tabs a[href="#help"]')) && (await p6.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  const ask = async (q) => { await p6.fill('#hq', q); return p6.$$eval('#hOut details summary', (a) => a.map((e) => e.textContent)); };
  expect('help: "room for 20" finds the box size answer first', /box holds 20/.test((await ask('what does room for 20 mean'))[0] || ''));
  expect('help: "not in a box" answer shows', (await ask('not in a box')).some((x) => /Not in a box/.test(x)));
  expect('help: "how do I undo a mistake" finds undo', /undo/i.test((await ask('how do I undo a mistake'))[0] || ''));
  const boxAns = await ask('al c5 r3'); const boxTxt = await p6.textContent('#hOut details');
  expect('help: a box code tells what is in that box', boxAns[0] === 'Box AL-C5-R3' && /Rack A · left side · column 5 · row 3/.test(boxTxt) && /190x100 Brown/.test(boxTxt) && /in this box 9/.test(boxTxt));
  await ask('210 100 black');
  expect('help: a size shows its boxes', /Size 210x100 Black/.test(await p6.textContent('#hOut summary')) && /AR-C1-R3/.test(await p6.textContent('#hOut details')));
  expect('help: nonsense says no answer found', (await ask('zzqq')).length === 0 && /No answer found/.test(await p6.textContent('#hOut')));
  await p6.click('#hPrint');
  expect('cheat sheet prints on A4 portrait with every section', /A4 portrait/.test(await p6.textContent('#page-size')) && (await p6.$$('#print-area .cheat section')).length === 8);
  await p6.goto('file://' + path.join(__dirname, '..', 'index.html') + '#racks'); await p6.click('[data-b="AL-C5-R3"]');
  expect('rack map box says "holds 20"', /holds 20/.test(await p6.textContent('#boxInfo')));
  await p6.click('#boxInfo a[href^="#help"]'); await p6.waitForSelector('#hq');
  expect('help link from the rack map opens the numbers answer', /numbers mean/.test((await p6.$$eval('#hOut details summary', (a) => a.map((e) => e.textContent)))[0] || ''));
  await p6.close();
  if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }

  // ---- phone: check before saving, "Are you sure?", the "i", top of the racks as full and part boxes, pick list short lines ----
  const p7 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p7.on('pageerror', (e) => errors.push(e.message));
  await p7.route(/google|googleapis|gstatic/, (r) => r.abort());
  const cs = JSON.parse(JSON.stringify(STATE)); cs.settings.noCheck = {};
  cs.stock = { [NET]: 60 }; cs.shelf = { [PICK + '|' + NET]: { box: PICK, net: NET, qty: 13 }, ['TOP|' + NET]: { box: 'TOP', net: NET, qty: 47, parts: [22] } };
  await p7.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('armorx-inv-v1', s); sessionStorage.setItem('seeded', '1'); } window.print = () => {}; }, JSON.stringify(cs));
  await p7.goto('file://' + path.join(__dirname, '..', 'index.html') + '#scan'); await p7.waitForSelector('#scanIn');
  const S7 = () => p7.evaluate(() => JSON.parse(localStorage.getItem('armorx-inv-v1')));
  const top7 = async () => (await S7()).shelf['TOP|' + NET];
  expect('manager sees IN, OUT and Box recount, each with an "i"', (await p7.$$eval('#acts [data-act]', (a) => a.map((b) => b.dataset.act).join())) === 'PUTAWAY,TAKEOUT,BOXCOUNT' && (await p7.$$('#acts .ibtn')).length === 3);
  await p7.click('#acts [data-tip="IN"]');
  expect('the "i" opens three short lines', (await p7.isVisible('#tipPop')) && (await p7.$$('#tipPop .tip-l')).length === 3);
  await p7.click('#tipPop button[data-tipx]');
  expect('OK closes it', await p7.isHidden('#tipPop'));
  expect('check before saving is on by default', await p7.isChecked('#cfmTg'));
  await p7.click('[data-act="TAKEOUT"]'); await p7.fill('#paSize', '18590'); await p7.click('[data-pa-size="185x90"]'); await p7.click('[data-pa-net="' + NET + '"]');
  expect('OUT shows what is on top as boxes', (await p7.textContent('.pa-top-now')).includes('1 full box + 1 part box (22) = 47'));
  await p7.click('[data-pa-add="2"]');
  let cf = (await p7.textContent('.cfm')).replace(/\s+/g, ' ');
  expect('check before saving: shows box 13 → 11 and total 60 → 58, nothing saved yet', /13 → 11/.test(cf) && /60 → 58/.test(cf) && (await S7()).stock[NET] === 60);
  await p7.click('[data-cfm="0"]');
  expect('Back: nothing saved', (await S7()).stock[NET] === 60);
  await p7.click('[data-pa-add="2"]'); await p7.click('[data-cfm="1"]');
  expect('Yes, save: box 11, stock 58', (await S7()).stock[NET] === 58 && (await S7()).shelf[PICK + '|' + NET].qty === 11);
  await p7.click('.pa-same'); await p7.click('[data-pa-toppart="22"]');
  cf = (await p7.textContent('.cfm')).replace(/\s+/g, ' ');
  expect('OUT the part box of 22: check shows the top before and after', cf.includes('1 full box + 1 part box (22) = 47 → 1 full box = 25'));
  await p7.click('[data-cfm="1"]');
  expect('saved: top 25 with no part box, stock 36', (await top7()).qty === 25 && !((await top7()).parts || []).length && (await S7()).stock[NET] === 36);
  await p7.click('[data-undo]'); await p7.click('[data-why="Wrong number"]');
  expect('undo brings the part box of 22 back', (await top7()).qty === 47 && ((await top7()).parts || []).join() === '22' && (await S7()).stock[NET] === 58);
  await p7.click('.pa-same'); await p7.fill('#paTopQty', '3'); await p7.click('[data-pa-topother]'); await p7.click('[data-cfm="1"]');
  expect('OUT 3 nets from the top: the part box of 22 becomes 19', (await top7()).qty === 44 && ((await top7()).parts || []).join() === '19');
  await p7.click('.cfm-tg label');
  expect('check before saving switched off for this person', !(await p7.isChecked('#cfmTg')) && (await S7()).settings.noCheck['EMP-06'] === true);
  await p7.click('[data-act="PUTAWAY"]'); await p7.click('.pa-same');
  await p7.click('[data-pa-add="1"]');
  expect('check off: IN +1 saves at once', !(await p7.$('.cfm')) && (await S7()).shelf[PICK + '|' + NET].qty === 12);
  await p7.click('.pa-same'); await p7.fill('#paQty', '80'); await p7.click('[data-pa-other]');
  expect('a very high number still asks "Are you sure?", even with the check off', /Are you sure/.test(await p7.textContent('.cfm')) && (await S7()).shelf[PICK + '|' + NET].qty === 12);
  await p7.click('[data-cfm="1"]');
  expect('no limit: Yes saves 80 more in the box (92)', (await S7()).shelf[PICK + '|' + NET].qty === 92);
  await p7.click('.pa-same'); await p7.fill('#paTopN', '2'); await p7.click('[data-pa-topfull]');
  await p7.click('.pa-same'); await p7.fill('#paTopQty', '14'); await p7.click('[data-pa-topother]');
  expect('IN on top: 2 full boxes, then a part box of 14: 44 + 50 + 14 = 108', (await top7()).qty === 108 && ((await top7()).parts || []).join() === '19,14');
  expect('scan station fits the phone with the top block open', (await p7.click('.pa-same'), (await p7.evaluate(() => document.documentElement.scrollWidth)) <= 390));
  const stock7 = (await S7()).stock[NET];
  await p7.evaluate(() => { location.hash = 'pick'; }); await p7.waitForSelector('#pIn');
  await p7.fill('#pIn', '185x90 Black 100'); await p7.click('#pGo');
  expect('pick list: 100 wanted, 92 in the box: 8 short, says what is on top', /8 short/.test(await p7.textContent('.pl-short')) && /108/.test(await p7.textContent('.pl-short')));
  await p7.click('#pFin');
  expect('Final asks for a choice on the short line first', /choose Keep, Cut or Remove/.test(await p7.textContent('#pMsg')) && !(await p7.$('#pYes')));
  await p7.click('[data-pchoice="' + NET + '|cut"]');
  expect('cut: the list says 92', /92/.test(await p7.textContent('#pOut')));
  await p7.click('#pFin'); await p7.click('#pYes');
  expect('Final takes 92 off stock (not 100) and off the pick box at once', (await S7()).stock[NET] === stock7 - 92 && (await S7()).shelf[PICK + '|' + NET].qty === 0);
  await p7.evaluate(() => { location.hash = 'racks'; }); await p7.waitForSelector('[data-b="' + PICK + '"]');
  await p7.click('[data-b="' + PICK + '"]'); await p7.click('.pop-edit summary');
  await p7.click('[data-seg="full"]'); await p7.fill('#bqFull', '5');
    expect('manager edit of full boxes: preview shows before → after and the new total', /3 full boxes \+ 2 part boxes \(19, 14\) = 108 → 5 full boxes \+ 2 part boxes \(19, 14\) = 158/.test(await p7.textContent('#bqPrev')));
  await p7.selectOption('#bqWhy', { index: 1 }); await p7.click('#bqSave');
  expect('saved: 5 full boxes on top, part boxes kept', (await top7()).qty === 158 && ((await top7()).parts || []).join() === '19,14');
  await p7.waitForSelector('#boxInfo:not([hidden]) .pop-edit'); await p7.click('.pop-edit summary'); await p7.click('[data-seg="part"]');
  await p7.click('#bqTChips [data-rm="0"]'); await p7.fill('#bqTAdd', '9'); await p7.click('#bqTAddB');
  await p7.selectOption('#bqWhy', { index: 1 }); await p7.click('#bqSave');
  expect('part boxes changed: 19 off, 9 on: 125 + 14 + 9 = 148', (await top7()).qty === 148 && ((await top7()).parts || []).join() === '14,9');
  await p7.waitForSelector('#boxInfo:not([hidden]) .pop-tot');
    expect('the list is already off the box, so the pop-up has no pick list line and still adds up, no warning', !(await p7.$('#boxInfo .pop-warn')) && !/On the pick list/.test(await p7.textContent('#boxInfo')));
  expect('the pop-up lines add up to the total', await p7.$eval('#boxInfo', (e) => e.querySelector('.pop-tot b').textContent === e.querySelector('.pl.sum b').textContent));
  expect('rack pop-up fits the phone', (await p7.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await p7.close();

  // ---- door work orders (owner 23 Nov 2026): make an order, labels, one button per step, rack-in into stock, undo, problems ----
  const p8 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p8.on('pageerror', (e) => errors.push(e.message));
  await p8.route(/google|googleapis|gstatic/, (r) => r.abort());
  const ws = JSON.parse(JSON.stringify(STATE)); ws.stock = {}; ws.shelf = {}; ws.batches = {};
  await p8.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('armorx-inv-v1', s); sessionStorage.setItem('seeded', '1'); } window.print = () => {}; }, JSON.stringify(ws));
  await p8.goto('file://' + path.join(__dirname, '..', 'index.html') + '#orders'); await p8.waitForSelector('#woNew');
  const S8 = () => p8.evaluate(() => JSON.parse(localStorage.getItem('armorx-inv-v1')));
  const WN = 'DN-210x120-BK';
  await p8.fill('#woSize', '210x120'); await p8.selectOption('#woCol', 'Black'); await p8.fill('#woQty', '2'); await p8.click('#woNew button');
  await p8.waitForSelector('#lblAsk'); await p8.click('[data-lsz="S"]');
  const wl = await p8.$$eval('#print-area .lbl-wo', (l) => l.map((e) => ({ net: e.querySelector('.wl-net').textContent, code: e.querySelector('.wl-code').textContent, bars: !!e.querySelector('svg.bc rect, svg.bc path') })));
  expect('work order: 2 labels, one per net: size + colour, barcode, code and date', wl.length === 2 && wl[0].net === '210x120 BLACK' && /^WOMQD001-01\/2\d{6}$/.test(wl[0].code) && wl[0].bars && (await p8.getAttribute('#print-area', 'class')) === 'lbl-S');
  await p8.fill('#woPaste', '210x120 Grey 3, 205x90 BRW 4\nnonsense 5'); await p8.click('#woCheck');
  expect('paste a list: 2 lines read, 1 left out', /Make 2 orders and print 7 labels/.test(await p8.textContent('#woPrev')) && /1 line cannot be read/.test(await p8.textContent('#woPrev')));
  await p8.click('#woGo'); await p8.waitForSelector('#lblAsk'); await p8.click('[data-lsz="S"]');
  expect('the pasted list makes WOMQD002 and WOMQD003', !!(await S8()).wo.orders.WOMQD003 && (await S8()).wo.orders.WOMQD003.qty === 4);
  await p8.evaluate(() => { location.hash = 'scan'; }); await p8.waitForSelector('#scanIn');
  const scan8 = async (c) => { await p8.fill('#scanIn', c); await p8.press('#scanIn', 'Enter'); await p8.waitForTimeout(60); return p8.textContent('#fb'); };
  const C1 = 'WOMQD001-01/2';
  await scan8(C1);
  expect('first-time help: one plain line says what to tap, with an "i"', /Got this net for Cutting\? Tap Received/.test(await p8.textContent('.wo-help')) && !!(await p8.$('.wo-help [data-tip="WORECV"]')));
  expect('a net label shows only its next step: one button, Cutting: received', (await p8.$$('[data-wo]')).length === 1 && (await p8.textContent('[data-wo]')) === 'Cutting: received' && /Waiting for Cutting/.test(await p8.textContent('.wo-now')));
  await p8.click('[data-wo]');
  expect('tap: saved, the card closes, scan the next net', /Cutting: received/.test(await p8.textContent('#fb')) && !(await p8.$('.wo-card')) && (await S8()).wo.orders.WOMQD001.nets[1].st === 'recv');
  await scan8(C1);
  expect('scanned again: now Cutting: done', (await p8.textContent('[data-wo]')) === 'Cutting: done');
  await p8.click('[data-wo]');
  for (let k = 1; k < 5; k++) { await scan8(C1); await p8.click('[data-wo]'); await scan8(C1); await p8.click('[data-wo]'); }
  await scan8(C1);
  const box8 = await p8.textContent('.wo-card .pa-loc');
  expect('rack-in: the app shows the box for the net', box8 === 'CL-C4-R1' && /Scan the box label/.test(await p8.textContent('#fb')));
  expect('a wrong box is refused', /Wrong box/.test(await scan8('AL-C1-R1')) && (await S8()).wo.orders.WOMQD001.nets[1].st === 'wait');
  await scan8(box8);
  let w8 = await S8();
  expect('box scanned: the net is on the rack, stock +1 and the box +1 (like IN)', w8.wo.orders.WOMQD001.nets[1].st === 'racked' && w8.stock[WN] === 1 && w8.shelf[box8 + '|' + WN].qty === 1);
  expect('every person\'s step is kept on the net', w8.wo.orders.WOMQD001.nets[1].db.every((x) => x === 'EMP-06'));
  await p8.click('[data-undo]'); await p8.click('[data-why="Wrong box"]');
  w8 = await S8();
  expect('undo rack-in: stock and box back, the net waits for Rack-in again', w8.stock[WN] === 0 && !w8.shelf[box8 + '|' + WN] && w8.wo.orders.WOMQD001.nets[1].st === 'wait' && w8.wo.orders.WOMQD001.nets[1].step === 5);
  await scan8(C1); await p8.click('[data-wo-box="TOP"]');
  w8 = await S8();
  expect('box full: tap to put it on top of the rack', w8.shelf['TOP|' + WN].qty === 1 && w8.stock[WN] === 1);
  await scan8(C1);
  expect('a net on the rack has nothing more to scan', /On the rack, on top of the rack/.test(await p8.textContent('.wo-now')) && !(await p8.$('[data-wo]')));
  const C2 = 'WOMQD001-02/2';
  await scan8(C2); await p8.click('[data-wo]'); await scan8(C2); await p8.click('[data-wo]'); await scan8(C2);
  await p8.click('[data-wo-prob]');
  expect('problem: reject, or send back to an earlier step', !!(await p8.$('[data-wo-rej]')) && (await p8.$$('[data-wo-back]')).length === 1);
  await p8.click('[data-wo-back="0"]'); await p8.click('[data-why="Cut wrong"]');
  w8 = await S8();
  expect('sent back to Cutting for rework, with the reason', w8.wo.orders.WOMQD001.nets[2].step === 0 && w8.wo.orders.WOMQD001.nets[2].rw === 1 && w8.wo.orders.WOMQD001.nets[2].note === 'Cut wrong');
  await scan8(C2); await p8.click('[data-wo-prob]'); await p8.click('[data-wo-rej]'); await p8.click('[data-why="Torn or damaged"]');
  w8 = await S8();
  expect('rejected: the order is done (1 on the rack, 1 rejected)', w8.wo.orders.WOMQD001.nets[2].st === 'rejected' && w8.wo.orders.WOMQD001.state === 'done');
  await p8.evaluate(() => { location.hash = 'orders'; }); await p8.waitForSelector('#woNew');
  await p8.click('[data-wo-f="all"]'); await p8.click('[data-wo-open="WOMQD001"]');
  await p8.click('[data-wo-rp="2"]'); await p8.waitForSelector('#lblAsk'); await p8.click('[data-lsz="L"]');
  expect('reprint: a new label -R2 on the large roll', /WOMQD001-02\/2-R2/.test(await p8.textContent('#print-area')) && (await p8.getAttribute('#print-area', 'class')) === 'lbl-L');
  await p8.evaluate(() => { location.hash = 'scan'; }); await p8.waitForSelector('#scanIn');
  expect('the old label stops working', /Old label/.test(await scan8(C2)));
  expect('the new label works', /Rejected/.test(await scan8(C2 + '-R2')));
  await p8.evaluate(() => { location.hash = 'orders'; }); await p8.waitForSelector('#woNew'); await p8.click('[data-wo-open="WOMQD003"]');
  await p8.click('[data-wo-bulk="RECV"][data-k="0"]');
  w8 = await S8();
  expect('manager: whole order received at Cutting in one tap', Object.values(w8.wo.orders.WOMQD003.nets).every((x) => x.st === 'recv'));
  expect('work orders page fits the phone', (await p8.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await p8.evaluate(() => { location.hash = 'production'; }); await p8.waitForSelector('.wo-board');
  expect('production page shows where nets pile up (7 at Cutting: 3 waiting, 4 in work)', /^7\s*Cutting\s*3 waiting · 4 in work/.test(await p8.textContent('.wo-col.pile')));
  expect('production page fits the phone', (await p8.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  // delete work orders (owner 23 Nov 2026, v13): see what is in them, a reason, racked nets off stock
  await p8.evaluate(() => { location.hash = 'orders'; }); await p8.waitForSelector('#woNew'); await p8.click('[data-wo-f="all"]');
  const st8 = (await S8()).stock[WN] || 0;
  await p8.check('[data-wo-tick="WOMQD001"]'); await p8.click('#woDelSel');
  const dtx = await p8.textContent('.wo-delc');
  expect('delete: shows where the nets are first (1 on the rack, 1 rejected) and offers to take the racked net off stock', /1 on the rack/.test(dtx) && /1 rejected/.test(dtx) && /Take the 1 racked net off stock/.test(dtx) && await p8.isChecked('#woDelStock'));
  await p8.click('#woDelGo');
  expect('delete: a reason is needed', /Pick why/.test(await p8.textContent('#woDelMsg')) && !!(await S8()).wo.orders.WOMQD001);
  await p8.selectOption('#woDelWhy', 'Test orders'); await p8.click('#woDelGo');
  w8 = await S8();
  expect('delete: the order is gone, the racked net is off stock, and it is sent to the sheet with the reason', !w8.wo.orders.WOMQD001 && (w8.stock[WN] || 0) === st8 - 1 && w8.log.some((e) => e.type === 'WODELETE' && e.orders.join() === 'WOMQD001' && e.reason === 'Test orders' && e.stockOff === true));
  await p8.click('#woDelAll');
  expect('clear all: asks to type DELETE and offers numbers from WOMQD001 again', !!(await p8.$('#woDelType')) && !!(await p8.$('#woDelNo')));
  await p8.selectOption('#woDelWhy', 'Test orders'); await p8.click('#woDelGo');
  expect('clear all: refused until DELETE is typed', /Type DELETE/.test(await p8.textContent('#woDelMsg')));
  await p8.fill('#woDelType', 'delete'); await p8.click('#woDelGo');
  w8 = await S8();
  expect('clear all: no work orders left', Object.keys(w8.wo.orders).length === 0 && w8.log.some((e) => e.type === 'WODELETE' && e.all === true && e.restart === true));
  expect('work orders page with delete fits the phone', (await p8.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await p8.close();
  if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }

  await browser.close();
  console.log(failed ? failed + ' FAILED' : 'All scan tests passed.');
  process.exit(failed ? 1 : 0);
})();
