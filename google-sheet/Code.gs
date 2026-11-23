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
// Version 7 (11 Nov 2026): put away changes stock straight away ("Put away" tab keeps how many went in each box),
//   Owner level, reset inventory to zero (Owner only, snapshot first, scan log kept).
// Version 8 (11 Nov 2026): number per box ("In boxes" tab, was "Put away"): change one box's number, Excel upload,
//   picks and rack-ins keep it up to date; daily snapshot (kept 30 days) and restore from any snapshot (Admin).
// Version 9 (22 Nov 2026): pick lists. The manager presses Final on a pick list and the whole list comes off stock at once
//   (PICKLIST, "Pick lists" tab); pickers' scans then only tick the lines off and take the nets off the box (PICKED);
//   nets not picked can go back to stock (PICKBACK). The read also gives how many of each net went out today.
// Version 10 (22 Nov 2026): the top of the racks is kept as full boxes (25 each) and part boxes. "In boxes" and "Counts"
//   get a "Part boxes" column for TOP (e.g. "22,14"); full boxes = (nets on top - part boxes) / 25, so old TOP numbers
//   need no change: they show as full boxes. Box recount (BOXCOUNT) is for managers. No limits on any number.
// Version 11 (23 Nov 2026): pick lists get a number for the day (#1, #2 ...). Final can keep stock as it is ("No, don't remove":
//   Stock column "kept"; the pickers' OUT takes the nets off). A manager can undo Final before anything is picked (PICKUNDO:
//   nets back to stock, the list is marked "undone"). A picker confirms "Picking done" (PICKDONE: Done by / Done at, no number changes).
//   "Yes, remove from stock" now also takes the nets off the boxes at Final (Stock column "boxes", From = which boxes, e.g.
//   "AR-C3-R5:1,TOP:2"), so the box numbers go down at once; the pickers' OUT then only ticks the list. Older lists ("off") work as before.
// Version 12 (23 Nov 2026): door work orders (WOMQD). One label per net (WOMQD045-07/20), scanned at every step: Cutting,
//   Stitch base, Stitch sides, Final finishing, Packing (each Received, then Done), then Rack-in (net, then box: adds stock like IN).
//   Tabs "Work orders" (one row per order), "WO nets" (one row per net, where it is now), "Production" (every scan, never deleted)
//   and "Production daily" (per person, per step, per day: the numbers for the managers). Reject, send back for rework,
//   manager fixes and whole-order steps, reprint (the old label stops working), due times, label printing rights for the day.
// Version 13 (23 Nov 2026): a manager or the owner deletes work orders: one, the ones ticked, or all (WODELETE, reason needed).
//   The order, its nets (labels stop working) and, if chosen, its step history and the people's numbers for it go. Nets already
//   racked in can come off stock and their box again (if chosen). Every deleted row is kept in the "WO deleted" tab first.
// Version 14 (23 Nov 2026): one work order can hold many sizes and colours (e.g. 16 for one FBA shipment). An order has a purpose
//   (Rack, Top, FBA, Bulk buyer, Hold), a comment and an FBA shipment ID or buyer name. After Packing a net is packed, not stock.
//   Its last scan follows where it goes: Rack or Top = scan the box and stock goes up (as before); FBA, Bulk or Hold = "Ready"
//   (READY: kept apart, never in stock), then "Shipped" (SHIP) when it leaves. A manager can move ready nets to the racks
//   (stock goes up then) and change where an order goes (WODEST). New columns: Work orders Purpose, Ref, Lines, Ready, Shipped;
//   WO nets Dest, Ref. Old orders have no purpose: they go to the rack, as before.
var VERSION = 14;
var TOP_BOX = 25;          // a full box on top of the racks holds 25 nets
var SNAP_TABS = ['Stock', 'Boxes', 'Counts', 'In boxes', 'Pick lists']; // what a snapshot copies and a reset or restore replaces
var KEEP_DAYS = 30;          // daily snapshots kept this long
var SIGNIN_DAYS = 30;       // a phone stays signed in this long
var MAX_TRIES = 5;          // wrong PINs in a row before the badge is locked
var LOCK_MIN = 15;          // first lock; doubles with every further lock, up to one day
var LEVELS = ['Worker', 'Manager', 'Admin', 'Owner']; // Owner = the business owner: everything an admin can do, plus reset
// Scan types that need more than Worker level. Everything else (production steps, rack-in, IN, OUT, pick, refill,
// empty, swap, returns, undo of your own scan) is open to every signed-in worker.
var NEEDS = { WODEST: 'Manager', WODELETE: 'Manager', WOBULK: 'Manager', WOSET: 'Manager', WODUE: 'Manager', WORIGHT: 'Manager', BATCH: 'Manager', COUNT: 'Manager', BOXCOUNT: 'Manager', COUNTDONE: 'Manager', PICKLIST: 'Manager', PICKBACK: 'Manager', PICKUNDO: 'Manager', BOXSET: 'Manager', BOXQTY: 'Manager', WORKER: 'Admin', RESTORE: 'Admin', RESET: 'Owner' };

