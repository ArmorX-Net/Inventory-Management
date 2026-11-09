/**
 * ArmorX Inventory — Google Sheet backend.
 * Paste this into the sheet's Apps Script editor (Extensions → Apps Script), run setup() once,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *
 * The app sends every scan here. This script writes it to the "Scans" tab and keeps
 * "Batches", "Stock" and "Workers" up to date, so every station and every person sees the same numbers.
 */

// Change this to your own secret word, and type the same word in the app's Settings.
var ACCESS_KEY = 'change-me';

var STAGES = ['Label printed', 'Cutting', 'Stitching · base', 'Stitching · sides', 'Final finishing', 'Packing', 'On rack'];
var TABS = {
  Scans:   ['Event ID', 'Time', 'Type', 'Worker ID', 'Worker', 'Batch', 'Net ID', 'Net', 'Qty', 'Rejected', 'Box', 'Note', 'Station'],
  Batches: ['Batch', 'Net ID', 'Net', 'Qty', 'Good', 'Current step', 'Step no', 'Created', 'Created by', 'Box',
            'Cutting by', 'Cutting at', 'Base by', 'Base at', 'Sides by', 'Sides at', 'Finish by', 'Finish at', 'Packing by', 'Packing at', 'Rack-in by', 'Rack-in at', 'Rejected total'],
  Stock:   ['Net ID', 'Net', 'On hand', 'Last change', 'Last change at'],
  Workers: ['Badge', 'Name', 'Main step'],
  Boxes:   ['Box', 'State', 'Net ID', 'Batch', 'Made', 'Updated', 'By']
};
// Layout v7: every box slot on racks A-C. "empty" boxes are on the refill list; Made drives first made, first shipped.

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
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

// ---------- read: every station pulls the shared state ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.key !== ACCESS_KEY) return json_({ ok: false, error: 'Wrong access key' });
  var stock = {};
  rows_('Stock').forEach(function (r) { stock[r[0]] = Number(r[2]) || 0; });
  var batches = rows_('Batches').map(function (r) {
    var o = { id: r[0], net: r[1], qty: Number(r[3]), good: Number(r[4]), stage: Number(r[6]), created: iso_(r[7]), by: r[8], loc: r[9] || null, steps: [] };
    for (var s = 1; s <= 6; s++) o.steps.push({ by: r[8 + s * 2], at: iso_(r[9 + s * 2]) });
    return o;
  });
  var workers = rows_('Workers').map(function (r) { return { id: r[0], name: r[1], role: r[2] }; });
  var scans = rows_('Scans');
  var log = scans.slice(-300).reverse().map(function (r) {
    return { id: r[0], t: iso_(r[1]), type: r[2], who: r[3], wo: r[5], net: r[6], qty: r[8] === '' ? null : Number(r[8]), loc: r[10], note: r[11] };
  });
  var rates = {};
  var nets = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Nets');
  if (nets && nets.getLastRow() > 1) nets.getRange(2, 1, nets.getLastRow() - 1, 4).getValues().forEach(function (r) { if (r[0]) rates[r[0]] = Number(r[3]) || 0; });
  var boxes = {};
  rows_('Boxes').forEach(function (r) { if (r[0]) boxes[r[0]] = { state: r[1] || 'full', net: r[2] || '', wo: r[3] || '', made: iso_(r[4]) || null, at: iso_(r[5]), by: r[6] || '' }; });
  return json_({ ok: true, stock: stock, batches: batches, workers: workers, log: log, rates: rates, boxes: boxes, at: new Date().toISOString() });
}
function iso_(v) { return (v && typeof v.getTime === 'function') ? new Date(v.getTime()).toISOString() : (v ? String(v) : ''); }

// ---------- write: the app posts a list of scan events ----------
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad JSON' }); }
  if (body.key !== ACCESS_KEY) return json_({ ok: false, error: 'Wrong access key' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var seen = {};
    rows_('Scans').slice(-2000).forEach(function (r) { seen[r[0]] = true; });
    var done = [];
    (body.events || []).forEach(function (ev) {
      if (!ev || !ev.id) return;
      if (!seen[ev.id]) { apply_(ev, body.station || ''); seen[ev.id] = true; }
      done.push(ev.id);
    });
    return json_({ ok: true, saved: done });
  } finally {
    lock.releaseLock();
  }
}

function apply_(ev, station) {
  var t = ev.t ? new Date(ev.t) : new Date();
  if (ev.type === 'WORKER') {
    var w = findRow_('Workers', ev.who);
    if (w) sheet_('Workers').getRange(w.row, 2, 1, 2).setValues([[ev.name, ev.role]]);
    else sheet_('Workers').appendRow([ev.who, ev.name, ev.role]);
    return;
  }
  sheet_('Scans').appendRow([ev.id, t, ev.type, ev.who || '', workerName_(ev.who), ev.wo || '', ev.net || '', ev.netName || '',
    ev.qty == null ? '' : ev.qty, ev.rej || '', ev.loc || '', ev.note || '', station]);

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
    if (ev.type === 'IN' && ev.loc && ev.loc !== '2F') box_(ev.loc, 'full', ev.net, ev.wo, ev.made, t, ev.who);
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
