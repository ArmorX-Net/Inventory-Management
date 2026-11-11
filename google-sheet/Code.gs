/**
 * ArmorX Inventory — Google Sheet backend.
 * Paste this into the sheet's Apps Script editor (Extensions → Apps Script), run setup() once,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * The app sends every scan here. This script writes it to the "Scans" tab and keeps
 * "Batches", "Stock" and "Workers" up to date, so every station and every person sees the same numbers.
 *
 * Sign-in (version 5): nobody reads or writes anything without signing in with their employee number and PIN.
 * PINs live in the Workers tab, stored only as a hash. To set a PIN, type 4 digits in the "New PIN" column:
 * the script replaces it with the hash within a minute. Level (Worker, Manager, Admin) and Active (Yes/No)
 * are in the same tab. No PIN, password or key is in this code.
 */

// Version 4 (11 Nov 2026): undo the last scan, reasons on count changes, box count (opening count).
// Version 5 (11 Nov 2026): PIN sign-in, levels, lockout after wrong PINs. The old access key is no longer used.
// Version 6 (11 Nov 2026): put away (BOXADD adds nets to a box count instead of replacing it).
var VERSION = 6;
var SIGNIN_DAYS = 30;       // a phone stays signed in this long
var MAX_TRIES = 5;          // wrong PINs in a row before the badge is locked
var LOCK_MIN = 15;          // first lock; doubles with every further lock, up to one day
var LEVELS = ['Worker', 'Manager', 'Admin'];
// Scan types that need more than Worker level. Everything else (production steps, rack-in, pick, refill,
// empty, swap, returns, box count, undo of your own scan) is open to every signed-in worker.
var NEEDS = { BATCH: 'Manager', COUNT: 'Manager', COUNTDONE: 'Manager', BOXSET: 'Manager', WORKER: 'Admin' };

var STAGES = ['Label printed', 'Cutting', 'Stitching · base', 'Stitching · sides', 'Final finishing', 'Packing', 'On rack'];
var TABS = {
  Scans:   ['Event ID', 'Time', 'Type', 'Worker ID', 'Worker', 'Batch', 'Net ID', 'Net', 'Qty', 'Rejected', 'Box', 'Note', 'Station', 'Reason'],
  Batches: ['Batch', 'Net ID', 'Net', 'Qty', 'Good', 'Current step', 'Step no', 'Created', 'Created by', 'Box',
            'Cutting by', 'Cutting at', 'Base by', 'Base at', 'Sides by', 'Sides at', 'Finish by', 'Finish at', 'Packing by', 'Packing at', 'Rack-in by', 'Rack-in at', 'Rejected total'],
  Stock:   ['Net ID', 'Net', 'On hand', 'Last change', 'Last change at'],
  Workers: ['Badge', 'Name', 'Main step', 'Level', 'Active', 'New PIN', 'PIN hash', 'Wrong tries', 'Locked until', 'Last sign-in'],
  Boxes:   ['Box', 'State', 'Net ID', 'Batch', 'Made', 'Updated', 'By'],
  Counts:  ['Box', 'Net ID', 'Net', 'Qty', 'Counted at', 'By', 'Event ID']
};
// Counts: box count in progress (scan the shelf, type the number). Rows leave this tab when the manager presses Apply in the app.
// Layout v7: every box slot on racks A-C. "empty" boxes are on the refill list; Made drives first made, first shipped.

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else if (sh.getLastColumn() < TABS[name].length) { // a newer version added columns: add their titles
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
    }
  });
  secret_();
  pins_();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  return sh;
}
function rows_(name) {
  var sh = sheet_(name), n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, TABS[name].length).getValues();
}
function findRow_(name, key) {
  var r = rows_(name);
  for (var i = 0; i < r.length; i++) if (String(r[i][0]) === String(key)) return { row: i + 2, values: r[i] };
  return null;
}
function workerName_(id) {
  var w = findRow_('Workers', id);
  return w ? w.values[1] : (id || '');
}