var STAGES = ['Label printed', 'Cutting', 'Stitching · base', 'Stitching · sides', 'Final finishing', 'Packing', 'On rack'];
var TABS = {
  Scans:   ['Event ID', 'Time', 'Type', 'Worker ID', 'Worker', 'Batch', 'Net ID', 'Net', 'Qty', 'Rejected', 'Box', 'Note', 'Station', 'Reason'],
  Batches: ['Batch', 'Net ID', 'Net', 'Qty', 'Good', 'Current step', 'Step no', 'Created', 'Created by', 'Box',
            'Cutting by', 'Cutting at', 'Base by', 'Base at', 'Sides by', 'Sides at', 'Finish by', 'Finish at', 'Packing by', 'Packing at', 'Rack-in by', 'Rack-in at', 'Rejected total'],
  Stock:   ['Net ID', 'Net', 'On hand', 'Last change', 'Last change at'],
  Workers: ['Badge', 'Name', 'Main step', 'Level', 'Active', 'New PIN', 'PIN hash', 'Wrong tries', 'Locked until', 'Last sign-in'],
  Boxes:   ['Box', 'State', 'Net ID', 'Batch', 'Made', 'Updated', 'By'],
  Counts:  ['Box', 'Net ID', 'Net', 'Qty', 'Counted at', 'By', 'Event ID', 'Part boxes'],
  'In boxes': ['Box', 'Net ID', 'Net', 'Qty', 'Updated', 'By', 'Event ID', 'Part boxes'],
  'Pick lists': ['List', 'Net ID', 'Net', 'Qty', 'Picked', 'Created', 'By', 'State', 'Updated', 'No', 'Stock', 'Note', 'Done by', 'Done at', 'From'],
  Snapshots: ['Snapshot', 'Time', 'By', 'Tab', 'Row'],
  'Work orders': ['Order', 'Net ID', 'Net', 'Qty', 'Created', 'By', 'Due', 'State', 'Finished', 'Racked', 'Rejected', 'Note', 'Request', 'Purpose', 'Ref', 'Lines', 'Ready', 'Shipped'],
  'WO nets': ['Code', 'Order', 'No', 'Net ID', 'Step', 'Status', 'Last by', 'Last at', 'Box', 'Label', 'Received at', 'Reworks', 'Cut by', 'Base by', 'Sides by', 'Finish by', 'Pack by', 'Note', 'Dest', 'Ref'],
  'WO nets done': ['Code', 'Order', 'No', 'Net ID', 'Step', 'Status', 'Last by', 'Last at', 'Box', 'Label', 'Received at', 'Reworks', 'Cut by', 'Base by', 'Sides by', 'Finish by', 'Pack by', 'Note', 'Dest', 'Ref'],
  Production: ['Event ID', 'Time', 'Worker ID', 'Worker', 'Order', 'Net code', 'Net', 'Step', 'Action', 'Minutes', 'Box', 'Reason', 'Caused by', 'Entered by', 'Station', 'Before', 'After', 'Undone'],
  'WO deleted': ['Deleted at', 'By', 'Reason', 'Tab', 'Row'],
  'Production daily': ['Day', 'Worker ID', 'Worker', 'Step', 'Received', 'Done', 'Minutes', 'Timed', 'Rejects caused', 'Rework caused', 'First', 'Last']
};
// In boxes: how many nets are in each box (or TOP), one row per box + net. Put away adds, a manager's box change or an
//   Excel upload sets it, picks take off, rack-in adds, box count Apply sets it. Stock (the total per net) already includes it.
// Snapshots: a copy of Stock, Boxes, Counts and In boxes: every day (DAY-...) and before every reset or restore.
// Counts: box count in progress (scan the shelf, type the number). Rows leave this tab when the manager presses Apply in the app.
// Layout v7: every box slot on racks A-C. "empty" boxes are on the refill list; Made drives first made, first shipped.

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName('Put away'); // version 7 name
  if (old && !ss.getSheetByName('In boxes')) old.setName('In boxes');
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
  dailyTrigger_();
}
// Daily snapshot at about 23:00. Installing a trigger needs permission once (Google asks when you run setup).
function dailyTrigger_() {
  try {
    if (ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'dailySnapshot'; })) return;
    ScriptApp.newTrigger('dailySnapshot').timeBased().everyDays(1).atHour(23).create();
  } catch (err) {} // no permission yet: run setup from the editor once
}
function dailySnapshot() {
  var t = new Date(), day = Utilities.formatDate(t, Session.getScriptTimeZone(), 'yyyyMMdd');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var cut = Utilities.formatDate(new Date(t.getTime() - KEEP_DAYS * 864e5), Session.getScriptTimeZone(), 'yyyyMMdd');
    deleteWhere_('Snapshots', function (r) { var m = /^DAY-(\d{8})/.exec(String(r[0])); return m && (m[1] < cut || m[1] === day); });
    snapshot_('DAY-' + day, t, 'Daily copy');
    woArchive_(t);
  } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  if (!HDR_OK_[name] && TABS[name] && sh.getLastRow() > 0 && sh.getLastColumn() < TABS[name].length) // a newer version added columns: add their titles
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
  HDR_OK_[name] = true;
  return sh;
}
var HDR_OK_ = {};
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
    sh.appendRow([id, String(p.name).trim(), p.role || '', LEVELS.indexOf(p.level) >= 0 && (p.level !== 'Owner' || me.level === 'Owner') ? p.level : 'Worker', 'Yes', '', '', 0, '', '']);
    w = findRow_('Workers', id);
  }
  var r = w.values.slice(), owner = me.level === 'Owner';
  if (level_(r) === 'Owner' && !owner) return { ok: false, error: 'Only the owner can change the owner.' };
  if (p.level === 'Owner' && !owner) return { ok: false, error: 'Only the owner can give the Owner level.' };
  if (p.name != null && String(p.name).trim()) r[1] = String(p.name).trim();
  if (p.role != null) r[2] = p.role;
  if (p.level != null) { if (LEVELS.indexOf(p.level) < 0) return { ok: false, error: 'Level must be Worker, Manager, Admin or Owner.' }; r[3] = p.level; }
  if (p.active != null) r[4] = p.active ? 'Yes' : 'No';
  if (id === me.id && (level_(r) !== me.level || !active_(r))) return { ok: false, error: 'You cannot change your own level or switch yourself off.' };
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
  WO_ = null;
  pins_();
  var me = auth_(p.t);
  if (!me) return json_({ ok: false, auth: true, v: VERSION, error: 'Please sign in.' });
  var mgr = atLeast_(me.level, 'Manager'), adm = atLeast_(me.level, 'Admin');
  if (p.snap) { // restore preview: what that snapshot holds (Admin)
    if (!adm) return json_({ ok: false, error: 'Only an admin can look at snapshots.' });
    var sr = snapRows_(String(p.snap)), st = {}, ib = [];
    sr.Stock.forEach(function (r) { st[r[0]] = Number(r[2]) || 0; });
    sr['In boxes'].forEach(function (r) { ib.push({ box: String(r[0]), net: String(r[1]), qty: Number(r[3]) || 0 }); });
    return json_({ ok: true, v: VERSION, snap: String(p.snap), stock: st, shelf: ib, boxes: sr.Boxes.length, counts: sr.Counts.length });
  }
  if (p.prod) { // one month of production per person, per step, per day (managers): the monthly download
    if (!mgr) return json_({ ok: false, error: 'Only a manager can download production numbers.' });
    return json_({ ok: true, v: VERSION, month: String(p.prod), daily: prodDaily_(function (d) { return d.indexOf(String(p.prod)) === 0; }) });
  }
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
  var counts = rows_('Counts').filter(function (r) { return r[0] && r[1]; }).map(function (r) { var o = { box: String(r[0]), net: String(r[1]), qty: Number(r[3]) || 0, at: iso_(r[4]), by: r[5] }; if (String(r[7])) o.parts = parts_(r[7]); return o; });
  var shelf = rows_('In boxes').filter(function (r) { return r[0] && r[1]; }).map(function (r) { var o = { box: String(r[0]), net: String(r[1]), qty: Number(r[3]) || 0, at: iso_(r[4]), by: r[5] }; if (String(r[7])) o.parts = parts_(r[7]); return o; });
  var tz = Session.getScriptTimeZone(), day = Utilities.formatDate(new Date(), tz, 'yyyyMMdd'), isDay = function (v) { return v && typeof v.getTime === 'function' && Utilities.formatDate(v, tz, 'yyyyMMdd') === day; };
  var picks = rows_('Pick lists').filter(function (r) { return r[0] && r[1] && String(r[7]) !== 'undone' && (String(r[7]) !== 'done' || isDay(r[8]) || isDay(r[5])); }).map(function (r) {
    return { list: String(r[0]), net: String(r[1]), qty: Number(r[3]) || 0, picked: Number(r[4]) || 0, created: iso_(r[5]), by: r[6], state: String(r[7] || 'open'),
      no: Number(r[9]) || 0, keep: String(r[10]) === 'kept', boxed: String(r[10]) === 'boxes', note: String(r[11] || ''), doneBy: String(r[12] || ''), doneAt: iso_(r[13]), from: from_(r[14]) };
  });
  var today = {}; // what went out of stock today, per net: picks and FBA, plus pick lists made final today
  rows_('Scans').forEach(function (r) {
    if ((r[2] !== 'OUT' && r[2] !== 'FBA') || !r[6] || !isDay(r[1]) || String(r[11]).indexOf(' · UNDONE') >= 0) return;
    today[r[6]] = (today[r[6]] || 0) + (Number(r[8]) || 0);
  });
  rows_('Pick lists').forEach(function (r) { if (r[1] && isDay(r[5]) && String(r[7]) !== 'undone' && String(r[10]) !== 'kept') today[r[1]] = (today[r[1]] || 0) + (Number(r[3]) || 0); }); // kept lists go out through OUT
  return json_({ ok: true, v: VERSION, me: { id: me.id, name: me.name, level: me.level, exp: me.exp }, stock: stock, batches: batches, workers: workers, log: log, rates: rates, boxes: boxes, counts: counts, shelf: shelf, picks: picks, outToday: today, resetAt: resetAt_(), snaps: atLeast_(me.level, 'Admin') ? snapList_() : [], wo: woRead_(me), at: new Date().toISOString() });
}
function snapList_() { // newest first: id, time, by, rows
  var o = {}, order = [];
  rows_('Snapshots').forEach(function (r) { var id = String(r[0]); if (!id) return; if (!o[id]) { o[id] = { id: id, t: iso_(r[1]), by: r[2], rows: 0 }; order.push(id); } if (r[3] !== '(nothing)') o[id].rows++; });
  return order.reverse().map(function (id) { return o[id]; });
}
function snapRows_(id) { // the rows of one snapshot, by tab (old 'Put away' rows count as In boxes)
  var out = {}; SNAP_TABS.forEach(function (n) { out[n] = []; });
  rows_('Snapshots').forEach(function (r) { if (String(r[0]) !== id || !r[4]) return; var tab = r[3] === 'Put away' ? 'In boxes' : r[3]; if (out[tab]) out[tab].push(JSON.parse(r[4])); });
  return out;
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
    WO_ = null;
    if (body.action === 'wocreate') { var cr = woCreate_(me, body); woFlush_(); return json_(cr); }
    var scans = rows_('Scans'), seen = {}, mine = {};
    scans.slice(-2000).forEach(function (r) { seen[r[0]] = true; });
    woSeen_(seen, mine); // work order scans live in the Production tab
    var when = {}, resetAt = resetAt_() ? new Date(resetAt_()).getTime() : 0;
    scans.slice(-500).forEach(function (r) { mine[r[0]] = String(r[3]); when[r[0]] = r[1] ? new Date(r[1]).getTime() : 0; });
    var done = [], refused = [];
    (body.events || []).forEach(function (ev) {
      if (!ev || !ev.id) return;
      if (!seen[ev.id]) {
        var why = allowed_(me, ev, mine) || beforeReset_(ev, when, resetAt);
        if (!why && /^WO/.test(ev.type)) { // work orders: checked against where the net is now, so nothing is done twice
          why = woApply_(ev, me, body.station || '');
          if (!why) { seen[ev.id] = true; mine[ev.id] = me.id; done.push(ev.id); return; }
        }
        if (why) { refused.push({ id: ev.id, type: ev.type, why: why }); done.push(ev.id); return; }
        if (ev.type === 'WORKER') ev.by = me.id; else ev.who = me.id; // the name on every scan is the person signed in
        apply_(ev, body.station || ''); seen[ev.id] = true; mine[ev.id] = me.id;
      }
      done.push(ev.id);
    });
    woFlush_();
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

// After a reset, scans made before it (a phone that was offline, or an undo of an old scan) must not bring old numbers back.
function beforeReset_(ev, when, resetAt) {
  if (!resetAt || ev.type === 'WORKER') return null;
  if (/^WO/.test(ev.type) && !((ev.type === 'WOSTEP' || ev.type === 'WOBULK') && ev.act === 'RACKIN')) return null; // production steps do not change stock; only a rack-in does
  if (ev.t && new Date(ev.t).getTime() < resetAt) return 'This scan was made before the inventory was reset, so it was not saved.';
  if (ev.type === 'UNDO' && ev.undoes && when[ev.undoes] != null && when[ev.undoes] < resetAt) return 'That scan was before the reset, so it cannot be undone.';
  return null;
}
function resetAt_() { return PropertiesService.getScriptProperties().getProperty('RESET_AT') || ''; }

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
    if (ev.type === 'IN') { stock_(ev.net, ev.netName, Number(ev.qty), 'add', 'Rack-in ' + ev.wo, t); countAdd_(ev.loc === '2F' ? 'TOP' : ev.loc, ev.net, ev.netName, Number(ev.qty), false, t, ev.who, ev.id, 'In boxes'); if (isTop_(ev.loc)) topParts_(ev.net); }
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
    if (ev.loc) takeOff_(ev.loc, ev.net, Number(ev.qty), t, ev.who, ev.id);
    if (isTop_(ev.loc)) topParts_(ev.net, ev.partAdd, ev.partDel);
  } else if (ev.type === 'RETURN') {
    stock_(ev.net, ev.netName, Number(ev.qty), 'add', 'Return', t);
    if (ev.loc) countAdd_(ev.loc === '2F' ? 'TOP' : ev.loc, ev.net, ev.netName, Number(ev.qty), false, t, ev.who, ev.id, 'In boxes');
  } else if (ev.type === 'COUNT') {
    stock_(ev.net, ev.netName, Number(ev.qty), 'set', 'Count', t);
  } else if (ev.type === 'UNDO') {
    undo_(ev, t);
  } else if (ev.type === 'BOXCOUNT') {
    count_(ev.loc === '2F' ? 'TOP' : ev.loc, ev.net, ev.netName, ev.qty, t, ev.who, ev.id, ev.parts);
  } else if (ev.type === 'BOXADD') { // put away: stock goes up now; the Put away tab keeps the number per box
    var q = Number(ev.qty) || 0;
    countAdd_(ev.loc, ev.net, ev.netName, q, false, t, ev.who, ev.id, 'In boxes');
    stock_(ev.net, ev.netName, q, 'add', 'Put away ' + (ev.loc || ''), t);
    if (isTop_(ev.loc)) topParts_(ev.net, ev.partAdd, ev.partDel);
    if (ev.loc && ev.loc !== 'TOP' && ev.loc !== '2F') {
      var bx = findRow_('Boxes', ev.loc);
      if (bx && bx.values[1] === 'empty') box_(ev.loc, 'full', ev.boxNet || '', '', '', t, ev.who);
    }
  } else if (ev.type === 'BOXQTY') { // a manager sets one box's number (or an Excel upload row): stock moves by the difference
    boxQty_(ev, t);
  } else if (ev.type === 'PICKLIST') { // Final: the whole list comes off stock now, once
    pickList_(ev, t);
  } else if (ev.type === 'PICKED') { // a picker took nets of the list: tick the line, take them off the box; stock already went down at Final
    pickLine_(ev.list, ev.net, Number(ev.qty) || 0, 0, t);
    if (ev.loc) takeOff_(ev.loc, ev.net, Number(ev.qty) || 0, t, ev.who, ev.id);
    if (isTop_(ev.loc)) topParts_(ev.net, ev.partAdd, ev.partDel);
  } else if (ev.type === 'PICKBACK') { // not picked after all: off the list; back to stock when the nets are still there
    var bq = Number(ev.qty) || 0;
    pickLine_(ev.list, ev.net, 0, -bq, t);
    if (ev.restock && bq) stock_(ev.net, ev.netName, bq, 'add', 'Back from pick list ' + ev.list, t);
    if (ev.restock && bq && ev.backTo) countAdd_(ev.backTo === '2F' ? 'TOP' : ev.backTo, ev.net, ev.netName, bq, false, t, ev.who, ev.id, 'In boxes'); // a list that took it off the box: back in the box
  } else if (ev.type === 'PICKUNDO') { // a manager undoes Final: nets back to stock (unless it kept stock), list marked undone
    pickUndo_(ev, t);
  } else if (ev.type === 'PICKDONE') { // a picker says the list is picked: for information only, no number changes
    pickDone_(ev, t);
  } else if (ev.type === 'RESTORE') {
    restore_(ev, t);
  } else if (ev.type === 'RESET') {
    reset_(ev, t);
  } else if (ev.type === 'BOXSET') {
    box_(ev.loc, ev.state || 'full', ev.net, ev.wo, ev.made, t, ev.who);
  } else if (ev.type === 'COUNTDONE') {
    var keys = {}; (ev.keys || []).forEach(function (k) { keys[k] = true; keys[String(k).replace(/^2F\|/, 'TOP|')] = true; });
    rows_('Counts').forEach(function (r) { if (keys[r[0] + '|' + r[1]]) setIn_(String(r[0]), String(r[1]), r[2], Number(r[3]) || 0, t, ev.who, ev.id, String(r[0]) === 'TOP' ? parts_(r[7]) : null); });
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
  var ca = ev.countsAdd || {}; // undo of a version 6 put away: take the nets back off, so adds from other phones are kept
  Object.keys(ca).forEach(function (k) { var p = k.split('|'); countAdd_(p[0], p[1], '', Number(ca[k].add) || 0, !!ca[k].drop, t, ev.who, ev.id); });
  var pa = ev.putAdd || {}; // undo of a put away (version 7): the stock part comes back through ev.stock
  Object.keys(pa).forEach(function (k) { var p = k.split('|'); countAdd_(p[0], p[1], '', Number(pa[k].add) || 0, !!pa[k].drop, t, ev.who, ev.id, 'In boxes'); });
  var tp = ev.topParts || {}; // undo on top of the racks (version 10): part boxes come back or go again
  Object.keys(tp).forEach(function (id) { topParts_(id, tp[id].add, tp[id].del); });
  var pk = ev.picks || {}; // undo of a pick from a pick list (version 9): the line is not ticked any more
  Object.keys(pk).forEach(function (k) { var p = k.split('|'); pickLine_(p[0], p[1], Number(pk[k]) || 0, 0, t); });
}

