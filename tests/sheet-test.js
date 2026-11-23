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
    getLastRow: () => { let k = data.length; while (k > 0 && (data[k - 1] || []).every((v) => v === '' || v == null)) k--; return k; }, // like Sheets: last row with content
    getLastColumn: () => data.reduce((a, r) => Math.max(a, r.length), 0),
    appendRow: (row) => { data.length = sh.getLastRow(); data.push(row.slice()); },
    deleteRow: (n) => { data.splice(n - 1, 1); },
    setFrozenRows: () => {},
    setName: (n) => { delete sheets[sh.name]; sh.name = n; sheets[n] = sh; },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues: (v) => { for (let i = 0; i < nr; i++) { while (data.length < r + i) data.push([]); for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } return rng; },
        setValue: (v) => rng.setValues([[v]]),
        setFontWeight: () => rng,
        clearContent: () => { for (let i = 0; i < nr; i++) { const row = data[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return rng; },
      };
      return rng;
    },
  };
  return sh;
}
const sheets = {};
const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
const crypto = require('crypto');
const props = {}, triggers = [];
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
    formatDate: (d, tz, f) => { const x = new Date(d.getTime() + 5.5 * 36e5).toISOString(); return f.replace('yyyy', x.slice(0, 4)).replace('MM', x.slice(5, 7)).replace('dd', x.slice(8, 10)).replace('HH', x.slice(11, 13)).replace('mm', x.slice(14, 16)).replace('ss', x.slice(17, 19)); },
  },
  ContentService: { createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => triggers, newTrigger: (fn) => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) }) },
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
expect('no sign-in: doGet gives nothing but the version', !r.ok && r.auth && r.v === 12 && !r.stock && !r.workers);
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
expect('doGet says version 12', state().v === 12);
expect('setup installs one daily snapshot trigger', triggers.length === 1 && triggers[0].getHandlerFunction() === 'dailySnapshot' && (ctx.setup(), triggers.length === 1));
expect('a version 7 sheet: the Put away tab is renamed In boxes, rows kept', (() => {
  sheets['In boxes'].data.push(['AL-C1-R1', 'DN-185x90-BK', '', 3]); sheets['In boxes'].setName('Put away'); ctx.setup();
  const ok = !!sheets['In boxes'] && !sheets['Put away'] && sheets['In boxes'].data.length === 2;
  sheets['In boxes'].data.splice(1); return ok;
})());

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

// put away (version 7): stock goes up at once, the Put away tab keeps the number per box, adds from two phones add up,
// undo takes only its own nets back off (stock and box number)
const PN = 'DN-190x95-BK';
const before = state().stock[PN] || 0;
post([{ type: 'BOXADD', loc: 'AL-C3-R2', net: PN, netName: '190x95 Black', qty: 1 }]);
post([{ type: 'BOXADD', loc: 'AL-C3-R2', net: PN, qty: 4 }, { type: 'BOXADD', loc: 'TOP', net: PN, qty: 3 }]);
s = state();
const c = (box) => (s.shelf.find((x) => x.box === box && x.net === PN) || {}).qty;
expect('put away: 1 + 4 in the box = 5, 3 on top', c('AL-C3-R2') === 5 && c('TOP') === 3);
expect('put away: stock goes up straight away (+8), no Apply needed', s.stock[PN] === before + 8);
expect('put away does not touch the box count list', !s.counts.some((x) => x.net === PN));
post([{ type: 'UNDO', undoes: 'z', reason: 'Wrong number', net: PN, stock: { [PN]: -7 }, putAdd: { 'AL-C3-R2|DN-190x95-BK': { add: -4, drop: false }, 'TOP|DN-190x95-BK': { add: -3, drop: true } } }]);
s = state();
expect('undo put away: box back to 1, the new TOP row is gone, stock back to +1', c('AL-C3-R2') === 1 && c('TOP') === undefined && s.stock[PN] === before + 1);
post([{ type: 'EMPTY', loc: 'AL-C4-R2' }]);
post([{ type: 'BOXADD', loc: 'AL-C4-R2', net: 'DN-190x95-BN', boxNet: 'DN-190x95-BN', qty: 2 }]);
expect('put away into an empty box marks it as having nets again', state().boxes['AL-C4-R2'].state === 'full');

