// Tests google-sheet/Code.gs against a fake Google Sheet in memory. No install needed: `node tests/sheet-test.js`.
// Checks that the sheet (the master copy) gets the same numbers as the app for undo, count reasons and box counts.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- a tiny in-memory SpreadsheetApp: just what Code.gs uses ----
function makeSheet(name) {
  const data = []; // rows of values, row 1 = header
  const sh = {
    name, data,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((a, r) => Math.max(a, r.length), 0),
    appendRow: (row) => { data.push(row.slice()); },
    deleteRow: (n) => { data.splice(n - 1, 1); },
    setFrozenRows: () => {},
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues: (v) => { for (let i = 0; i < nr; i++) { while (data.length < r + i) data.push([]); for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } return rng; },
        setValue: (v) => rng.setValues([[v]]),
        setFontWeight: () => rng,
      };
      return rng;
    },
  };
  return sh;
}
const sheets = {};
const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  ContentService: { createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Date, JSON, Math, Number, String, Object,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheet', 'Code.gs'), 'utf8'), ctx);
vm.runInContext("ACCESS_KEY = 'test-key';", ctx);
ctx.setup();

let failed = 0, n = 0;
function expect(name, ok) { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + name); }
function post(events) {
  const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ key: 'test-key', station: 'Test', events: events.map((e) => Object.assign({ id: 'ev' + (++n), t: '2026-11-11T09:00:00.000Z', who: 'EMP-06' }, e)) }) } }).text);
  if (!r.ok) throw new Error(r.error);
}
function state() { return JSON.parse(ctx.doGet({ parameter: { key: 'test-key' } }).text); }
const NET = 'DN-185x90-BK', PICK = 'AR-C4-R3';

// old sheets: setup() adds the new Reason column title
expect('Scans tab has the Reason column', sheets.Scans.data[0][13] === 'Reason');
expect('doGet says version 4', state().v === 4);

// batch: label, two steps, a reject, then undo the last step
post([{ type: 'BATCH', wo: 'WO-0001', net: NET, qty: 20 }]);
post([{ type: 'STAGE', stage: 1, wo: 'WO-0001', net: NET, qty: 20 }]);
post([{ id: 'stage2', type: 'STAGE', stage: 2, wo: 'WO-0001', net: NET, qty: 20 }, { type: 'ADJUST', wo: 'WO-0001', net: NET, qty: 18, rej: 2 }]);
let b = sheets.Batches.data[1];
expect('batch at step 2 with 18 good and 2 rejected', b[6] === 2 && b[4] === 18 && b[22] === 2);
post([{ type: 'UNDO', undoes: 'stage2', reason: 'Scanned twice', note: 'Undo', batch: { wo: 'WO-0001', stage: 1, good: 20, loc: '', rej: 2 }, stock: {} }]);
b = sheets.Batches.data[1];
expect('undo step: back to step 1, 20 good, 0 rejected, step 2 name cleared', b[6] === 1 && b[4] === 20 && b[22] === 0 && b[12] === '' && b[13] === '');
expect('undone scan is marked UNDONE in Scans', sheets.Scans.data.some((r) => r[0] === 'stage2' && / · UNDONE/.test(r[11])));
expect('undo row keeps its reason', sheets.Scans.data.some((r) => r[2] === 'UNDO' && r[13] === 'Scanned twice'));

// rack-in to a box, then undo: stock, batch and box all go back
post([{ type: 'STAGE', stage: 2, wo: 'WO-0001', net: NET, qty: 20 }, { type: 'STAGE', stage: 3, wo: 'WO-0001', net: NET, qty: 20 }, { type: 'STAGE', stage: 4, wo: 'WO-0001', net: NET, qty: 20 }, { type: 'STAGE', stage: 5, wo: 'WO-0001', net: NET, qty: 20 }]);
post([{ id: 'in1', type: 'IN', wo: 'WO-0001', net: NET, qty: 20, loc: PICK, made: '2026-11-01T08:00:00.000Z' }]);
let s = state();
expect('rack-in: stock 20, box full, batch on rack', s.stock[NET] === 20 && s.boxes[PICK].state === 'full' && s.batches[0].stage === 6);
post([{ type: 'UNDO', undoes: 'in1', reason: 'Wrong box', net: NET, stock: { [NET]: -20 }, batch: { wo: 'WO-0001', stage: 5, good: 20, loc: '', rej: 0 }, boxes: { [PICK]: null } }]);
s = state();
expect('undo rack-in: stock 0, box row gone, batch back at Packing with no box', s.stock[NET] === 0 && !s.boxes[PICK] && s.batches[0].stage === 5 && !s.batches[0].loc && !s.batches[0].steps[5].by);

// count with a reason, and undo it
post([{ type: 'RETURN', net: NET, qty: 10 }]);
post([{ id: 'c1', type: 'COUNT', net: NET, qty: 7, reason: 'Picked without scanning', note: 'Counted (was 10) · reason: Picked without scanning' }]);
expect('count sets stock and saves the reason', state().stock[NET] === 7 && sheets.Scans.data.some((r) => r[0] === 'c1' && r[13] === 'Picked without scanning'));
post([{ type: 'UNDO', undoes: 'c1', reason: 'Wrong number', net: NET, stock: { [NET]: 3 } }]);
expect('undo count: stock back to 10', state().stock[NET] === 10);

// box count: rows per box + net, a recount replaces, undo removes, apply clears
post([{ type: 'BOXCOUNT', loc: PICK, net: NET, netName: '185x90 Black', qty: 18 }, { type: 'BOXCOUNT', loc: '2F', net: NET, qty: 5 }, { type: 'BOXCOUNT', loc: 'AR-C4-R1', net: 'DN-185x100-BK', qty: 4 }]);
post([{ type: 'BOXCOUNT', loc: PICK, net: NET, qty: 17 }]);
s = state();
expect('box count: 3 rows, recount replaced 18 with 17', s.counts.length === 3 && s.counts.find((c) => c.box === PICK).qty === 17 && sheets.Counts.data.find((r) => r[0] === PICK)[2] === '185x90 Black');
post([{ type: 'UNDO', undoes: 'x', reason: 'Wrong number', stock: {}, counts: { 'AR-C4-R1|DN-185x100-BK': null } }]);
post([{ type: 'UNDO', undoes: 'y', reason: 'Wrong number', stock: {}, counts: { [PICK + '|' + NET]: { box: PICK, net: NET, qty: 18 } } }]);
s = state();
expect('undo box count: new box removed, recount back to 18', s.counts.length === 2 && s.counts.find((c) => c.box === PICK).qty === 18);
post([{ type: 'COUNT', net: NET, qty: 23, reason: 'Opening count' }, { type: 'EMPTY', loc: 'AR-C4-R6' }, { type: 'BOXSET', loc: PICK, state: 'full', net: NET }, { type: 'COUNTDONE', keys: [PICK + '|' + NET, '2F|' + NET] }]);
s = state();
expect('apply: stock 23, counts cleared, backup empty, pick box full', s.stock[NET] === 23 && s.counts.length === 0 && s.boxes['AR-C4-R6'].state === 'empty' && s.boxes[PICK].state === 'full');

// the same event sent twice (phone retry) is applied once
post([{ id: 'dup', type: 'OUT', net: NET, qty: 3 }]);
post([{ id: 'dup', type: 'OUT', net: NET, qty: 3 }]);
expect('a repeated event is applied once', state().stock[NET] === 20);

console.log(failed ? failed + ' FAILED' : 'All sheet tests passed.');
process.exit(failed ? 1 : 0);