// ---------- sign-in ----------
// Workers columns: 0 Badge, 1 Name, 2 Main step, 3 Level, 4 Active, 5 New PIN, 6 PIN hash, 7 Wrong tries, 8 Locked until, 9 Last sign-in
function secret_() { // random secret for this sheet, kept in Script Properties (never in the code or the sheet)
  var pr = PropertiesService.getScriptProperties(), k = pr.getProperty('SIGNIN_SECRET');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('SIGNIN_SECRET', k); }
  return k;
}
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function pinHash_(badge, pin) {
  return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret_() + '|' + badge + '|' + pin, Utilities.Charset.UTF_8));
}
function badge_(v) { // "78", "emp78", "EMP-078" -> "EMP-78"
  var m = /^(?:EMP)?-?\s*0*(\d{1,4})$/i.exec(String(v || '').trim());
  return m ? 'EMP-' + (m[1].length < 2 ? '0' + m[1] : m[1]) : String(v || '').trim().toUpperCase();
}
function pinText_(v) { // the sheet turns 0123 into 123: put the zeros back
  var t = String(v == null ? '' : v).trim();
  return /^\d{1,4}$/.test(t) ? ('0000' + t).slice(-4) : t;
}
function level_(r) { var l = String(r[3] || '').trim(); return LEVELS.indexOf(l) >= 0 ? l : 'Worker'; }
function active_(r) { return !/^(no|n|false|0|left|off)$/i.test(String(r[4]).trim()); }
function atLeast_(lvl, need) { return LEVELS.indexOf(lvl) >= LEVELS.indexOf(need || 'Worker'); }
// Hash any PIN typed into "New PIN" and clear the plain number. Runs on every read, so it takes effect within a minute.
var BAD_PIN = 'PIN must be 4 digits';
function pins_() {
  var sh = sheet_('Workers'), r = rows_('Workers');
  r.forEach(function (w, i) {
    if (!w[0] || String(w[5]).trim() === '' || String(w[5]) === BAD_PIN) return;
    var pin = pinText_(w[5]);
    if (!/^\d{4}$/.test(pin)) { sh.getRange(i + 2, 6).setValue(BAD_PIN); return; }
    sh.getRange(i + 2, 6, 1, 4).setValues([['', pinHash_(badge_(w[0]), pin), 0, '']]);
    w[5] = ''; w[6] = pinHash_(badge_(w[0]), pin);
  });
}
function sign_(badge, exp, hash) { return b64_(Utilities.computeHmacSha256Signature(badge + '|' + exp + '|' + hash, secret_())); }
// Signed token: badge.expiry.signature. It also signs the PIN hash, so a new PIN signs that person out everywhere.
function token_(badge, hash) { var exp = Date.now() + SIGNIN_DAYS * 864e5; return { t: badge + '.' + exp + '.' + sign_(badge, exp, hash), exp: exp }; }
// Returns the signed-in worker, or null. Checked on every read and write.
function auth_(t) {
  var p = String(t || '').split('.');
  if (p.length !== 3 || !(Number(p[1]) > Date.now())) return null;
  var w = findRow_('Workers', p[0]);
  if (!w || !active_(w.values) || !w.values[6] || sign_(p[0], p[1], w.values[6]) !== p[2]) return null;
  return { id: String(w.values[0]), name: String(w.values[1]), level: level_(w.values), row: w.row, exp: Number(p[1]) };
}
function login_(body) {
  pins_();
  var id = badge_(body.badge), pin = pinText_(body.pin), w = findRow_('Workers', id), nowMs = Date.now();
  var no = { ok: false, auth: true, v: VERSION, error: 'Wrong employee number or PIN.' };
  if (!w) return no;
  var r = w.values, sh = sheet_('Workers');
  if (!active_(r)) return no;
  var until = r[8] ? new Date(r[8]).getTime() : 0;
  if (until > nowMs) return { ok: false, auth: true, v: VERSION, locked: true, error: 'Too many wrong PINs. Try again after ' + Utilities.formatDate(new Date(until), Session.getScriptTimeZone(), 'HH:mm') + ', or ask your manager to unlock you.' };
  if (!r[6] || !/^\d{4}$/.test(pin) || pinHash_(id, pin) !== r[6]) {
    var tries = (Number(r[7]) || 0) + 1, lock = '';
    if (tries % MAX_TRIES === 0) lock = new Date(nowMs + Math.min(LOCK_MIN * Math.pow(2, tries / MAX_TRIES - 1), 1440) * 60000);
    sh.getRange(w.row, 8, 1, 2).setValues([[tries, lock]]);
    if (!r[6]) return { ok: false, auth: true, v: VERSION, error: 'No PIN set for you yet. Ask your manager.' };
    return lock ? { ok: false, auth: true, v: VERSION, locked: true, error: 'Too many wrong PINs. Locked for a while; ask your manager to unlock you.' }
      : { ok: false, auth: true, v: VERSION, error: 'Wrong employee number or PIN. ' + (MAX_TRIES - tries % MAX_TRIES) + ' tries left.' };
  }
  sh.getRange(w.row, 8, 1, 3).setValues([[0, '', new Date()]]);
  var tk = token_(id, r[6]);
  return { ok: true, v: VERSION, token: tk.t, exp: tk.exp, me: { id: id, name: String(r[1]), level: level_(r) } };
}
// Admin: add a person or change name, main step, level, active, PIN, or unlock. One person per call.
function admin_(me, body) {
  if (!atLeast_(me.level, 'Admin')) return { ok: false, error: 'Only an admin can change people.' };
  var p = body.person || {}, id = badge_(p.id);
  if (!/^EMP-\d+$/.test(id)) return { ok: false, error: 'Employee number should look like EMP-78.' };
  var sh = sheet_('Workers'), w = findRow_('Workers', id);
  if (!w) {
    if (!String(p.name || '').trim()) return { ok: false, error: 'Type a name for the new person.' };
    sh.appendRow([id, String(p.name).trim(), p.role || '', LEVELS.indexOf(p.level) >= 0 ? p.level : 'Worker', 'Yes', '', '', 0, '', '']);
    w = findRow_('Workers', id);
  }
  var r = w.values.slice();
  if (p.name != null && String(p.name).trim()) r[1] = String(p.name).trim();
  if (p.role != null) r[2] = p.role;
  if (p.level != null) { if (LEVELS.indexOf(p.level) < 0) return { ok: false, error: 'Level must be Worker, Manager or Admin.' }; r[3] = p.level; }
  if (p.active != null) r[4] = p.active ? 'Yes' : 'No';
  if (id === me.id && (level_(r) !== 'Admin' || !active_(r))) return { ok: false, error: 'You cannot remove your own admin access. Ask another admin.' };
  if (p.pin != null) {
    var pin = pinText_(p.pin);
    if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN must be 4 digits.' };
    r[5] = ''; r[6] = pinHash_(id, pin); r[7] = 0; r[8] = '';
  }
  if (p.unlock) { r[7] = 0; r[8] = ''; }
  sh.getRange(w.row, 1, 1, TABS.Workers.length).setValues([r]);
  return { ok: true };
}
function person_(r, admin) {
  var o = { id: r[0], name: r[1], role: r[2] };
  if (admin) { o.level = level_(r); o.active = active_(r); o.pin = !!r[6]; o.locked = !!(r[8] && new Date(r[8]).getTime() > Date.now()); o.last = iso_(r[9]); }
  return o;
}