// ---- number per box (version 8): picks take off, rack-in and returns add, a manager sets a box, box count Apply sets it ----
const BX = 'DN-195x95-BK';
const inb = (box, net) => { const x = get(T.token).shelf.find((y) => y.box === box && y.net === net); return x ? x.qty : undefined; };
post([{ type: 'BOXADD', loc: 'AL-C5-R3', net: BX, qty: 10 }]);
const bx0 = state().stock[BX];
post([{ type: 'OUT', net: BX, qty: 3, loc: 'AL-C5-R3' }]);
expect('a pick from a box takes it off that box and the total', inb('AL-C5-R3', BX) === 7 && state().stock[BX] === bx0 - 3);
post([{ type: 'OUT', net: BX, qty: 9, loc: 'AL-C5-R3' }]);
expect('a box number never goes below 0', inb('AL-C5-R3', BX) === 0);
post([{ type: 'RETURN', net: BX, qty: 2, loc: 'AL-C5-R3' }]);
expect('a return to a box adds to it', inb('AL-C5-R3', BX) === 2);
const sBefore = state().stock[BX];
post([{ type: 'BOXQTY', net: BX, loc: 'AL-C5-R3', qty: 12, reason: 'Found extra nets' }]);
expect('manager sets a box 2 → 12: box 12, total +10, logged with reason', inb('AL-C5-R3', BX) === 12 && state().stock[BX] === sBefore + 10 && /Box change: AL-C5-R3 2 → 12 · reason: Found extra nets/.test(sheets.Scans.data[sheets.Scans.data.length - 1][11]));
post([{ type: 'BOXQTY', net: BX, loc: 'TOP', qty: 4, reason: 'Opening count', upload: 'UP-1' }]);
expect('Excel upload row for TOP: 4 on top, total +4, logged as Excel upload', inb('TOP', BX) === 4 && state().stock[BX] === sBefore + 14 && /Excel upload UP-1/.test(sheets.Scans.data[sheets.Scans.data.length - 1][11]));
r = call({ t: login('EMP-07', '5555').token, events: [{ id: 'wq1', type: 'BOXQTY', net: BX, loc: 'AL-C5-R3', qty: 50, reason: 'x', t: '2026-11-11T09:00:00.000Z' }] });
expect('a worker cannot set a box number', r.refused.length === 1 && inb('AL-C5-R3', BX) === 12);
post([{ type: 'BOXQTY', net: BX, loc: 'AL-C5-R3', qty: 0, reason: 'Counted wrong before', boxState: 'empty' }]);
expect('setting an own box to 0 marks it empty (refill list)', state().boxes['AL-C5-R3'].state === 'empty');
post([{ type: 'BOXCOUNT', loc: 'AL-C5-R3', net: BX, qty: 9 }, { type: 'COUNTDONE', keys: ['AL-C5-R3|' + BX] }]);
expect('box count Apply makes the counted number the box number', inb('AL-C5-R3', BX) === 9 && !state().counts.some((x) => x.net === BX));

// ---- pick lists (version 9): Final takes the whole list off stock once; picks only tick lines and take nets off the box ----
const PK = 'DN-200x90-GR', PK2 = 'DN-200x90-BK', PB = 'BL-C3-R3';
post([{ type: 'BOXADD', loc: PB, net: PK, qty: 10 }, { type: 'BOXADD', loc: 'TOP', net: PK2, qty: 25 }]);
const pk0 = state().stock[PK], pk20 = state().stock[PK2];
r = call({ t: login('EMP-07', '5555').token, events: [{ id: 'plw', type: 'PICKLIST', list: 'PL-W', lines: [{ net: PK, qty: 2 }], t: new Date().toISOString() }] });
expect('a worker cannot make a pick list final', r.refused.length === 1 && state().stock[PK] === pk0);
post([{ id: 'pl1', type: 'PICKLIST', list: 'PL-1', t: new Date().toISOString(), lines: [{ net: PK, netName: '200x90 Grey', qty: 3 }, { net: PK2, qty: 5 }] }]);
s = state();
expect('Final: the whole list comes off stock at once', s.stock[PK] === pk0 - 3 && s.stock[PK2] === pk20 - 5);
expect('Final: the read gives the open list and what went out today', s.picks.filter((x) => x.list === 'PL-1').length === 2 && s.picks.every((x) => x.picked === 0 && x.state === 'open') && s.outToday[PK] === 3);
post([{ id: 'pl1b', type: 'PICKLIST', list: 'PL-1', lines: [{ net: PK, qty: 3 }] }]);
expect('the same list sent again never comes off stock twice', state().stock[PK] === pk0 - 3);
post([{ id: 'pk1', type: 'PICKED', list: 'PL-1', net: PK, qty: 3, loc: PB }]);
s = state();
expect('picker picks the line: ticked, taken off the box, stock not touched again', s.stock[PK] === pk0 - 3 && inb(PB, PK) === 7 && s.picks.find((x) => x.net === PK).picked === 3);
post([{ id: 'pku', type: 'UNDO', undoes: 'pk1', reason: 'Wrong number', net: PK, stock: {}, putAdd: { [PB + '|' + PK]: { add: 3, drop: false } }, picks: { ['PL-1|' + PK]: -3 } }]);
expect('undo of a pick: line not ticked, nets back in the box, stock unchanged', inb(PB, PK) === 10 && state().picks.find((x) => x.net === PK).picked === 0 && state().stock[PK] === pk0 - 3);
post([{ id: 'pk2', type: 'PICKED', list: 'PL-1', net: PK, qty: 3, loc: PB }, { id: 'pk3', type: 'PICKED', list: 'PL-1', net: PK2, qty: 2, loc: 'TOP' }]);
post([{ id: 'pb1', type: 'PICKBACK', list: 'PL-1', net: PK2, qty: 3, restock: true }]);
s = state();
expect('nets not picked go back to stock and off the list; the list is done', s.stock[PK2] === pk20 - 2 && s.picks.filter((x) => x.list === 'PL-1').every((x) => x.state === 'done') && s.picks.find((x) => x.net === PK2).qty === 2);
post([{ id: 'pl2', type: 'PICKLIST', list: 'PL-2', lines: [{ net: PK, qty: 1 }] }, { id: 'pb2', type: 'PICKBACK', list: 'PL-2', net: PK, qty: 1, restock: false }]);
expect('not on the shelf: off the list, stock stays down', state().stock[PK] === pk0 - 4 && state().picks.find((x) => x.list === 'PL-2').state === 'done');

