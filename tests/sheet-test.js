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
const crypto = require('crypto');
const props = {};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, str) => [...crypto.createHash('sha256').update(str, 'utf8').digest()],
    computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v, 'utf8').digest()],
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    formatDate: (d) => d.toISOString().slice(11, 16),
  },
  ContentService: { createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Date, JSON, Math, Number, String, Object,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'google-sheet', 'Code.gs'), 'utf8'), ctx);
ctx.setup();
// the Workers tab as the owner has it: badge, name, main step, level, active, and a PIN typed in "New PIN"
sheets.Workers.data.push(['EMP-06', 'Test Picker', 'Racks & dispatch', 'Manager', 'Yes', 1234]);
sheets.Workers.data.push(['EMP-07', 'Test Stitcher', 'Stitching', 'Worker', 'Yes', 1234]);
sheets.Workers.data.push(['EMP-00', 'Owner', 'Owner', 'Admin', 'Yes', 1234]);
sheets.Workers.data.push(['EMP-09', 'Left Company', 'Packing', 'Worker', 'No', 1234]);

let failed = 0, n = 0;
function expect(name, ok) { if (!ok) failed++; console.log((ok ? 'ok    ' : 'FAIL  ') + name); }
function call(body) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text); }
function login(badge, pin) { return call({ action: 'login', badge, pin }); }
function get(t) { return JSON.parse(ctx.doGet({ parameter: { t } }).text); }

// ---- sign-in ----
let r = get('');
expect('no sign-in: doGet gives nothing but the version', !r.ok && r.auth && r.v === 6 && !r.stock && !r.workers);
r = call({ events: [{ id: 'x0', type: 'OUT', net: 'DN-185x90-BK', qty: 1 }] });
expect('no sign-in: a scan is refused', !r.ok && r.auth && sheets.Scans.data.length === 1);
r = call({ key: 'change-me', events: [{ id: 'x0', type: 'OUT', net: 'DN-185x90-BK', qty: 1 }] });
expect('the old access key no longer opens anything', !r.ok && r.auth);
const T = login('EMP-06', '1234');
expect('right PIN signs in and says name and level', T.ok && T.me.name === 'Test Picker' && T.me.level === 'Manager' && /^EMP-06\.\d+\./.test(T.token));
expect('signed in for 30 days', Math.abs(T.exp - Date.now() - 30 * 864e5) < 60000);
expect('the typed PIN is gone from the sheet, only a hash is kept', sheets.Workers.data.every((w, i) => i === 0 || (w[5] === '' && String(w[6]).length > 20 && String(w[6]) !== '1234')));
expect('employee number can be typed as 6, emp6 or EMP-06', login('6', '1234').ok && login('emp6', '1234').ok);
expect('a PIN the sheet turned into a number still works (0123)', (() => { sheets.Workers.data[3][5] = 123; return login('EMP-00', '0123').ok; })());
sheets.Workers.data[3][5] = 1234;
expect('wrong PIN: refused, says tries left', (() => { const x = login('EMP-07', '9999'); return !x.ok && /4 tries left/.test(x.error); })());
expect('unknown employee: same message, no hint', (() => { const x = login('EMP-55', '1234'); return !x.ok && /Wrong employee number or PIN\.$/.test(x.error); })());
expect('a person marked Active = No cannot sign in', !login('EMP-09', '1234').ok);
for (let i = 0; i < 4; i++) login('EMP-07', '0000');
expect('5 wrong PINs lock the badge, even the right PIN is refused then', (() => { const x = login('EMP-07', '1234'); return !x.ok && x.locked; })());
const A = login('EMP-00', '1234');
expect('admin unlocks and the worker can sign in again', call({ action: 'admin', t: A.token, person: { id: 'EMP-07', unlock: true } }).ok && login('EMP-07', '1234').ok);
const W = login('EMP-07', '1234');
expect('a forged token is refused', !get('EMP-06.' + (Date.now() + 1e9) + '.abc').ok && !get(W.token.replace('EMP-07', 'EMP-06')).ok);
expect('an expired token is refused', (() => { const p = W.token.split('.'); return !get(p[0] + '.' + (Date.now() - 1000) + '.' + p[2]).ok; })());