// ---------- read: every station pulls the shared state ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  pins_();
  var me = auth_(p.t);
  if (!me) return json_({ ok: false, auth: true, v: VERSION, error: 'Please sign in.' });
  var mgr = atLeast_(me.level, 'Manager'), adm = me.level === 'Admin';
  var stock = {};
  rows_('Stock').forEach(function (r) { stock[r[0]] = Number(r[2]) || 0; });
  var batches = rows_('Batches').map(function (r) {
    var o = { id: r[0], net: r[1], qty: Number(r[3]), good: Number(r[4]), stage: Number(r[6]), created: iso_(r[7]), by: r[8], loc: r[9] || null, steps: [] };
    for (var s = 1; s <= 6; s++) o.steps.push({ by: r[8 + s * 2], at: iso_(r[9 + s * 2]) });
    return o;
  });
  var workers = rows_('Workers').filter(function (r) { return r[0] && (adm || active_(r)); }).map(function (r) { return person_(r, adm); });
  var scans = rows_('Scans');
  if (!mgr) scans = scans.filter(function (r) { return String(r[3]) === me.id; }); // workers see only their own scans
  var log = scans.slice(-300).reverse().map(function (r) {
    return { id: r[0], t: iso_(r[1]), type: r[2], who: r[3], wo: r[5], net: r[6], qty: r[8] === '' ? null : Number(r[8]), loc: r[10], note: r[11] };
  });
  var rates = {};
  var nets = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Nets');
  if (mgr && nets && nets.getLastRow() > 1) nets.getRange(2, 1, nets.getLastRow() - 1, 4).getValues().forEach(function (r) { if (r[0]) rates[r[0]] = Number(r[3]) || 0; });
  var boxes = {};
  rows_('Boxes').forEach(function (r) { if (r[0]) boxes[r[0]] = { state: r[1] || 'full', net: r[2] || '', wo: r[3] || '', made: iso_(r[4]) || null, at: iso_(r[5]), by: r[6] || '' }; });
  var counts = rows_('Counts').filter(function (r) { return r[0] && r[1]; }).map(function (r) { return { box: String(r[0]), net: String(r[1]), qty: Number(r[3]) || 0, at: iso_(r[4]), by: r[5] }; });
  return json_({ ok: true, v: VERSION, me: { id: me.id, name: me.name, level: me.level, exp: me.exp }, stock: stock, batches: batches, workers: workers, log: log, rates: rates, boxes: boxes, counts: counts, at: new Date().toISOString() });
}
function iso_(v) { return (v && typeof v.getTime === 'function') ? new Date(v.getTime()).toISOString() : (v ? String(v) : ''); }

