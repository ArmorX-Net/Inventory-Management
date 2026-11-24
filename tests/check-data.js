// Quick checks for the ArmorX inventory app. No install needed: run `node tests/check-data.js`.
// Runs on every push (GitHub Actions). If a check fails, the app or the layout data has drifted from the agreed rules.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++; console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

// 1. Every script parses.
for (const f of ['app.js', 'cam.js', 'data/doornets.js', 'data/help.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); check(f + ' parses', true); }
  catch (e) { check(f + ' parses', false, String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')); }
}
try { new vm.Script(read('google-sheet/Code.gs'), { filename: 'Code.gs' }); check('Code.gs parses', true); }
catch (e) { check('Code.gs parses', false, e.message); }

// 2. Layout data (data/doornets.js) follows the agreed plan: v8, one colour per box, racks A-D (owner 22 Nov 2026).
const win = {};
vm.runInNewContext(read('data/doornets.js'), { window: win });
const NETS = win.DOORNETS, BOXES = win.BOXES, SIDES = win.SIDES, RANGES = win.SIDE_RANGES, STAR = win.STAR, MOVES = win.LAYOUT_MOVES || {};
const COLORS = ['Black', 'Brown', 'Grey'];
const sz = (s) => s.split('x').map(Number);
const cmpSize = (a, b) => { const x = sz(a), y = sz(b); return x[0] - y[0] || x[1] - y[1]; };
const byId = {}; NETS.forEach((n) => { byId[n.id] = n; });
const sizes = [...new Set(NETS.map((n) => n.size))];

check('234 doornets', NETS.length === 234, 'found ' + NETS.length);
check('78 sizes', sizes.length === 78, 'found ' + sizes.length);
check('net ids are unique', Object.keys(byId).length === NETS.length);
sizes.forEach((s) => {
  const cs = NETS.filter((n) => n.size === s).map((n) => n.color).sort().join(',');
  check(s + ' has Black, Brown and Grey once each', cs === 'Black,Brown,Grey', cs);
});
check('no sales numbers in the public repo (perDay all 0)', NETS.every((n) => !n.perDay));

const CODE = /^([A-D][LR])-C([1-6])-R([1-5])$/;
const codes = Object.keys(BOXES);
check('240 box slots (4 racks x 2 sides x 6 columns x 5 rows, no R6)', codes.length === 240, 'found ' + codes.length);
codes.forEach((c) => check('location code ' + c + ' looks like AL-C5-R3', CODE.test(c)));
check('sides are AR, AL, BR, BL, CR, CL, DR, DL', JSON.stringify(SIDES) === JSON.stringify(['AR', 'AL', 'BR', 'BL', 'CR', 'CL', 'DR', 'DL']), JSON.stringify(SIDES));

codes.forEach((c) => {
  const b = BOXES[c], m0 = CODE.exec(c), row = m0 ? Number(m0[3]) : 0;
  check(c + ' lists only known nets', b.nets.length > 0 && b.nets.every((id) => byId[id]), JSON.stringify(b.nets));
  check(c + ' holds one size in one colour (no 3-colour boxes)', b.kind === 'own' && b.nets.length === 1, b.kind + ' ' + b.nets.join());
  b.nets.forEach((id) => {
    const n = byId[id]; if (!n) return;
    if (b.role === 'pick') check(c + ' is the pick box of ' + id, n.pick === c, 'net says pick ' + n.pick);
    else check(c + ' is listed as a backup of ' + id, (n.backups || []).includes(c), 'net backups ' + JSON.stringify(n.backups));
  });
});
NETS.forEach((n) => {
  const p = BOXES[n.pick];
  check(n.id + ' pick box ' + n.pick + ' exists and is a PICK box holding it', p && p.role === 'pick' && p.nets.includes(n.id));
  (n.backups || []).forEach((c) => check(n.id + ' backup ' + c + ' exists and is a BACKUP box holding it',
    BOXES[c] && BOXES[c].role === 'backup' && BOXES[c].nets.includes(n.id)));
});

// Sizes in number order: each side's range is in order, and every net sits on the side whose range holds its size.
// Sizes in one number order across racks A-D: each side's range follows the one before, every net sits on the side
// whose range holds its size, and each row holds two sizes (C1-C3, C4-C6), smaller on the left.
for (let i = 1; i < SIDES.length; i++) {
  check('side ' + SIDES[i] + ' range starts after ' + SIDES[i - 1], cmpSize(RANGES[SIDES[i]][0], RANGES[SIDES[i - 1]][1]) > 0);
}
NETS.forEach((n) => {
  const side = n.pick.slice(0, 2), r = RANGES[side];
  const inRange = cmpSize(n.size, r[0]) >= 0 && cmpSize(n.size, r[1]) <= 0;
  check(n.id + ' sits on the side that covers its size', n.size === STAR ? side === 'AR' : inRange, 'pick ' + n.pick + ', side range ' + r.join(' to '));
});
SIDES.forEach((side) => { for (let r = 1; r <= 5; r++) {
  const L = byId[BOXES[side + '-C1-R' + r].nets[0]], R = byId[BOXES[side + '-C4-R' + r].nets[0]];
  if (L.size !== STAR) check(side + ' R' + r + ' smaller size on the left', cmpSize(L.size, R.size) < 0, L.size + ' | ' + R.size);
  [[1, 2, 3], [4, 5, 6]].forEach((cs) => { const ns = cs.map((c) => byId[BOXES[side + '-C' + c + '-R' + r].nets[0]]);
    check(side + ' R' + r + ' C' + cs[0] + '-C' + cs[2] + ' one size in Black, Brown, Grey', ns.every((x) => x.size === ns[0].size) && ns.map((x) => x.color).join() === COLORS.join()); });
} });
// Old boxes: every remembered move goes to the net's home box now, or TOP.
Object.entries(MOVES).forEach(([k, to]) => {
  const [from, id] = k.split('|'), n = byId[id];
  check('move ' + k + ' goes to a home of that net or TOP', n && (to === 'TOP' || [n.pick].concat(n.backups || []).includes(to)) && !(BOXES[from] && BOXES[from].nets.includes(id)), to);
});
// 210x100 keeps 3 boxes per colour: R2, R3 (pick), R4.
COLORS.forEach((col, i) => {
  const n = NETS.find((x) => x.size === STAR && x.color === col);
  check(STAR + ' ' + col + ' backups are R2 and R4', n && JSON.stringify(n.backups) === JSON.stringify(['AR-C' + (i + 1) + '-R2', 'AR-C' + (i + 1) + '-R4']), n && JSON.stringify(n.backups));
});
// 210x100 owns AR C1-C3, one column per color, picked from R3.
COLORS.forEach((col, i) => {
  const n = NETS.find((x) => x.size === STAR && x.color === col);
  check(STAR + ' ' + col + ' is picked from AR-C' + (i + 1) + '-R3', n && n.pick === 'AR-C' + (i + 1) + '-R3', n && n.pick);
});
// Colors left to right: own boxes of one size in one row run Black, Brown, Grey by column.
const rowsOf = {};
codes.forEach((c) => {
  const b = BOXES[c]; if (b.kind !== 'own' || b.role !== 'pick') return;
  const n = byId[b.nets[0]], m = CODE.exec(c); if (!n || !m) return;
  const k = m[1] + '-R' + m[3] + '-' + n.size;
  (rowsOf[k] = rowsOf[k] || []).push([Number(m[2]), COLORS.indexOf(n.color)]);
});
Object.entries(rowsOf).forEach(([k, list]) => {
  list.sort((a, b) => a[0] - b[0]);
  check(k + ' colors run Black, Brown, Grey left to right', list.every((x, i) => i === 0 || x[1] > list[i - 1][1]), JSON.stringify(list));
});

// 3. Secrets stay out of the repo.
check('app.js has no access key filled in', /key:\s*''/.test(read('app.js').split('\n').find((l) => l.includes('var ARMORX_SHEET')) || ''));
const gsKey = /ACCESS_KEY\s*=\s*['"]([^'"]*)['"]/.exec(read('google-sheet/Code.gs'));
check('Code.gs has no real access key', !gsKey || gsKey[1] === '' || /PASTE|CHANGE|YOUR/i.test(gsKey[1]), 'ACCESS_KEY = ' + (gsKey && gsKey[1]));

// 4. Print rule: everything printed is solid black (black-and-white printer).
check('print styles force solid black', /#print-area,#print-area \*\{color:#000 !important;border-color:#000 !important/.test(read('styles.css')));

// 5. App version (owner 24 Nov 2026): phones reload themselves when version.json changes, so one release = one number everywhere.
const appV = (/var APP_V = '([^']+)'/.exec(read('app.js')) || [])[1];
let fileV = null; try { fileV = JSON.parse(read('version.json')).v; } catch (e) {}
check('version.json matches APP_V in app.js', !!appV && fileV === appV, 'app.js ' + appV + ', version.json ' + fileV);
const tags = read('index.html').match(/(?:src|href)="(?!https?:)(?:styles\.css|app\.js|cam\.js|data\/[a-z]+\.js)[^"]*"/g) || [];
check('index.html loads app files with ?v=' + appV, tags.length === 5 && tags.every((t) => t.indexOf('?v=' + appV + '"') > 0), tags.join(' '));
const gsV = Number((/var VERSION = (\d+)/.exec(read('google-sheet/Code.gs')) || [])[1]);
check('app version starts with the Code.gs version', !!appV && Number(appV.split('.')[0]) === gsV, 'app ' + appV + ', Code.gs ' + gsV);

console.log((failures ? failures + ' FAILED, ' : 'All checks passed. ') + passes + ' passed.');
process.exit(failures ? 1 : 0);