// ---- pick lists version 11: numbers per day, Final also off the boxes, "don't remove", undo Final, picking done ----
const PQ = 'DN-205x90-BR', PQB = 'CR-C2-R3', PQ2 = 'DN-205x90-BK';
post([{ type: 'BOXADD', loc: PQB, net: PQ, qty: 6 }, { type: 'BOXADD', loc: 'TOP', net: PQ, qty: 25 }, { type: 'BOXADD', loc: 'CR-C1-R3', net: PQ2, qty: 4 }]);
const pq0 = state().stock[PQ], pq20 = state().stock[PQ2];
post([{ id: 'pl3', type: 'PICKLIST', list: 'PL-3', boxes: true, t: new Date().toISOString(), t: new Date().toISOString(), lines: [{ net: PQ, qty: 8, note: 'Bring 2 down from the top first', from: [[PQB, 6], ['TOP', 2]] }] }]);
s = state();
const l3 = s.picks.find((x) => x.list === 'PL-3');
expect('Yes: off stock AND off the boxes at Final (6 from the box, 2 from the top)', s.stock[PQ] === pq0 - 8 && inb(PQB, PQ) === 0 && inb('TOP', PQ) === 23 && l3.boxed && l3.from.length === 2);
expect('lists get a number for the day (#2 after PL-1 today) and keep their note', l3.no === 2 && l3.note === 'Bring 2 down from the top first');
post([{ id: 'pk4', type: 'PICKED', list: 'PL-3', net: PQ, qty: 1 }]);
expect('a pick of a list that is already off the box only ticks it', inb(PQB, PQ) === 0 && state().stock[PQ] === pq0 - 8 && state().picks.find((x) => x.list === 'PL-3').picked === 1);
post([{ id: 'pu1', type: 'PICKUNDO', list: 'PL-3' }]);
expect('undo Final refused once something was picked', state().stock[PQ] === pq0 - 8 && state().picks.some((x) => x.list === 'PL-3'));
post([{ id: 'pk4u', type: 'UNDO', undoes: 'pk4', reason: 'Wrong number', net: PQ, stock: {}, picks: { ['PL-3|' + PQ]: -1 } }]);
r = call({ t: login('EMP-07', '5555').token, events: [{ id: 'puw', type: 'PICKUNDO', list: 'PL-3', t: new Date().toISOString() }] });
expect('a worker cannot undo Final', r.refused.length === 1);
post([{ id: 'pu2', type: 'PICKUNDO', list: 'PL-3' }]);
s = state();
expect('manager undoes Final: stock back, nets back in the box and on top, list gone from the read', s.stock[PQ] === pq0 && inb(PQB, PQ) === 6 && inb('TOP', PQ) === 25 && !s.picks.some((x) => x.list === 'PL-3') && !s.outToday[PQ]);
post([{ id: 'pl4', type: 'PICKLIST', list: 'PL-4', boxes: true, t: new Date().toISOString(), lines: [{ net: PQ, qty: 1, from: [[PQB, 1]] }] }]);
expect('after an undo the next list takes the free number again (#2)', state().picks.find((x) => x.list === 'PL-4').no === 2);
post([{ id: 'pb4', type: 'PICKBACK', list: 'PL-4', net: PQ, qty: 1, restock: true, backTo: PQB }]);
expect('not picked, back to stock: back in its box too', state().stock[PQ] === pq0 && inb(PQB, PQ) === 6);
post([{ id: 'pl5', type: 'PICKLIST', list: 'PL-5', keep: true, t: new Date().toISOString(), lines: [{ net: PQ2, qty: 2 }] }]);
s = state();
const l5 = s.picks.find((x) => x.list === 'PL-5');
expect("No, don't remove: the list is made and numbered, stock and box stay", l5 && l5.keep && l5.no === 3 && s.stock[PQ2] === pq20 && inb('CR-C1-R3', PQ2) === 4 && !s.outToday[PQ2]);
post([{ id: 'po5', type: 'OUT', net: PQ2, qty: 2, loc: 'CR-C1-R3' }, { id: 'pk5', type: 'PICKED', list: 'PL-5', net: PQ2, qty: 2 }]);
s = state();
expect('on a kept list the OUT takes it off stock and the box, and ticks the list', s.stock[PQ2] === pq20 - 2 && inb('CR-C1-R3', PQ2) === 2 && s.picks.find((x) => x.list === 'PL-5').state === 'done');
const st5 = JSON.stringify([s.stock, s.shelf]);
post([{ id: 'pd5', type: 'PICKDONE', list: 'PL-5', qty: 2, short: [] }]);
s = state();
expect('picking done: who and when on the list, no number changes', s.picks.find((x) => x.list === 'PL-5').doneBy === 'Test Picker' && !!s.picks.find((x) => x.list === 'PL-5').doneAt && JSON.stringify([s.stock, s.shelf]) === st5);