// Put away: add nets to a box (or TOP) count. Several phones can add to the same box at once.
// drop = the row did not exist before this add, so remove it again when it goes back to 0.
function countAdd_(box, net, name, add, drop, t, who, id, tab) {
  if (!box || !net) return;
  tab = tab || 'Counts';
  var sh = sheet_(tab), r = rows_(tab);
  for (var i = 0; i < r.length; i++) if (String(r[i][0]) === String(box) && String(r[i][1]) === String(net)) {
    var q = (Number(r[i][3]) || 0) + add;
    if (drop && q <= 0) { sh.deleteRow(i + 2); return; }
    sh.getRange(i + 2, 1, 1, 7).setValues([[box, net, name || r[i][2], Math.max(0, q), t, workerName_(who), id || '']]); return;
  }
  if (add > 0) sh.appendRow([box, net, name || '', add, t, workerName_(who), id || '']);
}

// Box count: one row per box + net (a 3-bin box has one row per color). A new count of the same box replaces the old one.
function count_(box, net, name, qty, t, who, id, parts) {
  if (!box || !net) return;
  var sh = sheet_('Counts'), r = rows_('Counts'), row = [box, net, name || '', Number(qty) || 0, t, workerName_(who), id || '', box === 'TOP' && parts ? partsText_(fit_(parts_(parts), Number(qty) || 0)) : ''];
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

// Reset inventory to zero (Owner only). First a snapshot of every row that is cleared goes to the Snapshots tab,
// then Stock, Boxes, Counts and In boxes are emptied. The scan log (Scans) and Batches stay: history is never lost.
function reset_(ev, t) {
  var id = 'SNAP-' + stamp_(t), n = snapshot_(id, t, workerName_(ev.who));
  clearTabs_();
  PropertiesService.getScriptProperties().setProperty('RESET_AT', t.toISOString());
  var row = findRow_('Scans', ev.id);
  if (row) sheet_('Scans').getRange(row.row, 12).setValue('Inventory reset to zero · snapshot ' + id + ' (' + n + ' rows)' + (ev.reason ? ' · reason: ' + ev.reason : ''));
}

// ---------- number per box ----------
function inBox_(box, net) { var r = rows_('In boxes'); for (var i = 0; i < r.length; i++) if (String(r[i][0]) === String(box) && String(r[i][1]) === String(net)) return { row: i + 2, qty: Number(r[i][3]) || 0, values: r[i] }; return null; }
// parts: the part boxes on top (TOP only). null = keep the ones there, fitted to the new number.
function setIn_(box, net, name, qty, t, who, id, parts) {
  var sh = sheet_('In boxes'), f = inBox_(box, net), row = [box, net, name || (f ? f.values[2] : ''), qty, t, workerName_(who), id || ''];
  if (box === 'TOP') row.push(partsText_(fit_(parts ? parts_(parts) : (f ? parts_(f.values[7]) : []), qty)));
  if (f) sh.getRange(f.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
}
// ---------- top of the racks: full boxes of 25 and part boxes (version 10) ----------
// The TOP row keeps the number of nets on top (part of the total, as before) and the part boxes, e.g. "22,14".
// Full boxes = (nets on top - part boxes) / 25. A number left over (an old count that is not a multiple of 25) shows as one more part box.
function isTop_(loc) { return loc === 'TOP' || loc === '2F'; }
function parts_(v) { return (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[^0-9]+/)).map(function (x) { return Math.round(Number(x) || 0); }).filter(function (x) { return x > 0; }); }
function partsText_(p) { return p.join(','); }
function fit_(p, q) { p = p.slice(); var s = p.reduce(function (a, x) { return a + x; }, 0); while (s > q && p.length) s -= p.pop(); return p; } // never more in part boxes than on top
// add / take away part boxes on top for one net, then fit them to the number on top
function topParts_(net, add, del) {
  var f = inBox_('TOP', net); if (!f) return;
  var p = parts_(f.values[7]);
  parts_(del || []).forEach(function (x) { var i = p.indexOf(x); if (i >= 0) p.splice(i, 1); });
  p = p.concat(parts_(add || []));
  var txt = partsText_(fit_(p, f.qty));
  if (txt !== String(f.values[7] || '')) sheet_('In boxes').getRange(f.row, 8).setValue(txt);
}
// a pick from a box takes the nets off that box's number (never below 0; the total per net is what counts)
function takeOff_(box, net, q, t, who, id) {
  var f = inBox_(box === '2F' ? 'TOP' : box, net); if (!f) return;
  sheet_('In boxes').getRange(f.row, 4, 1, 4).setValues([[Math.max(0, f.qty - q), t, workerName_(who), id || '']]);
  if (isTop_(box)) topParts_(net);
}
function topText_(q, p) { // 72 with part box 22 -> "2 full + part 22 = 72"
  p = fit_(p, q); var rest = q - p.reduce(function (a, x) { return a + x; }, 0), full = Math.floor(rest / TOP_BOX), left = rest - full * TOP_BOX;
  if (left) p = p.concat([left]);
  return (full ? full + ' full' : '') + (p.length ? (full ? ' + ' : '') + 'part ' + p.join(', ') : '') + (full || p.length ? ' = ' + q : '0');
}
function boxQty_(ev, t) {
  if (!ev.loc || !ev.net) return;
  var loc = ev.loc === '2F' ? 'TOP' : ev.loc, f = inBox_(loc, ev.net), was = f ? f.qty : 0, q = Math.max(0, Math.round(Number(ev.qty) || 0));
  var was0 = loc === 'TOP' && f ? topText_(was, parts_(f.values[7])) : String(was);
  setIn_(loc, ev.net, ev.netName, q, t, ev.who, ev.id, loc === 'TOP' && Array.isArray(ev.parts) ? ev.parts : null);
  if (q !== was) stock_(ev.net, ev.netName, q - was, 'add', (ev.upload ? 'Excel upload ' : 'Box change ') + loc, t);
  var row = findRow_('Scans', ev.id), now = loc === 'TOP' ? topText_(q, parts_(inBox_('TOP', ev.net).values[7])) : String(q);
  if (row) sheet_('Scans').getRange(row.row, 12).setValue((ev.upload ? 'Excel upload ' + ev.upload + ': ' : 'Box change: ') + loc + ' ' + was0 + ' → ' + now + (ev.reason ? ' · reason: ' + ev.reason : ''));
  if (loc !== 'TOP' && ev.boxState) { var b = findRow_('Boxes', loc), cur = b ? b.values[1] : 'full'; if (cur !== ev.boxState) box_(loc, ev.boxState, ev.boxNet || '', '', '', t, ev.who); }
}

// ---------- pick lists (version 9) ----------
// One row per list + net. Qty = nets taken off stock for it, Picked = nets the pickers ticked off. State open / done.
function pickList_(ev, t) {
  if (!ev.list || rows_('Pick lists').some(function (r) { return String(r[0]) === String(ev.list); })) return; // a list comes off stock only once
  var sh = sheet_('Pick lists'), out = [], n = 0, keep = !!ev.keep, boxes = !keep && !!ev.boxes, no = pickNo_(t);
  (ev.lines || []).forEach(function (l) {
    var q = Math.max(0, Math.round(Number(l.qty) || 0)); if (!l.net || !q) return;
    if (!keep) stock_(l.net, l.netName, -q, 'add', 'Pick list #' + no + ' ' + ev.list, t);
    var from = boxes ? from_(l.from) : [];
    from.forEach(function (f) { takeOff_(f[0], l.net, f[1], t, ev.who, ev.id); });
    out.push([ev.list, l.net, l.netName || '', q, 0, t, workerName_(ev.who), 'open', new Date(), no, keep ? 'kept' : boxes ? 'boxes' : 'off', String(l.note || ''), '', '', fromText_(from)]); n += q;
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, TABS['Pick lists'].length).setValues(out);
  var row = findRow_('Scans', ev.id);
  if (row) sheet_('Scans').getRange(row.row, 12).setValue('Pick list #' + no + ' (' + ev.list + ') final: ' + n + ' nets' + (keep ? ', stock not changed' : ' off stock') + ' (' + out.length + ' lines)');
}
// which boxes the nets of a list came off: [[box, qty], ...] from the app, or "AR-C3-R5:1,TOP:2" from the sheet
function from_(v) {
  var a = Array.isArray(v) ? v : String(v == null ? '' : v).split(',').filter(Boolean).map(function (x) { var i = x.lastIndexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; });
  return a.map(function (f) { return [String(f[0]) === '2F' ? 'TOP' : String(f[0]), Math.max(0, Math.round(Number(f[1]) || 0))]; }).filter(function (f) { return f[0] && f[1] > 0; });
}
function fromText_(a) { return a.map(function (f) { return f[0] + ':' + f[1]; }).join(','); }
// the next number for a list made that day: one more than the highest number of that day's lists (undone lists do not count)
function pickNo_(t) {
  var tz = Session.getScriptTimeZone(), day = Utilities.formatDate(t, tz, 'yyyyMMdd'), lists = {}, max = 0;
  rows_('Pick lists').forEach(function (r) {
    if (!r[0] || String(r[7]) === 'undone' || !r[5] || typeof r[5].getTime !== 'function' || Utilities.formatDate(r[5], tz, 'yyyyMMdd') !== day) return;
    lists[r[0]] = 1; max = Math.max(max, Number(r[9]) || 0);
  });
  return Math.max(max, Object.keys(lists).length) + 1;
}
// undo Final (manager): only while nothing of the list is picked. Nets go back to stock unless the list kept stock.
function pickUndo_(ev, t) {
  var sh = sheet_('Pick lists'), r = rows_('Pick lists'), mine = [], row = findRow_('Scans', ev.id), say = function (x) { if (row) sheet_('Scans').getRange(row.row, 12).setValue(x); };
  r.forEach(function (x, i) { if (String(x[0]) === String(ev.list)) mine.push({ x: x, j: i }); });
  if (!mine.length || mine.some(function (o) { return String(o.x[7]) === 'undone'; })) { say('Undo of pick list ' + ev.list + ' refused: no such list'); return; }
  if (mine.some(function (o) { return (Number(o.x[4]) || 0) > 0; })) { say('Undo of pick list ' + ev.list + ' refused: nets were already picked'); return; }
  var n = 0, no = Number(mine[0].x[9]) || '';
  mine.forEach(function (o) {
    var q = Number(o.x[3]) || 0;
    if (String(o.x[10]) !== 'kept' && q) { stock_(String(o.x[1]), o.x[2], q, 'add', 'Undo pick list #' + no + ' ' + ev.list, t); n += q; }
    if (String(o.x[10]) === 'boxes') from_(o.x[14]).forEach(function (f) { countAdd_(f[0], String(o.x[1]), o.x[2], f[1], false, t, ev.who, ev.id, 'In boxes'); }); // back into the boxes it came from
    sh.getRange(o.j + 2, 8, 1, 2).setValues([['undone', new Date()]]);
  });
  say('Pick list #' + no + ' (' + ev.list + '): Final undone' + (n ? ', ' + n + ' nets back to stock' : ', stock not changed'));
}
// picking done (any signed-in worker): who and when, on every line of the list. Stock, boxes and the list numbers stay as they are.
function pickDone_(ev, t) {
  var sh = sheet_('Pick lists'), who = workerName_(ev.who);
  rows_('Pick lists').forEach(function (x, i) { if (String(x[0]) === String(ev.list) && String(x[7]) !== 'undone') sh.getRange(i + 2, 13, 1, 2).setValues([[who, t]]); });
}
function pickLine_(list, net, dPicked, dQty, t) {
  var sh = sheet_('Pick lists'), r = rows_('Pick lists'), hit = false;
  for (var i = 0; i < r.length; i++) if (String(r[i][0]) === String(list) && String(r[i][1]) === String(net)) {
    var q = Math.max(0, (Number(r[i][3]) || 0) + dQty), p = Math.max(0, (Number(r[i][4]) || 0) + dPicked);
    sh.getRange(i + 2, 4, 1, 2).setValues([[q, p]]); sh.getRange(i + 2, 9).setValue(new Date()); r[i][3] = q; r[i][4] = p; hit = true; break;
  }
  if (!hit) return;
  var mine = r.map(function (x, j) { return { x: x, j: j }; }).filter(function (o) { return String(o.x[0]) === String(list); });
  var done = mine.every(function (o) { return (Number(o.x[4]) || 0) >= (Number(o.x[3]) || 0); });
  mine.forEach(function (o) { sh.getRange(o.j + 2, 8).setValue(done ? 'done' : 'open'); });
}

function snapshot_(id, t, who) {
  var snap = sheet_('Snapshots'), out = [];
  SNAP_TABS.forEach(function (name) {
    rows_(name).forEach(function (r) { if (r[0] !== '') out.push([id, t, who, name, JSON.stringify(r)]); });
  });
  if (!out.length) out.push([id, t, who, '(nothing)', '']);
  snap.getRange(snap.getLastRow() + 1, 1, out.length, 5).setValues(out);
  return out.length;
}
function clearTabs_() {
  SNAP_TABS.forEach(function (name) { var sh = sheet_(name); if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, TABS[name].length).clearContent(); });
}
function stamp_(t) { return Utilities.formatDate(t, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'); }

// Restore (Admin): copy of the current inventory first, then Stock, Boxes, Counts and In boxes come back from the snapshot.
function restore_(ev, t) {
  var src = snapRows_(String(ev.snap || '')), n = SNAP_TABS.reduce(function (a, k) { return a + src[k].length; }, 0);
  var row = findRow_('Scans', ev.id);
  if (!ev.snap || !rows_('Snapshots').some(function (r) { return String(r[0]) === String(ev.snap); })) { if (row) sheet_('Scans').getRange(row.row, 12).setValue('Restore refused: no snapshot ' + ev.snap); return; }
  var id = 'SNAP-' + stamp_(t) + '-before-restore';
  snapshot_(id, t, workerName_(ev.who));
  clearTabs_();
  SNAP_TABS.forEach(function (name) {
    var rs = src[name].map(function (r) { var o = r.slice(0, TABS[name].length); while (o.length < TABS[name].length) o.push(''); return o; });
    if (rs.length) { var sh = sheet_(name); sh.getRange(2, 1, rs.length, TABS[name].length).setValues(rs); }
  });
  PropertiesService.getScriptProperties().setProperty('RESET_AT', t.toISOString());
  if (row) sheet_('Scans').getRange(row.row, 12).setValue('Inventory restored from ' + ev.snap + ' (' + n + ' rows) · copy of before: ' + id + (ev.reason ? ' · reason: ' + ev.reason : ''));
}

// ---------- work orders: door nets (version 12) ----------
// One work order = one or many sizes and colours (lines), 1 to 1000 nets in all. Every net has its own label: WOMQD045-07/20 =
// door order 45, net 7 of 20 (counted over the whole order; each label shows its own size and colour).
// A reprinted label gets "-R2", "-R3" ...; the older label then stops working. Each net goes through the steps below. At Cutting to
// Packing a worker scans Received, then Done. Rack-in: scan the net, then the box; the net is added to stock like IN.
// Every scan is a row in Production (never deleted) and adds up in Production daily (per person, per step, per day).
var WO_STEPS = ['Cutting', 'Stitch base', 'Stitch sides', 'Final finishing', 'Packing', 'Rack-in'];
var WO_RACK = 5;          // step number of Rack-in; a racked net has step 6
var WO_MAX = 1000;        // nets in one order
var WO_PURPOSE = ['Rack', 'Top', 'FBA', 'Bulk', 'Hold']; // where the order's nets go after Packing. FBA, Bulk, Hold: never in stock
var WO_APART = { FBA: 1, Bulk: 1, Hold: 1 };
var WO_KEEP_DAYS = 14;    // a finished order's net rows move to "WO nets done" after this many days (Production keeps everything)
var WO_ = null;           // this request's copy of the work order tabs, written back once at the end (fast for 1000 nets)
var WO_N = TABS['WO nets'].length, WO_O = TABS['Work orders'].length, WO_P = TABS.Production.length, WO_D = TABS['Production daily'].length;

function pad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function woCode_(no) { return 'WOMQD' + pad_(no, 3); }
function woNetCode_(order, k, qty) { return order + '-' + pad_(k, Math.max(2, String(qty).length)) + '/' + qty; }
function woParse_(code) { // "WOMQD045-07/20-R2" -> { base: "WOMQD045-07/20", order: "WOMQD045", label: 2 }
  var m = /^(WOMQD\d{3,})-(\d+)\/(\d+)(?:-R(\d+))?$/.exec(String(code || '').trim().toUpperCase());
  return m ? { base: m[1] + '-' + m[2] + '/' + m[3], order: m[1], label: m[4] ? Number(m[4]) : 1 } : null;
}
function day_(t) { return Utilities.formatDate(t, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function dk_(v) { return v && typeof v.getTime === 'function' ? day_(v) : String(v == null ? '' : v).replace(/^'/, '').slice(0, 10); } // the Day column, written as text
function ensureRows_(sh, last) { if (sh.getMaxRows && sh.getMaxRows() < last) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows()); }
function woLoad_() {
  if (WO_) return WO_;
  var r = rows_('WO nets'), o = rows_('Work orders'), idx = {}, byOrder = {}, oidx = {};
  r.forEach(function (x, i) { if (!x[0]) return; idx[x[0]] = i; (byOrder[x[1]] = byOrder[x[1]] || []).push(i); });
  o.forEach(function (x, i) { if (x[0]) oidx[x[0]] = i; });
  WO_ = { r: r, n0: r.length, idx: idx, byOrder: byOrder, dirty: {}, o: o, o0: o.length, oidx: oidx, odirty: {}, prod: [], daily: null, ddirty: {}, undone: [], oupd: {} };
  return WO_;
}
function writeRows_(name, rows, dirty, width) { // write the changed rows back, joined into blocks of rows next to each other
  var sh = sheet_(name), ks = Object.keys(dirty).map(Number).sort(function (a, b) { return a - b; });
  if (!ks.length) return;
  ensureRows_(sh, ks[ks.length - 1] + 2);
  for (var i = 0; i < ks.length;) {
    var j = i; while (j + 1 < ks.length && ks[j + 1] === ks[j] + 1) j++;
    sh.getRange(ks[i] + 2, 1, j - i + 1, width).setValues(rows.slice(ks[i], ks[j] + 1));
    i = j + 1;
  }
}
function woFlush_() {
  var W = WO_; if (!W) return;
  Object.keys(W.oupd).forEach(function (o) { woOrderCount_(o, W.oupd[o]); });
  writeRows_('WO nets', W.r, W.dirty, WO_N);
  writeRows_('Work orders', W.o, W.odirty, WO_O);
  if (W.daily) writeRows_('Production daily', W.daily.rows, W.ddirty, WO_D);
  var P = sheet_('Production');
  if (W.undone.length) { var ur = P.getLastRow(); W.undone.forEach(function (u) { if (u.row <= ur) P.getRange(u.row, WO_P).setValue(u.t); }); }
  if (W.prod.length) { var last = P.getLastRow(); ensureRows_(P, last + 1 + W.prod.length); P.getRange(last + 1, 1, W.prod.length, WO_P).setValues(W.prod); }
  WO_ = null;
}
function woSeen_(seen, mine) { // ids of the last work order scans (an event saved twice is applied once), and who entered them
  var P = sheet_('Production'), n = P.getLastRow(); if (n < 2) return;
  var k = Math.min(n - 1, 5000), v = P.getRange(n - k + 1, 1, k, 14).getValues();
  v.forEach(function (r) { var id = String(r[0]).split('#')[0]; if (id) { seen[id] = true; mine[id] = String(r[13]); } });
}
// label printing rights for the day: a manager gives them to anyone (e.g. whoever is at the computer today)
function rights_() { try { var x = JSON.parse(PropertiesService.getScriptProperties().getProperty('LABEL_RIGHTS') || '{}'); return x.day === day_(new Date()) ? (x.ids || []) : []; } catch (e) { return []; } }
function canLabels_(me) { return atLeast_(me.level, 'Manager') || rights_().indexOf(me.id) >= 0; }
function rightsSet_(id, on) {
  var ids = rights_().filter(function (x) { return x !== id; }); if (on) ids.push(id);
  PropertiesService.getScriptProperties().setProperty('LABEL_RIGHTS', JSON.stringify({ day: day_(new Date()), ids: ids }));
}
// net row: 0 Code, 1 Order, 2 No, 3 Net ID, 4 Step, 5 Status (wait / recv / rejected / racked / ready / shipped), 6 Last by, 7 Last at,
//   8 Box, 9 Label, 10 Received at, 11 Reworks, 12-16 who did Cutting ... Packing, 17 Note (why rejected or sent back),
//   18 Dest (Rack, Top, FBA, Bulk, Hold: where it went after Packing), 19 Ref (FBA shipment ID or buyer)
function woState_(r) { return [Number(r[4]) || 0, String(r[5] || 'wait')]; }
function woSay_(r) { // where the net is, in plain words
  var s = Number(r[4]) || 0, st = String(r[5] || 'wait'), who = r[6] ? workerName_(r[6]) : '';
  if (st === 'racked') return 'already on the rack' + (r[8] ? ' in ' + r[8] : '');
  if (st === 'ready') return 'ready for ' + woDestWord_(r[18], r[19]) + ', not in stock';
  if (st === 'shipped') return 'already shipped (' + woDestWord_(r[18], r[19]) + ')';
  if (st === 'rejected') return 'rejected' + (r[17] ? ' (' + r[17] + ')' : '');
  if (st === 'recv') return 'already received at ' + WO_STEPS[s] + (who ? ' by ' + who : '');
  return 'waiting for ' + (s === WO_RACK ? 'Rack-in' : WO_STEPS[s]) + (who && s ? ' (last step by ' + who + ')' : '');
}
function woDestWord_(d, ref) { d = String(d || ''); ref = String(ref || ''); return (d === 'FBA' ? 'FBA' : d === 'Bulk' ? 'bulk buyer' : d === 'Hold' ? 'hold' : d === 'Top' ? 'top of the racks' : 'the rack') + (ref ? ' ' + ref : ''); }
function woPurpose_(o) { var p = String(o[13] || ''); return WO_PURPOSE.indexOf(p) >= 0 ? p : 'Rack'; } // old orders: the rack
function prodRow_(ev, t, who, r, step, action, extra) {
  var x = extra || {};
  return [x.id || ev.id, t, who, workerName_(who), r[1], r[0], r[3], step == null ? '' : (WO_STEPS[step] || 'On rack'), action, x.min == null ? '' : x.min, x.box || '', ev.reason || '',
    x.caused || '', ev.who || '', x.station || '', x.before ? JSON.stringify(x.before) : '', x.after ? JSON.stringify(x.after) : '', ''];
}
function dailyLoad_() {
  var W = woLoad_(); if (W.daily) return W.daily;
  var rows = rows_('Production daily'), idx = {};
  rows.forEach(function (r, i) { if (r[0]) idx[dk_(r[0]) + '|' + r[1] + '|' + r[3]] = i; });
  W.daily = { rows: rows, idx: idx }; return W.daily;
}
// add to the numbers of one person at one step on one day. f: 4 Received, 5 Done, 8 Rejects caused, 9 Rework caused
function daily_(t, who, step, f, d, min) {
  if (!who || step == null || step < 0) return;
  var D = dailyLoad_(), day = day_(t), name = WO_STEPS[step] || 'On rack', k = day + '|' + who + '|' + name, i = D.idx[k];
  if (i == null) { if (d < 0) return; i = D.rows.length; D.idx[k] = i; D.rows.push(["'" + day, who, workerName_(who), name, 0, 0, 0, 0, 0, 0, '', '']); }
  var r = D.rows[i];
  r[f] = Math.max(0, (Number(r[f]) || 0) + d);
  if (min != null && min !== '') { r[6] = Math.max(0, Math.round(((Number(r[6]) || 0) + d * Number(min)) * 10) / 10); r[7] = Math.max(0, (Number(r[7]) || 0) + d); }
  if (d > 0 && f < 8) { if (!r[10] || new Date(r[10]) > t) r[10] = t; if (!r[11] || new Date(r[11]) < t) r[11] = t; }
  WO_.ddirty[i] = 1;
}
function prodDaily_(test) {
  return rows_('Production daily').filter(function (r) { return r[0] && test(dk_(r[0])); }).map(function (r) {
    return { day: dk_(r[0]), who: String(r[1]), name: String(r[2]), step: String(r[3]), recv: Number(r[4]) || 0, done: Number(r[5]) || 0, min: Number(r[6]) || 0, timed: Number(r[7]) || 0, rej: Number(r[8]) || 0, rework: Number(r[9]) || 0, first: iso_(r[10]), last: iso_(r[11]) };
  });
}
function woSet_(i, row) { WO_.r[i] = row; WO_.dirty[i] = 1; }
function woOrderUpdate_(order, t) { woLoad_().oupd[order] = t; } // counted once, when the changes are written
function woOrderCount_(order, t) { // racked / rejected / ready / shipped counts; the order is done when no net is left in production
  var W = WO_, oi = W.oidx[order]; if (oi == null) return;
  var o = W.o[oi], racked = 0, rej = 0, ready = 0, ship = 0, all = (W.byOrder[order] || []).length;
  (W.byOrder[order] || []).forEach(function (i) { var st = String(W.r[i][5]); if (st === 'racked') racked++; else if (st === 'rejected') rej++; else if (st === 'ready') ready++; else if (st === 'shipped') ship++; });
  var done = all > 0 && racked + rej + ready + ship === all;
  o[9] = racked; o[10] = rej; o[16] = ready; o[17] = ship;
  if (done && o[7] !== 'done') { o[7] = 'done'; o[8] = t; } else if (!done && o[7] === 'done') { o[7] = 'open'; o[8] = ''; }
  W.odirty[oi] = 1;
}
// one step for one net. Returns null when saved, otherwise why not.
function woOne_(ev, t, i, who, act, extra) {
  var W = woLoad_(), r = W.r[i].slice(), before = W.r[i].slice(4), s = Number(r[4]) || 0, st = String(r[5] || 'wait'), x = extra || {}, min = null, caused = '', step = s, action, box = '';
  if (act === 'RECV') {
    if (st !== 'wait' || s >= WO_RACK) return r[0] + ' is ' + woSay_(r) + '.';
    r[5] = 'recv'; r[10] = t; action = 'Received';
  } else if (act === 'DONE') {
    if (st !== 'recv' || s >= WO_RACK) return r[0] + ' is ' + woSay_(r) + '.';
    if (r[10]) min = Math.round((t.getTime() - new Date(r[10]).getTime()) / 6000) / 10;
    if (min != null && (min < 0 || min > 24 * 60)) min = null; // a time over a day is not a working time: not counted in the average
    r[12 + s] = who; r[4] = s + 1; r[5] = 'wait'; r[10] = ''; action = 'Done';
  } else if (act === 'RACKIN') { // packed net into its box (or a ready net moved to the racks by a manager): stock goes up
    var moved = st === 'ready';
    if (moved && !x.mgr) return r[0] + ' is ' + woSay_(r) + '. Only a manager can move it to the racks.';
    if (!moved && (st !== 'wait' || s !== WO_RACK)) return r[0] + ' is ' + woSay_(r) + '.';
    box = String(ev.loc || '').toUpperCase(); if (box === '2F') box = 'TOP';
    if (!box) return 'Scan the box the net goes into.';
    r[4] = 6; r[5] = 'racked'; r[8] = box; r[18] = box === 'TOP' ? 'Top' : 'Rack'; action = moved ? 'Move to rack' : 'Rack-in';
  } else if (act === 'READY') { // packed, kept apart for FBA, a bulk buyer or on hold: not stock
    var dst = String(ev.dest || ''), restage = st === 'ready';
    if (!WO_APART[dst]) return 'Pick where the net goes.';
    if (restage && !x.mgr) return r[0] + ' is ' + woSay_(r) + '.';
    if (!restage && (st !== 'wait' || s !== WO_RACK)) return r[0] + ' is ' + woSay_(r) + '.';
    var oo = W.o[W.oidx[r[1]]] || [];
    r[4] = 6; r[5] = 'ready'; r[18] = dst; r[19] = String(ev.ref != null ? ev.ref : (woPurpose_(oo) === dst ? oo[14] || '' : '')).slice(0, 60);
    action = restage ? 'Ready: changed' : 'Ready';
  } else if (act === 'SHIP') {
    if (st !== 'ready') return r[0] + ' is ' + woSay_(r) + '.';
    r[5] = 'shipped'; action = 'Shipped';
  } else if (act === 'REJECT') {
    if (st !== 'wait' && st !== 'recv') return r[0] + ' is ' + woSay_(r) + '.';
    if (!ev.reason) return 'Say why the net is rejected.';
    caused = s > 0 ? String(r[12 + s - 1] || '') : ''; r[5] = 'rejected'; r[17] = ev.reason; r[10] = ''; action = 'Reject';
  } else if (act === 'BACK') {
    var to = Math.round(Number(ev.to));
    if (st !== 'wait' && st !== 'recv') return r[0] + ' is ' + woSay_(r) + '.';
    if (!(to >= 0 && to < s) || s > WO_RACK) return 'A net can only go back to an earlier step.';
    if (!ev.reason) return 'Say why the net goes back.';
    caused = String(r[12 + to] || ''); for (var k = to; k < 5; k++) r[12 + k] = '';
    r[4] = to; r[5] = 'wait'; r[10] = ''; r[11] = (Number(r[11]) || 0) + 1; r[17] = ev.reason; action = 'Rework';
  } else return 'Unknown step.';
  r[6] = who; r[7] = t;
  woSet_(i, r);
  W.prod.push(prodRow_(ev, t, who, r, step, action, { id: x.id, min: min, box: box, caused: caused, station: x.station, before: before, after: woState_(r) }));
  if (act === 'RECV') daily_(t, who, s, 4, 1);
  if (act === 'DONE') daily_(t, who, s, 5, 1, min);
  if (action === 'Rack-in' || action === 'Ready') daily_(t, who, WO_RACK, 5, 1); // the last step after Packing counts once per net
  if (caused) daily_(t, caused, act === 'BACK' ? Math.round(Number(ev.to)) : s - 1, act === 'BACK' ? 9 : 8, 1);
  if (act === 'RACKIN') { // into stock, the same way as IN: the total and the box number go up
    stock_(r[3], '', 1, 'add', 'Rack-in ' + r[0], t);
    countAdd_(box, r[3], '', 1, false, t, who, ev.id, 'In boxes');
    if (box !== 'TOP') { var bx = findRow_('Boxes', box); if (bx && bx.values[1] === 'empty') box_(box, 'full', r[3], r[1], '', t, who); }
    sheet_('Scans').appendRow([ev.id, t, 'WOIN', who, workerName_(who), r[1], r[3], '', 1, '', box, 'Rack-in ' + r[0], x.station || '', '']);
  }
  woOrderUpdate_(r[1], t);
  return null;
}
function woApply_(ev, me, station) {
  var t = ev.t ? new Date(ev.t) : new Date(), W = woLoad_();
  ev.who = me.id;
  if (ev.type === 'WOSTEP') {
    var c = woParse_(ev.code), i = c ? W.idx[c.base] : null;
    if (i == null) return 'Work order net ' + (ev.code || '') + ' not found.';
    if (c.label < (Number(W.r[i][9]) || 1)) return 'Old label ' + ev.code + ': it was printed again, use the new label.';
    var cur = woState_(W.r[i]);
    if (ev.from && (Number(ev.from[0]) !== cur[0] || String(ev.from[1]) !== cur[1])) return W.r[i][0] + ' is ' + woSay_(W.r[i]) + '.';
    return woOne_(ev, t, i, me.id, ev.act, { station: station, mgr: atLeast_(me.level, 'Manager') });
  }
  if (ev.type === 'WOBULK') { // a manager does a whole order (or the nets ticked) at once, for the person who did the work
    var list = (W.byOrder[ev.order] || []).slice(), want = ev.nos ? {} : null, n = 0, who = ev['for'] ? String(ev['for']) : me.id, s0 = Number(ev.step);
    if (!list.length) return 'Work order ' + ev.order + ' not found.';
    if (ev['for'] && !findRow_('Workers', badge_(who))) return 'Unknown employee number ' + who + '.';
    who = badge_(who);
    // Received / Done at a step; Ready (packed nets kept apart for FBA, bulk or hold); Shipped (ready nets);
    // Rack-in only of ready nets and only onto the top of the racks (a packed net goes into its box one by one)
    var from = { RECV: 'wait', DONE: 'recv', READY: 'wait', SHIP: 'ready', RACKIN: 'ready' }[ev.act];
    if (!from) return 'Only Received, Done, Ready, Shipped or Move to the top can be done for a whole order.';
    if (ev.act === 'READY' && !WO_APART[String(ev.dest || '')]) return 'Pick where the nets go.';
    if (ev.act === 'RACKIN' && String(ev.loc || '').toUpperCase() !== 'TOP') return 'A whole order can only be moved onto the top of the racks.';
    if (ev.act === 'READY' || ev.act === 'SHIP' || ev.act === 'RACKIN') s0 = ev.act === 'READY' ? WO_RACK : 6;
    if (want) ev.nos.forEach(function (k) { want[Number(k)] = 1; });
    list.forEach(function (j) {
      var r = W.r[j], st = woState_(r);
      if (want && !want[Number(r[2])]) return;
      if (st[0] !== s0 || st[1] !== from) return;
      woOne_(ev, t, j, who, ev.act, { id: ev.id + '#' + (++n), station: station, mgr: true });
    });
    if (!n) return 'No net of ' + ev.order + ' is waiting for that step.';
    return null;
  }
  if (ev.type === 'WODEST') { // a manager changes where an order goes (purpose, FBA shipment ID or buyer, comment)
    var di = W.oidx[ev.order]; if (di == null) return 'Work order ' + ev.order + ' not found.';
    var pp = String(ev.purpose || ''); if (WO_PURPOSE.indexOf(pp) < 0) return 'Pick where the order goes.';
    var od = W.o[di], was = woPurpose_(od) + (od[14] ? ' ' + od[14] : '');
    od[13] = pp; od[14] = String(ev.ref || '').slice(0, 60); if (ev.comment != null) od[11] = String(ev.comment).slice(0, 200); W.odirty[di] = 1;
    var moved2 = 0;
    if (WO_APART[pp]) (W.byOrder[ev.order] || []).forEach(function (j) { // nets already kept apart follow the order
      var r = W.r[j]; if (String(r[5]) !== 'ready' || (String(r[18]) === pp && String(r[19]) === od[14])) return;
      var nr = r.slice(); nr[18] = pp; nr[19] = od[14]; woSet_(j, nr); moved2++;
    });
    W.prod.push([ev.id, t, me.id, workerName_(me.id), ev.order, '', od[1], '', 'Goes to: ' + was + ' -> ' + pp + (od[14] ? ' ' + od[14] : '') + (moved2 ? ' (' + moved2 + ' ready nets)' : ''), '', '', ev.reason || '', '', me.id, station, '', '', '']);
    return null;
  }
  if (ev.type === 'WOSET') { // a manager puts nets at a step (move back, fix a wrong scan, bring a rejected net back)
    var to = Math.round(Number(ev.step)), sto = String(ev.status || 'wait'), m = 0;
    if (!(to >= 0 && to <= WO_RACK) || ['wait', 'recv', 'rejected'].indexOf(sto) < 0 || (sto === 'recv' && to >= WO_RACK)) return 'Pick a step.';
    if (!ev.reason) return 'Say why.';
    (ev.codes || []).forEach(function (code) {
      var p = woParse_(code), j = p ? W.idx[p.base] : null; if (j == null) return;
      var r = W.r[j].slice(), before = r.slice(4);
      if (String(r[5]) === 'racked') return; // on the rack: that is stock now (undo the rack-in, or use OUT)
      if (sto !== 'rejected') { for (var k = to; k < 5; k++) r[12 + k] = ''; r[4] = to; }
      r[5] = sto; r[10] = sto === 'recv' ? t : ''; r[6] = me.id; r[7] = t; r[17] = sto === 'rejected' ? ev.reason : r[17];
      woSet_(j, r);
      W.prod.push(prodRow_(ev, t, me.id, r, Number(r[4]), 'Fix: ' + (sto === 'rejected' ? 'rejected' : (sto === 'recv' ? 'received at ' : 'waiting for ') + WO_STEPS[to]), { id: ev.id + '#' + (++m), station: station, before: before, after: woState_(r) }));
      woOrderUpdate_(r[1], t);
    });
    if (!m) return 'Nothing to change (nets on the rack are stock: undo the rack-in or use OUT).';
    return null;
  }
  if (ev.type === 'WOREPRINT') { // a new label for a lost or torn one: the old label stops working
    if (!canLabels_(me)) return 'Only a manager, or someone with label printing today, can print labels.';
    var q = woParse_(ev.code), ri = q ? W.idx[q.base] : null; if (ri == null) return 'Work order net ' + (ev.code || '') + ' not found.';
    var rr = W.r[ri].slice(), lab = Math.max(Number(rr[9]) || 1, Math.round(Number(ev.label) || 0));
    if (lab <= (Number(rr[9]) || 1)) return null; // already printed again
    rr[9] = lab; woSet_(ri, rr);
    W.prod.push(prodRow_(ev, t, me.id, rr, null, 'Reprint label ' + lab, { station: station }));
    return null;
  }
  if (ev.type === 'WODUE') {
    var oi = W.oidx[ev.order]; if (oi == null) return 'Work order ' + ev.order + ' not found.';
    W.o[oi][6] = ev.due ? new Date(ev.due) : ''; W.odirty[oi] = 1;
    W.prod.push([ev.id, t, me.id, workerName_(me.id), ev.order, '', W.o[oi][1], '', 'Due ' + (ev.due ? Utilities.formatDate(new Date(ev.due), Session.getScriptTimeZone(), 'dd MMM HH:mm') : 'none'), '', '', ev.reason || '', '', me.id, station, '', '', '']);
    return null;
  }
  if (ev.type === 'WORIGHT') {
    var b = badge_(ev.badge); if (!findRow_('Workers', b)) return 'Unknown employee number ' + ev.badge + '.';
    rightsSet_(b, !!ev.on);
    W.prod.push([ev.id, t, b, workerName_(b), '', '', '', '', ev.on ? 'Label printing today: given' : 'Label printing today: taken away', '', '', '', '', me.id, station, '', '', '']);
    return null;
  }
  if (ev.type === 'WOUNDO') return woUndo_(ev, me, t, station);
  if (ev.type === 'WODELETE') return woDelete_(ev, me, t, station);
  return 'Unknown work order scan.';
}
// undo a work order scan (your own, within 15 minutes on your phone; a manager any): the net goes back to where it was,
// the person's numbers go down again, and a rack-in comes off stock and the box
function woUndo_(ev, me, t, station) {
  var W = woLoad_(), P = sheet_('Production'), n = P.getLastRow(); if (n < 2) return 'Nothing to undo.';
  var k = Math.min(n - 1, 5000), first = n - k + 1, v = P.getRange(first, 1, k, WO_P).getValues(), hit = [];
  v.forEach(function (r, j) { var id = String(r[0]); if (id === ev.undoes || id.indexOf(ev.undoes + '#') === 0) hit.push({ r: r, row: first + j }); });
  if (!hit.length) return 'That scan is not saved yet, or too old to undo.';
  if (!atLeast_(me.level, 'Manager') && hit.some(function (h) { return String(h.r[13]) !== me.id; })) return 'You can undo only your own scans.';
  if (!atLeast_(me.level, 'Manager') && hit.some(function (h) { return t.getTime() - new Date(h.r[1]).getTime() > 20 * 60000; })) return 'Too late to undo (15 minutes). Ask a manager.';
  if (hit.some(function (h) { return h.r[17]; })) return 'That scan was already undone.';
  var bad = hit.filter(function (h) { var j = W.idx[h.r[5]]; return h.r[15] && (j == null || JSON.stringify(woState_(W.r[j])) !== String(h.r[16])); });
  if (bad.length) return 'Cannot undo: ' + bad[0].r[5] + ' has moved on since then.';
  hit.reverse().forEach(function (h) {
    var x = h.r, j = W.idx[x[5]], when = new Date(x[1]), step = WO_STEPS.indexOf(String(x[7]));
    if (j != null && x[15]) { var r = W.r[j].slice(0, 4).concat(JSON.parse(x[15])); while (r.length < WO_N) r.push(''); woSet_(j, r); woOrderUpdate_(r[1], t); }
    if (x[8] === 'Received') daily_(when, String(x[2]), step, 4, -1);
    if (x[8] === 'Done') daily_(when, String(x[2]), step, 5, -1, x[9] === '' ? null : Number(x[9]));
    if (x[8] === 'Rack-in' || x[8] === 'Ready') daily_(when, String(x[2]), WO_RACK, 5, -1);
    if (x[12]) daily_(when, String(x[12]), x[8] === 'Rework' ? JSON.parse(x[16])[0] : step - 1, x[8] === 'Rework' ? 9 : 8, -1);
    if (x[8] === 'Rack-in' || x[8] === 'Move to rack') {
      stock_(String(x[6]), '', -1, 'add', 'Undo rack-in ' + x[5], t);
      takeOff_(String(x[10]), String(x[6]), 1, t, me.id, ev.id);
      var sr = findRow_('Scans', x[0]); if (sr && String(sr.values[11]).indexOf(' · UNDONE') < 0) sheet_('Scans').getRange(sr.row, 12).setValue(String(sr.values[11]) + ' · UNDONE');
      sheet_('Scans').appendRow([ev.id, t, 'WOUNDO', me.id, workerName_(me.id), x[4], x[6], '', -1, '', x[10], 'Undo rack-in ' + x[5] + (ev.reason ? ' · reason: ' + ev.reason : ''), station, ev.reason || '']);
    }
    W.undone.push({ row: h.row, t: t });
    W.prod.push([ev.id + (hit.length > 1 ? '#' + h.row : ''), t, me.id, workerName_(me.id), x[4], x[5], x[6], x[7], 'Undo ' + x[8], '', x[10], ev.reason || '', '', me.id, station, '', '', '']);
  });
  return null;
}
// delete work orders (manager or owner): ev.orders = the ones ticked, or ev.all. ev.stockOff: nets already racked in come off
// stock and off their box again. ev.history (default yes): the step history and the people's numbers for these orders go too.
// ev.restart: when no order is left, the next order is WOMQD001 again. Every row removed is copied to "WO deleted" first.
function woDelete_(ev, me, t, station) {
  if (!String(ev.reason || '').trim()) return 'Say why the work orders are deleted.';
  woFlush_(); // earlier scans in this same call are written first
  var W = woLoad_(), want = {};
  if (ev.all) W.o.forEach(function (o) { if (o[0]) want[o[0]] = 1; });
  else (ev.orders || []).forEach(function (id) { if (W.oidx[String(id)] != null) want[String(id)] = 1; });
  var ids = Object.keys(want).sort();
  if (!ids.length) return ev.all ? 'There are no work orders to delete.' : 'Those work orders are not there any more.';
  var keepHist = ev.history === false, who = workerName_(me.id), why = String(ev.reason).slice(0, 200), bak = [];
  function save(tab, row) { bak.push([t, who, why, tab, JSON.stringify(row)]); }
  // nets on the rack: stock and box numbers
  var done = rows_('WO nets done'), racked = {}, nRacked = 0, nNets = 0;
  W.r.concat(done).forEach(function (r) { if (!r[0] || !want[r[1]]) return; nNets++; if (String(r[5]) === 'racked') { nRacked++; var k = r[3] + '|' + (String(r[8]) === '2F' ? 'TOP' : String(r[8] || 'TOP')); racked[k] = (racked[k] || 0) + 1; } });
  var off = 0;
  if (ev.stockOff) Object.keys(racked).forEach(function (k) {
    var p = k.split('|'), s = findRow_('Stock', p[0]), have = s ? Number(s.values[2]) || 0 : 0, q = Math.min(racked[k], have);
    if (q > 0) { stock_(p[0], '', -q, 'add', 'Work order deleted', t); off += q; }
    takeOff_(p[1], p[0], racked[k], t, me.id, ev.id);
    sheet_('Scans').appendRow([ev.id + '-' + p[0] + '-' + p[1], t, 'WODEL', me.id, who, '', p[0], '', -q, '', p[1], 'Work order deleted: ' + racked[k] + ' racked net(s) taken off', station, why]);
  });
  // the people's numbers: take back what these orders added (scans already undone were taken back then)
  var P = rows_('Production'), keepP = [];
  P.forEach(function (x) {
    if (!x[0]) return;
    if (!want[String(x[4])] || keepHist) { keepP.push(x); return; }
    save('Production', x);
    if (x[17] || /^Undo /.test(String(x[8]))) return;
    var when = new Date(x[1]), step = WO_STEPS.indexOf(String(x[7]));
    if (x[8] === 'Received') daily_(when, String(x[2]), step, 4, -1);
    if (x[8] === 'Done') daily_(when, String(x[2]), step, 5, -1, x[9] === '' ? null : Number(x[9]));
    if (x[8] === 'Rack-in' || x[8] === 'Ready') daily_(when, String(x[2]), WO_RACK, 5, -1);
    if (x[12]) { var aft = []; try { aft = JSON.parse(x[16]); } catch (e) {} daily_(when, String(x[12]), x[8] === 'Rework' ? aft[0] : step - 1, x[8] === 'Rework' ? 9 : 8, -1); }
  });
  if (W.daily) writeRows_('Production daily', W.daily.rows, W.ddirty, WO_D);
  var keepN = W.r.filter(function (r) { if (!r[0]) return false; if (want[r[1]]) { save('WO nets', r); return false; } return true; });
  var keepD = done.filter(function (r) { if (!r[0]) return false; if (want[r[1]]) { save('WO nets done', r); return false; } return true; });
  var keepO = W.o.filter(function (o) { if (!o[0]) return false; if (want[o[0]]) { save('Work orders', o); return false; } return true; });
  if (ev.stockOff) { // the rack-in lines of these orders leave the scan log too (their stock change was just taken back)
    var sc = sheet_('Scans'), sr = rows_('Scans');
    for (var i = sr.length - 1; i >= 0; i--) if ((sr[i][2] === 'WOIN' || sr[i][2] === 'WOUNDO') && want[String(sr[i][5])]) { save('Scans', sr[i]); sc.deleteRow(i + 2); }
  }
  WO_ = null;
  if (bak.length) { var B = sheet_('WO deleted'), bl = B.getLastRow(); ensureRows_(B, bl + 1 + bak.length); B.getRange(bl + 1, 1, bak.length, 5).setValues(bak); }
  rewrite_('WO nets', keepN, WO_N); rewrite_('WO nets done', keepD, WO_N); rewrite_('Work orders', keepO, WO_O);
  if (!keepHist) rewrite_('Production', keepP, WO_P);
  var restarted = false;
  if (ev.restart && !keepO.length) { PropertiesService.getScriptProperties().setProperty('WO_SEQ_MQD', '0'); restarted = true; }
  sheet_('Scans').appendRow([ev.id, t, 'WODEL', me.id, who, ids.length > 3 ? ids[0] + ' … ' + ids[ids.length - 1] : ids.join(', '), '', '', ids.length, '',
    '', 'Deleted ' + ids.length + ' work order(s), ' + nNets + ' nets' + (nRacked ? ', ' + nRacked + ' racked: ' + (ev.stockOff ? off + ' taken off stock' : 'stock kept') : '') + (keepHist ? ', step history kept' : '') + (restarted ? ', numbers start again at WOMQD001' : '') + ' · reason: ' + why, station, why]);
  return null;
}
function rewrite_(name, rows, width) { // replace every row under the titles
  var sh = sheet_(name), n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, width).clearContent();
  if (rows.length) { ensureRows_(sh, rows.length + 1); sh.getRange(2, 1, rows.length, width).setValues(rows.map(function (r) { var o = r.slice(0, width); while (o.length < width) o.push(''); return o; })); }
}
// make orders (manager, or label printing today). Each order gets the next number; one row per net, all written at once.
// An order is { lines: [{ net, qty }], purpose, ref, note, due } (version 14), or one line { net, qty } as before.
function woCreate_(me, body) {
  if (!canLabels_(me)) return { ok: false, error: 'Only a manager, or someone the manager gave label printing today, can make work orders.' };
  var W = woLoad_(), req = String(body.req || ''), t = new Date(), list = body.orders || [], out = [];
  if (req) { // the same request sent again (the answer got lost): give back the orders it made, never make them twice
    W.o.forEach(function (o) { if (String(o[12]) === req) out.push(woOrderOut_(o)); });
    if (out.length) return { ok: true, v: VERSION, orders: out, again: true };
  }
  if (!list.length || list.length > 100) return { ok: false, error: 'Make 1 to 100 orders at a time.' };
  var orders = [];
  for (var i = 0; i < list.length; i++) {
    var o = list[i], ls = o.lines && o.lines.length ? o.lines : [{ net: o.net, qty: o.qty, netName: o.netName }], tot = 0, merged = {}, keys = [];
    if (ls.length > 100) return { ok: false, error: 'Order ' + (i + 1) + ': 1 to 100 sizes and colours in one order.' };
    for (var j = 0; j < ls.length; j++) {
      var q = Math.round(Number(ls[j].qty)), id = String(ls[j].net || ''), at = ls.length > 1 ? 'Line ' + (j + 1) : 'Line ' + (i + 1);
      if (!/^DN-\d{3}x\d{2,3}-(BK|BR|GR)$/.test(id)) return { ok: false, error: at + ': not a door net.' };
      if (!(q >= 1 && q <= WO_MAX)) return { ok: false, error: at + ': 1 to ' + WO_MAX + ' nets.' };
      if (!merged[id]) { merged[id] = { net: id, qty: 0, netName: ls[j].netName || '' }; keys.push(id); }
      merged[id].qty += q; tot += q;
    }
    if (tot > WO_MAX) return { ok: false, error: 'Order ' + (i + 1) + ': ' + tot + ' nets. One order has up to ' + WO_MAX + ' nets: split it.' };
    var pur = String(o.purpose || 'Rack'); if (WO_PURPOSE.indexOf(pur) < 0) pur = 'Rack';
    orders.push({ lines: keys.map(function (k) { return merged[k]; }), qty: tot, purpose: pur, ref: String(o.ref || '').slice(0, 60), note: String(o.note || '').slice(0, 200), due: o.due });
  }
  var pr = PropertiesService.getScriptProperties(), no = Number(pr.getProperty('WO_SEQ_MQD')) || 0;
  W.o.forEach(function (o) { var m = /^WOMQD(\d+)$/.exec(String(o[0])); if (m) no = Math.max(no, Number(m[1])); });
  orders.forEach(function (o) {
    var q = o.qty, code = woCode_(++no), due = o.due ? new Date(o.due) : '', one = o.lines.length === 1;
    var row = [code, one ? o.lines[0].net : 'MIX', one ? o.lines[0].netName : o.lines.length + ' sizes', q, t, workerName_(me.id), due && !isNaN(due.getTime()) ? due : '', 'open', '', 0, 0, o.note, req,
      o.purpose, o.ref, o.lines.map(function (l) { return l.net + ':' + l.qty; }).join(','), 0, 0];
    W.oidx[code] = W.o.length; W.odirty[W.o.length] = 1; W.o.push(row);
    W.byOrder[code] = [];
    var k = 0;
    o.lines.forEach(function (l) {
      for (var c = 0; c < l.qty; c++) {
        k++;
        var nr = [woNetCode_(code, k, q), code, k, l.net, 0, 'wait', '', '', '', 1, '', 0, '', '', '', '', '', '', '', ''];
        W.idx[nr[0]] = W.r.length; W.byOrder[code].push(W.r.length); W.dirty[W.r.length] = 1; W.r.push(nr);
      }
    });
    W.prod.push([body.req ? req + '-' + code : 'MK-' + code, t, me.id, workerName_(me.id), code, '', row[1], '', 'Order made: ' + q + ' nets' + (one ? '' : ' in ' + o.lines.length + ' sizes') + ', labels printed' + (o.purpose !== 'Rack' ? ' · for ' + o.purpose + (o.ref ? ' ' + o.ref : '') : ''), '', '', '', '', me.id, body.station || '', '', '', '']);
    out.push(woOrderOut_(row));
  });
  pr.setProperty('WO_SEQ_MQD', String(no));
  return { ok: true, v: VERSION, orders: out };
}
function woLines_(o) { // [{ net, qty }] of an order: the Lines column, or the one net of an older order
  var s = String(o[15] || '');
  if (!s) return o[1] && o[1] !== 'MIX' ? [{ net: String(o[1]), qty: Number(o[3]) || 0 }] : [];
  return s.split(',').map(function (p) { var a = p.split(':'); return { net: a[0], qty: Number(a[1]) || 0 }; });
}
function woOrderOut_(o) { return { id: String(o[0]), net: String(o[1]), qty: Number(o[3]) || 0, created: iso_(o[4]), by: String(o[5] || ''), due: iso_(o[6]), state: String(o[7] || 'open'), finished: iso_(o[8]), racked: Number(o[9]) || 0, rejected: Number(o[10]) || 0, note: String(o[11] || ''),
  purpose: woPurpose_(o), ref: String(o[14] || ''), lines: woLines_(o), ready: Number(o[16]) || 0, shipped: Number(o[17]) || 0 }; }
// what the phones get: open orders with every net (where it is, who has it), and orders finished in the last 30 days.
// Managers also get the last 35 days of production numbers. Workers never get the numbers per person.
function woRead_(me) {
  var W = woLoad_(), now = Date.now(), out = [];
  W.o.forEach(function (o) {
    if (!o[0]) return;
    var fin = o[8] ? new Date(o[8]).getTime() : 0;
    var apart = Number(o[16]) > 0; // nets kept apart for FBA, bulk or hold: shown until they are shipped
    if (String(o[7]) === 'done' && now - fin > 30 * 864e5 && !apart) return;
    var x = woOrderOut_(o);
    if (String(o[7]) !== 'done' || now - fin < 3 * 864e5 || apart) x.nets = (W.byOrder[o[0]] || []).map(function (i) {
      var r = W.r[i]; // [no, step, status, last by, last at, box, label, reworks, done by Cutting ... Packing, note, net, dest, ref]
      return [Number(r[2]), Number(r[4]) || 0, String(r[5] || 'wait'), String(r[6] || ''), iso_(r[7]), String(r[8] || ''), Number(r[9]) || 1, Number(r[11]) || 0, [r[12], r[13], r[14], r[15], r[16]].map(String), String(r[17] || ''), String(r[3] || ''), String(r[18] || ''), String(r[19] || '')];
    });
    out.push(x);
  });
  var mgr = atLeast_(me.level, 'Manager'), since = day_(new Date(now - 35 * 864e5));
  return { orders: out, rights: { me: canLabels_(me), ids: mgr ? rights_() : [] }, daily: mgr ? prodDaily_(function (d) { return d >= since; }) : [] };
}
// every night: the net rows of orders finished more than 14 days ago move to "WO nets done" (Production keeps every scan)
function woArchive_(t) {
  var W = woLoad_(), old = {}, keep = [], move = [];
  W.o.forEach(function (o) { if (String(o[7]) === 'done' && !(Number(o[16]) > 0) && o[8] && t.getTime() - new Date(o[8]).getTime() > WO_KEEP_DAYS * 864e5) old[o[0]] = 1; });
  if (!Object.keys(old).length) { WO_ = null; return; }
  W.r.forEach(function (r) { if (!r[0]) return; (old[r[1]] ? move : keep).push(r); });
  WO_ = null;
  if (!move.length) return;
  var D = sheet_('WO nets done'), dl = D.getLastRow(); ensureRows_(D, dl + 1 + move.length); D.getRange(dl + 1, 1, move.length, WO_N).setValues(move);
  var sh = sheet_('WO nets'), n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, WO_N).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, WO_N).setValues(keep);
}