// ---------- write: the app posts a list of scan events ----------
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad JSON' }); }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'login') return json_(login_(body));
    var me = auth_(body.t);
    if (!me) return json_({ ok: false, auth: true, v: VERSION, error: 'Please sign in.' });
    if (body.action === 'admin') return json_(admin_(me, body));
    var scans = rows_('Scans'), seen = {}, mine = {};
    scans.slice(-2000).forEach(function (r) { seen[r[0]] = true; });
    scans.slice(-500).forEach(function (r) { mine[r[0]] = String(r[3]); });
    var done = [], refused = [];
    (body.events || []).forEach(function (ev) {
      if (!ev || !ev.id) return;
      if (!seen[ev.id]) {
        var why = allowed_(me, ev, mine);
        if (why) { refused.push({ id: ev.id, type: ev.type, why: why }); done.push(ev.id); return; }
        if (ev.type === 'WORKER') ev.by = me.id; else ev.who = me.id; // the name on every scan is the person signed in
        apply_(ev, body.station || ''); seen[ev.id] = true; mine[ev.id] = me.id;
      }
      done.push(ev.id);
    });
    return json_({ ok: true, saved: done, refused: refused });
  } finally {
    lock.releaseLock();
  }
}
// null = allowed, otherwise the reason it is refused
function allowed_(me, ev, mine) {
  var need = NEEDS[ev.type];
  if (need && !atLeast_(me.level, need)) return 'Only a ' + need.toLowerCase() + ' can do ' + ev.type + '.';
  if (ev.type === 'UNDO' && !atLeast_(me.level, 'Manager') && ev.undoes && mine[ev.undoes] !== me.id) return 'You can undo only your own scans.';
  return null;
}