// ---- top of the racks as full boxes and part boxes (version 10) ----
const TN = 'DN-205x95-GR';
const topRow = () => (get(T.token).shelf.find((y) => y.box === 'TOP' && y.net === TN) || {});
post([{ type: 'BOXADD', loc: 'TOP', net: TN, qty: 50 }]);
expect('an old TOP number with no part boxes is all full boxes (50 = 2 full)', topRow().qty === 50 && !topRow().parts);
post([{ type: 'BOXADD', loc: 'TOP', net: TN, qty: 22, partAdd: [22] }, { type: 'BOXADD', loc: 'TOP', net: TN, qty: 14, partAdd: [14] }]);
expect('IN two part boxes on top: 86 = 2 full + part boxes 22 and 14', topRow().qty === 86 && topRow().parts.join() === '22,14');
const tn0 = state().stock[TN];
post([{ type: 'OUT', net: TN, qty: 22, loc: 'TOP', partDel: [22] }]);
expect('OUT the part box of 22: 64 on top, part box 14 left, stock −22', topRow().qty === 64 && topRow().parts.join() === '14' && state().stock[TN] === tn0 - 22);
post([{ type: 'OUT', net: TN, qty: 3, loc: 'TOP', partAdd: [22] }]);
expect('OUT 3 nets from a full box on top: that box becomes a part box of 22', topRow().qty === 61 && topRow().parts.join() === '14,22');
post([{ id: 'tu1', type: 'UNDO', undoes: 'x', reason: 'Wrong number', net: TN, stock: { [TN]: 3 }, putAdd: { ['TOP|' + TN]: { add: 3, drop: false } }, topParts: { [TN]: { add: [14], del: [14, 22] } } }]);
expect('undo that OUT: 64 on top, part box 14 again', topRow().qty === 64 && topRow().parts.join() === '14');
post([{ type: 'BOXQTY', net: TN, loc: 'TOP', qty: 25 * 20 + 9 + 11, parts: [9, 11], reason: 'Counted wrong before' }]);
expect('manager sets the top: 20 full + part boxes 9 and 11 = 520, total moves by +456', topRow().qty === 520 && topRow().parts.join() === '9,11' && state().stock[TN] === tn0 - 22 + 456 && /Box change: TOP 2 full \+ part 14 = 64 → 20 full \+ part 9, 11 = 520/.test(sheets.Scans.data[sheets.Scans.data.length - 1][11]));
post([{ type: 'BOXQTY', net: TN, loc: 'TOP', qty: 50000, reason: 'Opening count' }]);
expect('no limit on top: 50000 nets is saved, part boxes kept', topRow().qty === 50000 && topRow().parts.join() === '9,11');
post([{ type: 'OUT', net: TN, qty: 49995, loc: 'TOP' }]);
expect('when the top drops below the part boxes, they are fitted to the number on top', topRow().qty === 5 && !topRow().parts);
post([{ type: 'BOXCOUNT', loc: 'TOP', net: TN, qty: 47, parts: [22] }, { type: 'COUNTDONE', keys: ['TOP|' + TN] }]);
expect('box recount of the top with a part box, applied: 47 = 1 full + part 22', topRow().qty === 47 && topRow().parts.join() === '22');
r = call({ t: login('EMP-07', '5555').token, events: [{ id: 'wbc', type: 'BOXCOUNT', loc: 'AL-C1-R1', net: TN, qty: 3, t: '2026-11-11T09:00:00.000Z' }] });
expect('box recount is for managers: a worker\'s is refused', r.refused.length === 1);


