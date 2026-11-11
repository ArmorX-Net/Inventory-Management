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
for (const f of ['app.js', 'cam.js', 'data/doornets.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); check(f + ' parses', true); }
  catch (e) { check(f + ' parses', false, String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')); }
}
try { new vm.Script(read('google-sheet/Code.gs'), { filename: 'Code.gs' }); check('Code.gs parses', true); }
catch (e) { check('Code.gs parses', false, e.message); }

// 2. Layout data (data/doornets.js) follows the agreed v7 plan.
const win = {};
vm.runInNewContext(read('data/doornets.js'), { window: win });
const NETS = win.DOORNETS, BOXES = win.BOXES, SIDES = win.SIDES, RANGES = win.SIDE_RANGES, STAR = win.STAR;
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

const CODE = /^([A-C][LR])-C([1-6])-R([1-6])$/;
const codes = Object.keys(BOXES);
check('216 box slots (3 racks x 2 sides x 6 columns x 6 rows)', codes.length === 216, 'found ' + codes.length);
codes.forEach((c) => check('location code ' + c + ' looks like AL-C5-R3', CODE.test(c)));
check('sides are AR, AL, BR, BL, CR, CL', JSON.stringify(SIDES) === JSON.stringify(['AR', 'AL', 'BR', 'BL', 'CR', 'CL']), JSON.stringify(SIDES));

codes.forEach((c) => {
  const b = BOXES[c], m0 = CODE.exec(c), row = m0 ? Number(m0[3]) : 0;
  check(c + ' lists only known nets', b.nets.length > 0 && b.nets.every((id) => byId[id]), JSON.stringify(b.nets));
  if (row === 6) check(c + ' (R6) is backup only', b.role === 'backup', 'role ' + b.role);
  if (b.kind === 'own') check(c + ' own box holds one net', b.nets.length === 1);
  if (b.kind === 'bin') {
    const ns = b.nets.map((id) => byId[id]);
    check(c + ' 3-bin box holds one size in Black, Brown, Grey order',
      ns.length === 3 && ns.every((n) => n.size === ns[0].size) && ns.map((n) => n.color).join() === COLORS.join(), b.nets.join());
  }
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
for (let i = 1; i < SIDES.length; i++) {
  check('side ' + SIDES[i] + ' range starts after ' + SIDES[i - 1], cmpSize(RANGES[SIDES[i]][0], RANGES[SIDES[i - 1]][1]) > 0);
}
NETS.forEach((n) => {
  const side = n.pick.slice(0, 2), r = RANGES[side];
  const inRange = cmpSize(n.size, r[0]) >= 0 && cmpSize(n.size, r[1]) <= 0;
  check(n.id + ' sits on the side that covers its size', n.size === STAR ? side === 'AR' : inRange, 'pick ' + n.pick + ', side range ' + r.join(' to '));
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

console.log((failures ? failures + ' FAILED, ' : 'All checks passed. ') + passes + ' passed.');
process.exit(failures ? 1 : 0);