function apply_(ev, station) {
  var t = ev.t ? new Date(ev.t) : new Date();
  if (ev.type === 'WORKER') {
    var w = findRow_('Workers', ev.who);
    if (w) sheet_('Workers').getRange(w.row, 2, 1, 2).setValues([[ev.name, ev.role]]);
    else sheet_('Workers').appendRow([ev.who, ev.name, ev.role, 'Worker', 'Yes', '', '', 0, '', '']);
    return;
  }
  sheet_('Scans').appendRow([ev.id, t, ev.type, ev.who || '', workerName_(ev.who), ev.wo || '', ev.net || '', ev.netName || '',
    ev.qty == null ? '' : ev.qty, ev.rej || '', ev.loc || '', ev.note || '', station, ev.reason || '']);

  if (ev.type === 'BATCH') {
    if (!findRow_('Batches', ev.wo)) {
      var row = [ev.wo, ev.net, ev.netName || '', ev.qty, ev.qty, STAGES[0], 0, t, ev.who || 'Manager', ''];
      for (var i = 0; i < 12; i++) row.push('');
      row.push(0);
      sheet_('Batches').appendRow(row);
    }
  } else if (ev.type === 'STAGE' || ev.type === 'IN') {
    var b = findRow_('Batches', ev.wo);
    if (b) {
      var stage = ev.type === 'IN' ? 6 : Number(ev.stage);
      var sh = sheet_('Batches');
      sh.getRange(b.row, 5, 1, 3).setValues([[ev.qty, STAGES[stage], stage]]);
      sh.getRange(b.row, 9 + stage * 2, 1, 2).setValues([[workerName_(ev.who), t]]);
      if (ev.type === 'IN') sh.getRange(b.row, 10).setValue(ev.loc || '');
      if (ev.rej) sh.getRange(b.row, 23).setValue((Number(b.values[22]) || 0) + Number(ev.rej));
    }
    if (ev.type === 'IN') stock_(ev.net, ev.netName, Number(ev.qty), 'add', 'Rack-in ' + ev.wo, t);
    if (ev.type === 'IN' && ev.loc && ev.loc !== '2F' && ev.loc !== 'TOP') box_(ev.loc, 'full', ev.net, ev.wo, ev.made, t, ev.who);
  } else if (ev.type === 'SWAP') {
    var from = findRow_('Boxes', ev.loc);
    var v = from ? from.values : [ev.loc, 'full', ev.net || '', '', ev.made || ''];
    if (ev.to) box_(ev.to, 'full', v[2], v[3], v[4], t, ev.who);
    box_(ev.loc, 'empty', '', '', '', t, ev.who);
  } else if (ev.type === 'REFILL') {
    box_(ev.loc, 'full', ev.net || '', ev.wo || '', ev.made || '', t, ev.who);
  } else if (ev.type === 'EMPTY') {
    box_(ev.loc, 'empty', '', '', '', t, ev.who);
  } else if (ev.type === 'ADJUST') {
    var b2 = findRow_('Batches', ev.wo);
    if (b2) {
      var sh2 = sheet_('Batches');
      sh2.getRange(b2.row, 5).setValue(ev.qty);
      sh2.getRange(b2.row, 23).setValue((Number(b2.values[22]) || 0) + (Number(ev.rej) || 0));
    }
  } else if (ev.type === 'OUT' || ev.type === 'FBA') {
    stock_(ev.net, ev.netName, -Number(ev.qty), 'add', ev.type, t);
  } else if (ev.type === 'RETURN') {
    stock_(ev.net, ev.netName, Number(ev.qty), 'add', 'Return', t);
  } else if (ev.type === 'COUNT') {
    stock_(ev.net, ev.netName, Number(ev.qty), 'set', 'Count', t);
  } else if (ev.type === 'UNDO') {
    undo_(ev, t);
  } else if (ev.type === 'BOXCOUNT') {
    count_(ev.loc, ev.net, ev.netName, ev.qty, t, ev.who, ev.id);
  } else if (ev.type === 'BOXADD') {
    countAdd_(ev.loc, ev.net, ev.netName, Number(ev.qty) || 0, false, t, ev.who, ev.id);
  } else if (ev.type === 'BOXSET') {
    box_(ev.loc, ev.state || 'full', ev.net, ev.wo, ev.made, t, ev.who);
  } else if (ev.type === 'COUNTDONE') {
    var keys = {}; (ev.keys || []).forEach(function (k) { keys[k] = true; });
    deleteWhere_('Counts', function (r) { return keys[r[0] + '|' + r[1]]; });
  }
  // DAMAGED is only logged: damaged returns do not go back to stock.
}

function stock_(id, name, qty, mode, why, t) {
  var sh = sheet_('Stock'), s = findRow_('Stock', id);
  if (s) {
    var now = mode === 'set' ? qty : (Number(s.values[2]) || 0) + qty;
    sh.getRange(s.row, 3, 1, 3).setValues([[now, why, t]]);
  } else {
    sh.appendRow([id, name || '', mode === 'set' ? qty : qty, why, t]);
  }
}