// ---- door work orders (version 12): labels per net, Received then Done at every step, rack-in adds stock ----
{
  const WK = login('EMP-07', '5555').token;
  const as = (tok, events) => call({ t: tok, station: 'Test', events });
  const at = (min) => new Date(Date.UTC(2026, 10, 23, 4, 0) + min * 60000).toISOString(); // 23 Nov 2026, 09:30 in India
  const nets = () => sheets['WO nets'].data.slice(1).filter((x) => x[0]);
  const netRow = (code) => nets().find((x) => x[0] === code);
  const WN = 'DN-210x120-BK', WB = 'DN-210x120-BK';
  r = call({ action: 'wocreate', t: WK, req: 'rq0', orders: [{ net: WN, qty: 3 }] });
  expect('work orders: a worker without label printing today cannot make orders', !r.ok && /manager/.test(r.error));
  r = call({ action: 'wocreate', t: T.token, req: 'rq1', orders: [{ net: WN, netName: '210x120 Black', qty: 3, due: at(600) }, { net: 'DN-210x105-GR', qty: 2 }] });
  expect('manager makes 2 orders: WOMQD001 (3 nets) and WOMQD002 (2 nets), one row per net', r.ok && r.orders.map((o) => o.id).join() === 'WOMQD001,WOMQD002' && nets().length === 5 && !!netRow('WOMQD001-01/3') && !!netRow('WOMQD002-02/2'));
  r = call({ action: 'wocreate', t: T.token, req: 'rq1', orders: [{ net: WN, qty: 3 }, { net: 'DN-210x105-GR', qty: 2 }] });
  expect('the same request sent again (lost answer) gives the same orders, never twice', r.ok && r.again && r.orders.length === 2 && sheets['Work orders'].data.length === 3 && nets().length === 5);
  expect('an order has 1 to 1000 nets', !call({ action: 'wocreate', t: T.token, orders: [{ net: WN, qty: 1001 }] }).ok && !call({ action: 'wocreate', t: T.token, orders: [{ net: 'XX', qty: 2 }] }).ok);
  r = as(T.token, [{ id: 'rt1', type: 'WORIGHT', badge: 'EMP-07', on: true, t: at(0) }]);
  expect('manager gives label printing for today; the worker can then make an order (number counts up)', !r.refused.length && (() => { const x = call({ action: 'wocreate', t: WK, req: 'rq2', orders: [{ net: WN, qty: 1 }] }); return x.ok && x.orders[0].id === 'WOMQD003'; })());
  r = as(WK, [{ id: 'rt2', type: 'WORIGHT', badge: 'EMP-07', on: true, t: at(0) }]);
  expect('a worker cannot give label printing', r.refused.length === 1);
  const g0 = get(WK);
  expect('everyone reads the open orders with every net; workers get no numbers per person', g0.v === 12 && g0.wo.orders.length === 3 && g0.wo.orders[0].nets.length === 3 && g0.wo.orders[0].nets[0][2] === 'wait' && g0.wo.daily.length === 0 && g0.wo.rights.me === true);
  const C1 = 'WOMQD001-01/3', C2 = 'WOMQD001-02/3', C3 = 'WOMQD001-03/3';
  r = as(WK, [{ id: 'w-r1', type: 'WOSTEP', code: C1, act: 'RECV', from: [0, 'wait'], t: at(0) }]);
  expect('Cutting received: saved', !r.refused.length && netRow(C1)[5] === 'recv' && netRow(C1)[6] === 'EMP-07');
  r = as(T.token, [{ id: 'w-r1b', type: 'WOSTEP', code: C1, act: 'RECV', from: [0, 'wait'], t: at(1) }]);
  expect('received twice (another phone): refused, says who has it', r.refused.length === 1 && /already received at Cutting by Test Stitcher/.test(r.refused[0].why));
  r = as(WK, [{ id: 'w-r1', type: 'WOSTEP', code: C1, act: 'RECV', from: [0, 'wait'], t: at(0) }]);
  expect('the same scan sent again (offline retry) is applied once, no error', !r.refused.length && sheets.Production.data.filter((x) => x[0] === 'w-r1').length === 1);
  r = as(WK, [{ id: 'w-d2', type: 'WOSTEP', code: C2, act: 'DONE', from: [0, 'recv'], t: at(2) }]);
  expect('a step cannot be skipped: Done before Received is refused', r.refused.length === 1 && /waiting for Cutting/.test(r.refused[0].why));
  r = as(WK, [{ id: 'w-d1', type: 'WOSTEP', code: C1, act: 'DONE', from: [0, 'recv'], t: at(12) }]);
  expect('Cutting done: the net waits for Stitch base, 12 minutes counted for the cutter', !r.refused.length && netRow(C1)[4] === 1 && netRow(C1)[5] === 'wait' && netRow(C1)[12] === 'EMP-07' && sheets.Production.data.find((x) => x[0] === 'w-d1')[9] === 12);
  const d1 = get(T.token).wo.daily.find((x) => x.who === 'EMP-07' && x.step === 'Cutting');
  expect('Production daily: 1 received, 1 done, 12 minutes for that person at Cutting today', d1 && d1.recv === 1 && d1.done === 1 && d1.min === 12 && d1.timed === 1 && d1.day === '2026-11-23');
  r = as(T.token, [{ id: 'rp1', type: 'WOREPRINT', code: C2, label: 2, t: at(13) }]);
  expect('reprint a lost label: the net now has label 2', !r.refused.length && netRow(C2)[9] === 2);
  r = as(WK, [{ id: 'w-old', type: 'WOSTEP', code: C2, act: 'RECV', from: [0, 'wait'], t: at(14) }, { id: 'w-new', type: 'WOSTEP', code: C2 + '-R2', act: 'RECV', from: [0, 'wait'], t: at(14) }]);
  expect('the old label stops working, the new one (-R2) works', r.refused.length === 1 && r.refused[0].id === 'w-old' && /Old label/.test(r.refused[0].why) && netRow(C2)[5] === 'recv');
  as(WK, [{ id: 'w-d2b', type: 'WOSTEP', code: C2 + '-R2', act: 'DONE', from: [0, 'recv'], t: at(20) }, { id: 'w-r2b', type: 'WOSTEP', code: C2 + '-R2', act: 'RECV', from: [1, 'wait'], t: at(21) }]);
  r = as(T.token, [{ id: 'w-bk', type: 'WOSTEP', code: C2 + '-R2', act: 'BACK', to: 0, reason: 'Cut too short', from: [1, 'recv'], t: at(22) }]);
  expect('send back for rework: back at Cutting, rework counted, the cutter gets the rework', !r.refused.length && netRow(C2)[4] === 0 && netRow(C2)[5] === 'wait' && netRow(C2)[11] === 1 && netRow(C2)[12] === '' && get(T.token).wo.daily.find((x) => x.who === 'EMP-07' && x.step === 'Cutting').rework === 1);
  r = as(WK, [{ id: 'w-rj0', type: 'WOSTEP', code: C3, act: 'REJECT', from: [0, 'wait'], t: at(23) }, { id: 'w-rj', type: 'WOSTEP', code: C3, act: 'REJECT', reason: 'Torn', from: [0, 'wait'], t: at(23) }]);
  expect('reject needs a reason; then the net is rejected with it', r.refused.length === 1 && r.refused[0].id === 'w-rj0' && netRow(C3)[5] === 'rejected' && netRow(C3)[17] === 'Torn');
  r = as(WK, [{ id: 'w-bulk', type: 'WOBULK', order: 'WOMQD002', act: 'RECV', step: 0, t: at(30) }]);
  expect('a worker cannot do a whole order at once', r.refused.length === 1);
  r = as(T.token, [{ id: 'm-bulk', type: 'WOBULK', order: 'WOMQD002', act: 'RECV', step: 0, for: 'EMP-07', t: at(30) }, { id: 'm-bulk2', type: 'WOBULK', order: 'WOMQD002', act: 'DONE', step: 0, for: 'EMP-07', t: at(45) }]);
  expect('whole order for an unknown employee number is refused', as(T.token, [{ id: 'm-bad', type: 'WOBULK', order: 'WOMQD002', act: 'RECV', step: 0, for: 'EMP-999', t: at(29) }]).refused.length === 1);
  expect('manager: whole order received and done at Cutting, counted for the person who cut', !r.refused.length && nets().filter((x) => x[1] === 'WOMQD002').every((x) => x[4] === 1 && x[5] === 'wait' && x[12] === 'EMP-07') && get(T.token).wo.daily.find((x) => x.who === 'EMP-07' && x.step === 'Cutting').done === 4);
  expect('the manager is kept as the one who entered it', sheets.Production.data.filter((x) => String(x[0]).indexOf('m-bulk2#') === 0).every((x) => x[2] === 'EMP-07' && x[13] === 'EMP-06'));
  r = as(T.token, [{ id: 'm-set', type: 'WOSET', codes: [C1], step: 5, status: 'wait', reason: 'Test', t: at(50) }]);
  expect('manager fix: the net is put at Rack-in', !r.refused.length && netRow(C1)[4] === 5 && netRow(C1)[5] === 'wait');
  const sk0 = get(T.token).stock[WB] || 0, bx = 'BR-C1-R3', inb0 = (get(T.token).shelf.find((y) => y.box === bx && y.net === WB) || { qty: 0 }).qty;
  r = as(WK, [{ id: 'w-in', type: 'WOSTEP', code: C1, act: 'RACKIN', loc: bx, from: [5, 'wait'], t: at(55) }]);
  let g = get(T.token);
  expect('rack-in: stock +1 and the box +1, like IN, and it shows in the scan log', !r.refused.length && g.stock[WB] === sk0 + 1 && g.shelf.find((y) => y.box === bx && y.net === WB).qty === inb0 + 1 && netRow(C1)[5] === 'racked' && netRow(C1)[8] === bx && sheets.Scans.data.some((x) => x[0] === 'w-in' && x[2] === 'WOIN'));
  r = as(T.token, [{ id: 'm-un', type: 'WOUNDO', undoes: 'w-in', reason: 'Wrong box', t: at(56) }]);
  r = as(WK, [{ id: 'w-un0', type: 'WOUNDO', undoes: 'm-set', reason: 'x', t: at(56) }]);
  expect('a worker cannot undo the manager\'s scan', r.refused.length === 1);
  g = get(T.token);
  expect('undo rack-in: stock and box back, the net waits for Rack-in again', g.stock[WB] === sk0 && g.shelf.find((y) => y.box === bx && y.net === WB).qty === inb0 && netRow(C1)[4] === 5 && netRow(C1)[5] === 'wait' && !!sheets.Production.data.find((x) => x[0] === 'w-in')[17]);
  r = as(WK, [{ id: 'w-un2', type: 'WOUNDO', undoes: 'w-d1', reason: 'Scanned twice', t: at(57) }]);
  expect('a worker cannot undo a scan older than 15 minutes', r.refused.length === 1 && /Too late/.test(r.refused[0].why));
  r = as(T.token, [{ id: 'w-un2m', type: 'WOUNDO', undoes: 'w-d1', reason: 'Scanned twice', t: at(57) }]);
  expect('undo refused when the net has moved on since', r.refused.length === 1 && /moved on/.test(r.refused[0].why));
  const base9 = () => (get(T.token).wo.daily.find((x) => x.who === 'EMP-07' && x.step === 'Stitch base') || { recv: 0 }).recv;
  as(WK, [{ id: 'w-r9', type: 'WOSTEP', code: 'WOMQD002-01/2', act: 'RECV', from: [1, 'wait'], t: at(60) }]);
  const b9 = base9();
  r = as(WK, [{ id: 'w-un9', type: 'WOUNDO', undoes: 'w-r9', reason: 'Wrong net or color', t: at(61) }]);
  expect('undo your own last scan: the net is back, your number goes down', !r.refused.length && netRow('WOMQD002-01/2')[5] === 'wait' && base9() === b9 - 1);
  as(WK, [{ id: 'w-in2', type: 'WOSTEP', code: C1, act: 'RACKIN', loc: 'TOP', from: [5, 'wait'], t: at(62) }]);
  as(T.token, [{ id: 'm-set2', type: 'WOSET', codes: [C2], step: 5, status: 'wait', reason: 'Test', t: at(63) }]);
  as(WK, [{ id: 'w-in3', type: 'WOSTEP', code: C2 + '-R2', act: 'RACKIN', loc: bx, from: [5, 'wait'], t: at(64) }]);
  let o1 = get(T.token).wo.orders.find((o) => o.id === 'WOMQD001');
  expect('order done when every net is on the rack or rejected: 2 racked, 1 rejected', o1.state === 'done' && o1.racked === 2 && o1.rejected === 1 && !!o1.finished);
  as(T.token, [{ id: 'm-back', type: 'WOSET', codes: [C3], step: 0, status: 'wait', reason: 'Fixed', t: at(65) }]);
  o1 = get(T.token).wo.orders.find((o) => o.id === 'WOMQD001');
  expect('a rejected net brought back opens the order again', o1.state === 'open' && o1.rejected === 0 && netRow(C3)[5] === 'wait');
  r = as(T.token, [{ id: 'm-due', type: 'WODUE', order: 'WOMQD002', due: at(90), t: at(66) }]);
  expect('manager sets a due time', !r.refused.length && get(T.token).wo.orders.find((o) => o.id === 'WOMQD002').due === at(90));
  const mo = JSON.parse(ctx.doGet({ parameter: { t: T.token, prod: '2026-11' } }).text), mw = JSON.parse(ctx.doGet({ parameter: { t: WK, prod: '2026-11' } }).text);
  expect('monthly download: managers get the month per person and step, workers do not', mo.ok && mo.daily.some((x) => x.who === 'EMP-07' && x.step === 'Cutting') && !mw.ok);
  // finished long ago: the net rows move to "WO nets done" at night, Production keeps every scan
  as(T.token, [{ id: 'm-rj', type: 'WOSET', codes: [C3], step: 0, status: 'rejected', reason: 'Torn', t: at(67) }]);
  sheets['Work orders'].data.find((x) => x[0] === 'WOMQD001')[8] = new Date(Date.now() - 20 * 864e5);
  const p0 = sheets.Production.data.length;
  ctx.dailySnapshot();
  expect('night: nets of orders finished over 14 days ago move to "WO nets done", Production is kept', !nets().some((x) => x[1] === 'WOMQD001') && sheets['WO nets done'].data.filter((x) => x[1] === 'WOMQD001').length === 3 && sheets.Production.data.length === p0 && nets().length === 3);
  sheets.Snapshots.data.splice(1); // the snapshot tests below start with no copies
}