// ---- levels ----
let s0 = get(W.token);
expect('worker: reads stock and boxes, no sales rates, no PIN data', s0.ok && s0.me.level === 'Worker' && s0.stock && Object.keys(s0.rates).length === 0 && !JSON.stringify(s0).includes(sheets.Workers.data[1][6]) && s0.workers.every((w) => w.level === undefined));
expect('worker list leaves out people who left', !s0.workers.some((w) => w.id === 'EMP-09'));
r = call({ t: W.token, events: [{ id: 'w1', type: 'RETURN', net: 'DN-185x90-BK', qty: 2, who: 'EMP-06' }, { id: 'w2', type: 'COUNT', net: 'DN-185x90-BK', qty: 99 }, { id: 'w3', type: 'BATCH', wo: 'WO-0100', net: 'DN-185x90-BK', qty: 5 }, { id: 'w4', type: 'WORKER', who: 'EMP-07', name: 'Boss', role: 'x' }] });
expect('worker: return saved, count, batch label and worker change refused', r.ok && r.saved.length === 4 && r.refused.map((x) => x.id).join() === 'w2,w3,w4' && get(W.token).stock['DN-185x90-BK'] === 2);
expect('the name on a scan is the person signed in, not what the phone says', sheets.Scans.data.find((x) => x[0] === 'w1')[3] === 'EMP-07');
r = call({ t: T.token, events: [{ id: 'm1', type: 'COUNT', net: 'DN-185x90-BK', qty: 0, reason: 'Counted wrong before' }] });
expect('manager: count saved', r.ok && !r.refused.length && get(T.token).stock['DN-185x90-BK'] === 0);
r = call({ t: W.token, events: [{ id: 'w5', type: 'UNDO', undoes: 'm1', reason: 'Wrong number', net: 'DN-185x90-BK', stock: { 'DN-185x90-BK': 2 } }] });
expect('worker cannot undo someone else\'s scan', r.refused.length === 1 && get(T.token).stock['DN-185x90-BK'] === 0);
expect('manager sees all scans, worker only their own', get(T.token).log.length > get(W.token).log.length && get(W.token).log.every((e) => e.who === 'EMP-07'));
expect('only admin changes people', !call({ action: 'admin', t: T.token, person: { id: 'EMP-07', level: 'Admin' } }).ok);
expect('admin sees level, active, PIN set and lock for each person', get(A.token).workers.some((w) => w.id === 'EMP-09' && w.active === false && w.pin === true));
expect('admin adds a person', call({ action: 'admin', t: A.token, person: { id: '80', name: 'New Person', role: 'Cutting' } }).ok && sheets.Workers.data.some((w) => w[0] === 'EMP-80' && w[3] === 'Worker'));
expect('new person without PIN cannot sign in', /No PIN/.test(login('EMP-80', '1234').error));
expect('admin sets a PIN, the person signs in with it', call({ action: 'admin', t: A.token, person: { id: 'EMP-80', pin: '4821' } }).ok && login('EMP-80', '4821').ok);
expect('a new PIN signs that person out on every phone', call({ action: 'admin', t: A.token, person: { id: 'EMP-07', pin: '5555' } }).ok && !get(W.token).ok && login('EMP-07', '5555').ok);
expect('switching a person off signs them out at once', (() => { const t = login('EMP-80', '4821').token; call({ action: 'admin', t: A.token, person: { id: 'EMP-80', active: false } }); return !get(t).ok; })());
expect('admin cannot remove their own admin access', !call({ action: 'admin', t: A.token, person: { id: 'EMP-00', level: 'Worker' } }).ok);
expect('a bad PIN in New PIN is flagged, not saved', (() => { sheets.Workers.data[2][5] = '12a'; get(A.token); return sheets.Workers.data[2][5] === 'PIN must be 4 digits' && login('EMP-07', '5555').ok; })());
sheets.Workers.data[2][5] = '';

// ---- the scan rules below run as the manager ----
function post(events) {
  const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ t: T.token, station: 'Test', events: events.map((e) => Object.assign({ id: 'ev' + (++n), t: '2026-11-11T09:00:00.000Z', who: 'EMP-06' }, e)) }) } }).text);
  if (!r.ok) throw new Error(r.error);
  if (r.refused.length) throw new Error('refused: ' + JSON.stringify(r.refused));
}
function state() { return get(T.token); }
post([{ type: 'COUNT', net: 'DN-185x90-BK', qty: 0, reason: 'Opening count' }]);
const NET = 'DN-185x90-BK', PICK = 'AR-C4-R3';

// old sheets: setup() adds the new Reason column title
expect('Scans tab has the Reason column', sheets.Scans.data[0][13] === 'Reason');
expect('doGet says version 6', state().v === 6);

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

// rack-in to TOP (extra stock on top of the racks) changes stock but makes no box row
post([{ type: 'BATCH', wo: 'WO-0009', net: NET, qty: 10 }, { type: 'IN', wo: 'WO-0009', net: NET, qty: 10, loc: 'TOP' }]);
s = state();
expect('rack-in to TOP: stock 33, no TOP box row', s.stock[NET] === 33 && !s.boxes.TOP);
post([{ type: 'OUT', net: NET, qty: 10 }]);

// the same event sent twice (phone retry) is applied once
post([{ id: 'dup', type: 'OUT', net: NET, qty: 3 }]);
post([{ id: 'dup', type: 'OUT', net: NET, qty: 3 }]);
expect('a repeated event is applied once', state().stock[NET] === 20);

// put away: adds add up (two phones adding to the same box both count), undo takes only its own nets back off
post([{ type: 'BOXADD', loc: 'AL-C3-R2', net: 'DN-190x95-BK', netName: '190x95 Black', qty: 1 }]);
post([{ type: 'BOXADD', loc: 'AL-C3-R2', net: 'DN-190x95-BK', qty: 4 }, { type: 'BOXADD', loc: 'TOP', net: 'DN-190x95-BK', qty: 3 }]);
s = state();
const c = (box) => (s.counts.find((x) => x.box === box && x.net === 'DN-190x95-BK') || {}).qty;
expect('put away: 1 + 4 in the box = 5, 3 on top', c('AL-C3-R2') === 5 && c('TOP') === 3);
post([{ type: 'UNDO', undoes: 'z', reason: 'Wrong number', stock: {}, countsAdd: { 'AL-C3-R2|DN-190x95-BK': { add: -4, drop: false }, 'TOP|DN-190x95-BK': { add: -3, drop: true } } }]);
s = state();
expect('undo put away: box back to 1, the new TOP row is gone', c('AL-C3-R2') === 1 && c('TOP') === undefined);

console.log(failed ? failed + ' FAILED' : 'All sheet tests passed.');
process.exit(failed ? 1 : 0);