function box_(loc, state, net, wo, made, t, who) {
  if (!loc) return;
  var sh = sheet_('Boxes'), b = findRow_('Boxes', loc);
  var row = [loc, state, net || '', wo || '', made ? new Date(made) : '', t, workerName_(who)];
  if (b) sh.getRange(b.row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

// Undo: put back exactly what the undone scan changed. The app sends the old values.
function undo_(ev, t) {
  var o = ev.undoes ? findRow_('Scans', ev.undoes) : null;
  if (o && String(o.values[11]).indexOf(' · UNDONE') < 0) sheet_('Scans').getRange(o.row, 12).setValue(String(o.values[11] || '') + ' · UNDONE');
  var st = ev.stock || {};
  Object.keys(st).forEach(function (id) { if (Number(st[id])) stock_(id, id === ev.net ? ev.netName : '', Number(st[id]), 'add', 'Undo', t); });
  var bt = ev.batch;
  if (bt && bt.wo) {
    var b = findRow_('Batches', bt.wo);
    if (b) {
      var sh = sheet_('Batches'), s0 = Number(bt.stage);
      sh.getRange(b.row, 5, 1, 3).setValues([[Number(bt.good), STAGES[s0], s0]]);
      sh.getRange(b.row, 10).setValue(bt.loc || '');
      for (var s = s0 + 1; s <= 6; s++) sh.getRange(b.row, 9 + s * 2, 1, 2).setValues([['', '']]);
      if (Number(bt.rej)) sh.getRange(b.row, 23).setValue(Math.max(0, (Number(b.values[22]) || 0) - Number(bt.rej)));
    }
  }
  var bx = ev.boxes || {};
  Object.keys(bx).forEach(function (c) {
    var r = bx[c];
    if (r) box_(c, r.state || 'full', r.net, r.wo, r.made, t, ev.who);
    else deleteWhere_('Boxes', function (row) { return String(row[0]) === c; });
  });
  var cs = ev.counts || {};
  Object.keys(cs).forEach(function (k) {
    var r = cs[k], p = k.split('|');
    if (r) count_(p[0], p[1], '', r.qty, t, ev.who, ev.id);
    else deleteWhere_('Counts', function (row) { return String(row[0]) === p[0] && String(row[1]) === p[1]; });
  });
  var ca = ev.countsAdd || {}; // undo of a put away: take the nets back off, so adds from other phones are kept
  Object.keys(ca).forEach(function (k) { var p = k.split('|'); countAdd_(p[0], p[1], '', Number(ca[k].add) || 0, !!ca[k].drop, t, ev.who, ev.id); });
}

// Put away: add nets to a box (or TOP) count. Several phones can add to the same box at once.
// drop = the row did not exist before this add, so remove it again when it goes back to 0.
function countAdd_(box, net, name, add, drop, t, who, id) {
  if (!box || !net) return;
  var sh = sheet_('Counts'), r = rows_('Counts');
  for (var i = 0; i < r.length; i++) if (String(r[i][0]) === String(box) && String(r[i][1]) === String(net)) {
    var q = (Number(r[i][3]) || 0) + add;
    if (drop && q <= 0) { sh.deleteRow(i + 2); return; }
    sh.getRange(i + 2, 1, 1, 7).setValues([[box, net, name || r[i][2], Math.max(0, q), t, workerName_(who), id || '']]); return;
  }
  if (add > 0) sh.appendRow([box, net, name || '', add, t, workerName_(who), id || '']);
}

// Box count: one row per box + net (a 3-bin box has one row per color). A new count of the same box replaces the old one.
function count_(box, net, name, qty, t, who, id) {
  if (!box || !net) return;
  var sh = sheet_('Counts'), r = rows_('Counts'), row = [box, net, name || '', Number(qty) || 0, t, workerName_(who), id || ''];
  for (var i = 0; i < r.length; i++) if (String(r[i][0]) === String(box) && String(r[i][1]) === String(net)) {
    if (!name) row[2] = r[i][2];
    sh.getRange(i + 2, 1, 1, row.length).setValues([row]); return;
  }
  sh.appendRow(row);
}

function deleteWhere_(name, test) {
  var sh = sheet_(name), r = rows_(name);
  for (var i = r.length - 1; i >= 0; i--) if (test(r[i])) sh.deleteRow(i + 2);
}