// ---- daily snapshot and restore ----
ctx.dailySnapshot(); ctx.dailySnapshot();
const days = [...new Set(sheets.Snapshots.data.filter((x) => /^DAY-/.test(x[0])).map((x) => x[0]))];
expect('daily snapshot: one copy per day, running it twice keeps one', days.length === 1);
sheets.Snapshots.data.push(['DAY-20200101', new Date('2020-01-01'), 'Daily copy', 'Stock', '["X",""]']);
ctx.dailySnapshot();
expect('daily copies older than 30 days are removed', !sheets.Snapshots.data.some((x) => x[0] === 'DAY-20200101'));
const dayStock = state().stock[BX];
expect('admin sees the list of copies, a manager does not', get(A.token).snaps.some((x) => x.id === days[0] && x.rows > 0) && get(T.token).snaps.length === 0);
expect('preview of a copy: stock and box numbers (admin only)', (() => { const x = JSON.parse(ctx.doGet({ parameter: { t: A.token, snap: days[0] } }).text); const y = JSON.parse(ctx.doGet({ parameter: { t: T.token, snap: days[0] } }).text); return x.ok && x.stock[BX] === dayStock && x.shelf.some((b) => b.box === 'AL-C5-R3' && b.qty === 9) && !y.ok; })());
post([{ type: 'BOXQTY', net: BX, loc: 'AL-C5-R3', qty: 30, reason: 'Other: test' }]);
r = call({ t: T.token, events: [{ id: 'rsx', type: 'RESTORE', snap: days[0], t: new Date().toISOString() }] });
expect('a manager cannot restore', r.refused.length === 1 && inb('AL-C5-R3', BX) === 30);
r = call({ t: A.token, events: [{ id: 'rs9', type: 'RESTORE', snap: days[0], t: new Date().toISOString(), reason: 'test' }] });
expect('admin restore: stock and box numbers back to the copy', !r.refused.length && state().stock[BX] === dayStock && inb('AL-C5-R3', BX) === 9);
expect('restore saved a copy of before first, and logged it', sheets.Snapshots.data.some((x) => /before-restore$/.test(x[0]) && x[3] === 'In boxes' && JSON.parse(x[4])[3] === 30) && /restored from DAY-/.test(sheets.Scans.data[sheets.Scans.data.length - 1][11]));
r = call({ t: A.token, events: [{ id: 'rs10', type: 'RESTORE', snap: 'NOPE', t: new Date().toISOString() }] });
expect('restore from a copy that does not exist changes nothing', state().stock[BX] === dayStock && /refused/.test(sheets.Scans.data[sheets.Scans.data.length - 1][11]));

// ---- Owner level and reset to zero ----
sheets.Workers.data.find((w) => w[0] === 'EMP-00')[3] = 'Owner';
const O = login('EMP-00', '1234');
expect('the Owner signs in with level Owner', O.ok && O.me.level === 'Owner');
expect('the Owner can still do admin work', call({ action: 'admin', t: O.token, person: { id: 'EMP-07', unlock: true } }).ok);
expect('an admin cannot change the Owner or give the Owner level', (() => {
  sheets.Workers.data.find((w) => w[0] === 'EMP-06')[3] = 'Admin';
  const ad = login('EMP-06', '1234');
  const a1 = call({ action: 'admin', t: ad.token, person: { id: 'EMP-00', level: 'Worker' } }), a2 = call({ action: 'admin', t: ad.token, person: { id: 'EMP-07', level: 'Owner' } });
  sheets.Workers.data.find((w) => w[0] === 'EMP-06')[3] = 'Manager';
  return !a1.ok && !a2.ok;
})());
expect('the Owner cannot remove their own Owner level', !call({ action: 'admin', t: O.token, person: { id: 'EMP-00', level: 'Admin' } }).ok);
const later = (sec) => new Date(Date.now() + 60000 + sec * 1000).toISOString();
r = call({ t: T.token, events: [{ id: 'rs0', type: 'RESET', t: later(0), reason: 'Testing' }] });
expect('a manager cannot reset', r.refused.length === 1 && Object.keys(state().stock).length > 0);
const rowsBefore = ['Stock', 'Boxes', 'Counts', 'In boxes', 'Pick lists'].reduce((a, n) => a + sheets[n].data.length - 1, 0);
const scansBefore = sheets.Scans.data.length;
r = call({ t: O.token, events: [{ id: 'rs1', type: 'RESET', t: later(0), reason: 'Testing' }] });
s = get(O.token);
expect('Owner reset: stock, boxes, waiting counts and put aways are all empty', r.ok && !r.refused.length && Object.keys(s.stock).length === 0 && Object.keys(s.boxes).length === 0 && !s.counts.length && !s.shelf.length && !s.picks.length);
expect('reset: a snapshot of every cleared row is saved first', sheets.Snapshots.data.filter((x) => /^SNAP-\d+-\d+$/.test(x[0])).length === rowsBefore && sheets.Snapshots.data.some((x) => x[3] === 'Stock' && JSON.parse(x[4])[0] === NET));
expect('reset: the scan log is kept, with a Reset line', sheets.Scans.data.length === scansBefore + 1 && /reset to zero · snapshot SNAP-/.test(sheets.Scans.data[sheets.Scans.data.length - 1][11]));
expect('reset: doGet tells phones when the reset was', !!s.resetAt);
r = call({ t: T.token, events: [{ id: 'old1', type: 'OUT', net: NET, qty: 1, t: '2026-11-11T09:00:00.000Z' }, { id: 'old2', type: 'UNDO', undoes: 'ev1', t: later(5), reason: 'x', stock: { [NET]: 5 } }] });
expect('after reset: a scan made before it, and an undo of an old scan, are refused', r.refused.map((x) => x.id).join() === 'old1,old2' && Object.keys(get(O.token).stock).length === 0);
r = call({ t: T.token, events: [{ id: 'new1', type: 'BOXADD', loc: PICK, net: NET, qty: 6, t: later(5) }, { id: 'new2', type: 'BOXADD', loc: PICK, net: NET, qty: 2, t: later(6) }] });
s = get(O.token);
expect('after reset: put away starts again from zero and adds up', !r.refused.length && s.stock[NET] === 8 && s.shelf.length === 1 && s.shelf[0].qty === 8);
const snapN = sheets.Snapshots.data.length;
r = call({ t: O.token, events: [{ id: 'rs2', type: 'RESET', t: later(10), reason: 'Testing again' }] });
expect('reset can be repeated: back to zero again, new snapshot of the 2 rows', Object.keys(get(O.token).stock).length === 0 && sheets.Snapshots.data.length === snapN + 2);

console.log(failed ? failed + ' FAILED' : 'All sheet tests passed.');
process.exit(failed ? 1 : 0);
