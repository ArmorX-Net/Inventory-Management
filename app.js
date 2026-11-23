// ArmorX office sheet. Everyone signs in with their employee number and their own PIN (kept, hashed, in the
// Workers tab of the sheet). The sheet script checks the sign-in on every read and write, so this public link
// shows nothing without it. No PIN, password or key is stored in this code.
var ARMORX_SHEET = { url: 'https://script.google.com/macros/s/AKfycbzqgIpFXyYFOn4t5Pquha2u15oRcCB0bfSFbx0Iy2UJpM2oXX32DMyGtihxMTZvzgJeFw/exec', key: '' };
/* ArmorX Inventory — demo build.
   One batch label travels through every step. The USB scanner types the code and presses Enter,
   so every scan arrives in the Scan station text box like keyboard input.
   Data is kept in this browser (localStorage). A shared database comes in the next phase. */
(function () {
  'use strict';
  var NETS = window.DOORNETS || [];
  var BOXES = window.BOXES || {}, BY_ID = {};
  NETS.forEach(function (n) { BY_ID[n.id] = n; });
  var FLOOR2 = 'TOP'; // extra stock on top of the racks (above R5), refills the boxes. Old '2F' labels still scan as TOP.
  var TOP_BOX = 25; // owner 22 Nov 2026: stock on top sits in full boxes of 25, plus part boxes; no limit on how many
  // Top of the racks (owner 22 Nov 2026, Code.gs v10): the TOP number is all nets on top; part boxes are kept by their counts
  // (e.g. [22, 14]). Full boxes = (nets on top - part boxes) / 25. A number left over (an older count) shows as one more part box.
  function fitParts(p, q) { p = (p || []).map(function (x) { return Math.round(Number(x) || 0); }).filter(function (x) { return x > 0; }); var s = sum(p); while (s > q && p.length) s -= p.pop(); return p; }
  function sum(a) { return (a || []).reduce(function (x, y) { return x + (Number(y) || 0); }, 0); }
  function topSplit(q, parts) {
    q = Math.max(0, Number(q) || 0); var p = fitParts(parts, q), rest = q - sum(p), full = Math.floor(rest / TOP_BOX), left = rest - full * TOP_BOX;
    return { full: full, parts: left ? p.concat([left]) : p, kept: p, q: q };
  }
  function topText(t, short) { // "18 full boxes + 1 part box (22) = 472"
    var bits = [];
    if (t.full) bits.push(t.full + ' full box' + (t.full > 1 ? 'es' : ''));
    if (t.parts.length) bits.push(t.parts.length === 1 ? '1 part box (' + t.parts[0] + ')' : t.parts.length + ' part boxes (' + t.parts.join(', ') + ')');
    return bits.length ? bits.join(' + ') + (short ? '' : ' = ' + t.q) : '0';
  }
  // 11 Nov 2026 (owner): no R6 boxes for now. Extra stock sits on top of the racks (TOP) with no fixed places, so a pick box
  // without a backup refills straight from TOP. 22 Nov 2026 (layout v8): racks A-D in one size order, one colour per box,
  // 210x100 keeps backups on R2 and R4 (AR C1-C3). data/doornets.js has no R6 boxes any more; USE_R6 only matters if they come back.
  var USE_R6 = false;
  if (!USE_R6) {
    Object.keys(BOXES).forEach(function (c) { if (/-R6$/.test(c)) delete BOXES[c]; });
    NETS.forEach(function (n) {
      n.backups = (n.backups || []).filter(function (c) { return BOXES[c]; });
      n.home = 'Pick ' + n.pick + (n.backups.length ? ' · backup ' + n.backups.join(', ') : '');
      n.cap = [n.pick].concat(n.backups).reduce(function (a, c) { var b = BOXES[c]; return a + (b ? (b.mix ? b.mix[n.id] : b.cap) : 0); }, 0);
    });
  }
  function netsAt(code) { var b = BOXES[code]; return b ? b.nets.map(function (id) { return BY_ID[id]; }) : []; }
  function homeOf(n) { return [n.pick].concat(n.backups || []); }
  function sideOrder(a, b) { var sides = window.SIDES || []; var x = a.match(/^(\w\w)-C(\d)-R(\d)$/), y = b.match(/^(\w\w)-C(\d)-R(\d)$/); if (!x || !y) return a < b ? -1 : 1; return sides.indexOf(x[1]) - sides.indexOf(y[1]) || x[2] - y[2] || y[3] - x[3]; }
  var STAGES = ['Label printed', 'Cutting', 'Stitching · base', 'Stitching · sides', 'Final finishing', 'Packing', 'On rack'];
  var SHORT = ['Label', 'Cut', 'Base', 'Sides', 'Finish', 'Pack', 'Rack'];
  var COLORS = ['Black', 'Brown', 'Grey'];
  var KEY = 'armorx-inv-v1';
  var TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // ---------- state ----------
  function blank() {
    return { seq: 0, batches: {}, stock: {}, log: [], workers: [
      { id: 'EMP-01', name: 'Worker 1', role: 'Cutting' },
      { id: 'EMP-02', name: 'Worker 2', role: 'Stitching · base' },
      { id: 'EMP-03', name: 'Worker 3', role: 'Stitching · sides' },
      { id: 'EMP-04', name: 'Worker 4', role: 'Final finishing' },
      { id: 'EMP-05', name: 'Worker 5', role: 'Packing' },
      { id: 'EMP-06', name: 'Worker 6', role: 'Racks & dispatch' }
    ], settings: { batchSize: '50x25' }, boxes: {}, counts: {}, shelf: {}, demo: false };
  }
  var S;
  function load() {
    try { var raw = localStorage.getItem(KEY); S = raw ? JSON.parse(raw) : null; } catch (e) { S = null; }
    if (!S) { S = blank(); seedDemo(); }
    if (!S.boxes || S.layout !== window.LAYOUT_VERSION) { S.boxes = {}; S.layout = window.LAYOUT_VERSION; }
    S.counts = S.counts || {}; // box count (opening count): 'BOX|NET' -> { box, net, qty, at, by }
    S.shelf = S.shelf || {}; // put away: how many went in each box (or TOP), 'BOX|NET' -> { box, net, qty, at, by }. Already in stock.
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function onHand(id) { return S.stock[id] || 0; }
  function now() { return new Date().toISOString(); }
  function fmtT(iso) { var d = new Date(iso); return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function isToday(iso) { var d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function worker(id) { return S.workers.filter(function (w) { return w.id === id; })[0]; }
  function wname(id) { var w = worker(id); return w ? w.name : (id || '—'); }
  function status(n) { var q = onHand(n.id); return q <= 0 ? 'out' : (q <= n.refillAt ? 'low' : 'ok'); }
  var noSync = false;
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function isUndone(e) { return !!(e && (e.undone || / · UNDONE/.test(e.note || ''))); }
  function addLog(e) {
    e.id = e.id || newId(); e.t = e.t || now(); S.log.unshift(e); if (S.log.length > 5000) S.log.length = 5000;
    queue(Object.assign({}, e));
    return e;
  }
  function queue(ev) {
    if (noSync || !sheetOn()) return;
    ev.id = ev.id || newId();
    ev.t = ev.t || now();
    if (ev.net && BY_ID[ev.net]) ev.netName = netLabel(BY_ID[ev.net]);
    ev._t = S.auth ? S.auth.t : ''; // sent with the sign-in of the person who scanned it, even if the phone changes hands
    S.queue = S.queue || []; S.queue.push(ev); save(); setTimeout(flush, 50);
  }
  function netLabel(n) { return n.size + ' ' + n.color; }
  function newBatch(id, qty, by, t) {
    S.seq += 1;
    var wo = 'WO-' + String(S.seq).padStart(4, '0');
    S.batches[wo] = { id: wo, net: id, qty: qty, good: qty, stage: 0, created: t || now(), by: by || 'Manager', history: [{ stage: 0, by: by || 'Manager', qty: qty, rej: 0, t: t || now() }], loc: null };
    addLog({ t: t, type: 'BATCH', who: by || 'Manager', wo: wo, net: id, qty: qty, note: 'Label printed' });
    return S.batches[wo];
  }

  // ---------- demo data ----------
  function seedDemo() {
    noSync = true;
    var names = ['Ramesh', 'Sunita', 'Imran', 'Pooja', 'Arjun', 'Vikas'];
    S.workers.forEach(function (w, i) { w.name = names[i] + ' (sample)'; });
    var h = 7;
    function rnd() { h = (h * 9301 + 49297) % 233280; return h / 233280; }
    NETS.forEach(function (n) {
      var r = rnd();
      S.stock[n.id] = r < 0.06 ? 0 : (r < 0.2 ? Math.max(1, Math.round(n.refillAt * rnd())) : Math.round(n.cap * (0.35 + 0.6 * rnd())));
    });
    var base = Date.now() - 1000 * 60 * 60 * 26;
    var plan = [['DN-210x100-BK', 100, 6], ['DN-210x100-GR', 100, 5], ['DN-200x100-BK', 60, 4], ['DN-250x150-GR', 60, 3], ['DN-210x95-BR', 60, 2], ['DN-205x90-GR', 40, 1], ['DN-210x100-BR', 100, 0]];
    plan.forEach(function (p, i) {
      var t0 = base + i * 1000 * 60 * 40;
      var b = newBatch(p[0], p[1], 'Manager', new Date(t0).toISOString());
      for (var s = 1; s <= Math.min(p[2], 5); s++) {
        var rej = (s === 2 && i % 2 === 0) ? 2 : 0;
        b.good -= rej; b.stage = s;
        var t = new Date(t0 + s * 1000 * 60 * 75).toISOString();
        b.history.push({ stage: s, by: S.workers[s - 1].id, qty: b.good, rej: rej, t: t });
        addLog({ t: t, type: 'STAGE', who: S.workers[s - 1].id, wo: b.id, net: b.net, qty: b.good, note: STAGES[s] + (rej ? ' · ' + rej + ' rejected' : '') });
      }
      if (p[2] === 6) {
        var n = BY_ID[b.net], t6 = new Date(t0 + 7 * 1000 * 60 * 75).toISOString();
        b.stage = 6; b.loc = FLOOR2; S.stock[b.net] = onHand(b.net) + b.good;
        b.history.push({ stage: 6, by: 'EMP-06', qty: b.good, rej: 0, t: t6, loc: b.loc });
        addLog({ t: t6, type: 'IN', who: 'EMP-06', wo: b.id, net: b.net, qty: b.good, loc: b.loc, note: 'Rack-in' });
      }
    });
    [['DN-210x100-GR', 6, 'OUT'], ['DN-205x100-BR', 2, 'OUT'], ['DN-210x100-BK', 40, 'FBA'], ['DN-200x90-GR', 1, 'RETURN']].forEach(function (o, i) {
      var n = BY_ID[o[0]]; if (!n) return;
      var q = o[2] === 'RETURN' ? o[1] : -o[1];
      S.stock[n.id] = Math.max(0, onHand(n.id) + q);
      addLog({ t: new Date(Date.now() - (i + 1) * 1000 * 60 * 23).toISOString(), type: o[2], who: 'EMP-06', net: n.id, qty: o[1], loc: n.pick, note: o[2] === 'FBA' ? 'FBA shipment' : (o[2] === 'OUT' ? 'Order pick' : 'Customer return · good') });
    });
    S.log.sort(function (a, b) { return a.t < b.t ? 1 : -1; });
    S.demo = true; noSync = false; save();
  }

  // ---------- helpers: barcode, toast, beep ----------
  // Barcodes for the thermal printer (best practice for 1D Code 128 scanners):
  // - drawn as vector bars, never a barcode font and never stretched to fit (stretching gives uneven bars that scanners reject)
  // - every bar is a whole number of printer dots: 1 module = 0.254 mm = 2 dots at 203 dpi, 3 dots at 300 dpi
  // - quiet zone of at least 10 modules (2.5 mm) of white on both sides, bars as tall as the label allows, pure black
  var MODULE_MM = 0.254, QUIET = 10, MAX_MM = 47;
  function barcode(svg, code, opts, cssH) {
    if (!svg) return;
    try {
      window.JsBarcode(svg, code, { format: 'CODE128', displayValue: false, margin: 0, height: 100, width: 1, lineColor: '#000', background: '#fff' });
      var modules = parseFloat(svg.getAttribute('width')) || 100, mm = MODULE_MM;
      while ((modules + 2 * QUIET) * mm > MAX_MM && mm > 0.191) mm -= 0.0635; // very long codes only: step down whole dots
      svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('shape-rendering', 'crispEdges');
      svg.style.width = (modules * mm).toFixed(3) + 'mm'; svg.style.height = cssH || '10mm';
      svg.style.margin = '0 auto'; svg.style.padding = '0 ' + (QUIET * mm).toFixed(2) + 'mm'; svg.style.boxSizing = 'content-box'; svg.style.maxWidth = 'none';
    } catch (e) { svg.outerHTML = '<div class="mono small">' + esc(code) + ' (barcode library not loaded)</div>'; }
  }
  var toastT;
  function toast(msg) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 3200);
  }
  var actx;
  function beep(ok) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = ok ? 1250 : 220; o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.08; o.connect(g); g.connect(actx.destination); o.start();
      o.stop(actx.currentTime + (ok ? 0.09 : 0.35));
    } catch (e) {}
  }

  // ---------- label builders ----------
  function batchLabel(b) { // 50 x 25 mm thermal label (one per page): batch, made date, net, quantity, barcode
    var n = BY_ID[b.net], el = document.createElement('div');
    el.className = 'lbl lbl-batch';
    el.innerHTML = '<div class="t"><b>' + esc(b.id) + '</b><span class="made">MADE ' + esc(new Date(b.created).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()) + '</span></div>' +
      '<div class="main"><div class="size">' + esc(n.size.replace('x', '×')) + ' <span class="color">' + esc(n.color.toUpperCase()) + '</span></div><div class="qty">' + b.qty + ' <small>NETS</small></div></div>' +
      '<svg class="bc"></svg>' +
      '<div class="t"><span>PICK ' + esc(n.pick) + '</span><span>FIRST MADE, FIRST OUT</span></div>';
    barcode(el.querySelector('.bc'), b.id, null, '9mm');
    return el;
  }
  // shelf label (owner 22 Nov 2026): the net's size and colour in big bold letters, the box code small underneath.
  // The same label goes on the shelf and on the front of the box. The barcode is the box code, so scanning still finds the box.
  function boxLabel(code) {
    var bx = BOXES[code], list = netsAt(code), n = list[0], el = document.createElement('div'), bin = bx && bx.kind === 'bin', bk = bx && bx.role === 'backup';
    el.className = 'lbl lbl-loc' + (bk ? ' backup' : '');
    el.innerHTML = '<div class="ll-net"><span class="ll-size">' + esc(n ? n.size.replace('x', '×') : 'free') + '</span> <span class="ll-col">' + esc(bin ? 'BK | BR | GR' : (n ? n.color.toUpperCase() : '')) + '</span></div>' +
      '<svg class="bc"></svg><div class="ll-code"><span>' + esc(code) + '</span><span class="role">' + (bk ? 'BACKUP' : 'PICK') + '</span></div>';
    barcode(el.querySelector('.bc'), code, null, '8.5mm');
    return el;
  }
  function floorLabel() {
    var el = document.createElement('div'); el.className = 'lbl lbl-cmd';
    el.innerHTML = '<div class="mono" style="font-size:6.5pt">ARMORX · LOCATION</div><div class="nm">TOP · extra stock on top of racks</div><svg class="bc"></svg><div class="mono" style="font-size:6.5pt;text-align:center">TOP</div>';
    barcode(el.querySelector('.bc'), FLOOR2, null, '10mm');
    return el;
  }
  function sideSign(side, big) { // rack side sign: big side code + size range, 3 per A4 page (or one per A4 landscape when big), cut and laminate
    var rg = (window.SIDE_RANGES || {})[side] || ['', ''], el = document.createElement('div'); el.className = 'sign' + (big ? ' big' : '');
    el.innerHTML = '<div class="sg-side' + (/R$/.test(side) ? ' r' : '') + '">' + esc(side) + '</div><div class="sg-body"><div class="sg-rng"><div>' + esc(rg[0].replace('x', '×')) + ' <span>to</span></div><div>' + esc(rg[1].replace('x', '×')) + '</div></div>' +
      (side === 'AR' ? '<div class="sg-star">★ 210×100: C1–C3, pick R3</div>' : '') + '</div>';
    return el;
  }
  // rack layout sheet: one A4 landscape page per rack side, a picture of every box (C1-C6 left to right, R5 on top, R1 = floor)
  var CNAME = { BK: 'Black', BR: 'Brown', GR: 'Grey' };
  function rackSheet(side) {
    var COLS = window.RACK_COLS || 6, rg = (window.SIDE_RANGES || {})[side] || ['', ''], el = document.createElement('div'); el.className = 'rsheet';
    var t = '<div class="rs-h"><span class="rs-side">' + esc(side) + '</span><span class="rs-rng">' + esc(rg[0].replace('x', '×')) + ' to ' + esc(rg[1].replace('x', '×')) + '</span>' +
      (side === 'AR' ? '<span class="rs-star">★ 210×100: C1–C3, pick from R3</span>' : '') + '</div><table class="rs-t"><thead><tr><th></th>';
    for (var c = 1; c <= COLS; c++) t += '<th>C' + c + '</th>';
    t += '</tr></thead><tbody>';
    for (var r = 5; r >= 1; r--) {
      t += '<tr><th>R' + r + (r === 1 ? '<small>floor</small>' : '') + '</th>';
      for (var c2 = 1; c2 <= COLS; c2++) {
        var code = side + '-C' + c2 + '-R' + r, bx = BOXES[code];
        if (!bx) { t += '<td class="free">free</td>'; continue; }
        var list = netsAt(code), n = list[0];
        t += '<td class="' + (bx.role === 'backup' ? 'bkp' : '') + '"><div class="rs-sz">' + esc(n.size.replace('x', '×')) + '</div>' +
          (bx.kind === 'bin' ? '<div class="rs-col">3 bins<div class="rs-bins">Black · Brown · Grey</div></div>' : '<div class="rs-col">' + esc(n.color) + '</div>') +
          '<div class="rs-code">' + esc(code) + (bx.role === 'backup' ? ' · <b>BACKUP</b>' : '') + '</div></td>';
      }
      t += '</tr>';
    }
    el.innerHTML = t + '</tbody></table><div class="rs-foot">ArmorX door nets · side ' + esc(side) + '. C1 to C6 left to right as you face this side. R1 is the floor row. Colors always Black, Brown, Grey left to right. Extra stock goes on top of the racks (TOP).</div>';
    return el;
  }
  function badgeLabel(w) {
    var el = document.createElement('div'); el.className = 'lbl lbl-badge';
    el.innerHTML = '<div class="sub mono" style="font-size:6.5pt">ARMORX · WORKER</div><div class="nm">' + esc(w.name) + '</div><div class="mono" style="font-size:6.5pt">' + esc(w.id) + ' · ' + esc(w.role) + '</div><svg class="bc"></svg>';
    barcode(el.querySelector('.bc'), w.id, null, '10mm');
    return el;
  }
  var COMMANDS = [['CMD-OUT', 'OUT · order pick'], ['CMD-FBA', 'OUT · FBA shipment'], ['CMD-RETURN', 'RETURN · back to stock'], ['CMD-DAMAGED', 'RETURN · damaged'], ['CMD-COUNT', 'COUNT · correct total'], ['CMD-SWAP', 'SWAP · backup down'], ['CMD-REFILL', 'REFILL · from TOP'], ['CMD-EMPTY', 'EMPTY · box ran out'], ['CMD-CANCEL', 'CANCEL · clear'], ['CMD-UNDO', 'UNDO · my last scan'], ['CMD-BOXCOUNT', 'BOX COUNT · count shelves'], ['QTY-1', 'Qty 1'], ['QTY-5', 'Qty 5'], ['QTY-10', 'Qty 10'], ['QTY-20', 'Qty 20'], ['QTY-25', 'Qty 25']];
  function cmdLabel(c) {
    var el = document.createElement('div'); el.className = 'lbl lbl-cmd';
    el.innerHTML = '<div class="mono" style="font-size:6.5pt">ARMORX · COMMAND</div><div class="nm">' + esc(c[1]) + '</div><svg class="bc"></svg><div class="mono" style="font-size:6.5pt;text-align:center">' + esc(c[0]) + '</div>';
    barcode(el.querySelector('.bc'), c[0], null, '10mm');
    return el;
  }
  // LABEL SIZES (owner 23 Nov 2026): the thermal printer takes two label rolls. Every label print asks which one is in it,
  // and the label fills that exact size, one label per page. A4 is only for lists and the rack side signs.
  //   Small 50 x 25 mm (page 50.3 x 25.1 mm, the ArmorX Word label template) · Large 152.4 x 101.6 mm (4 x 6 inch, always landscape:
  //   owner 23 Nov 2026 evening)
  var LBL_SIZES = { S: { name: 'Small', dim: '50 × 25 mm', page: '50.3mm 25.1mm', margin: '0.25mm 0.25mm 0 0.25mm' }, L: { name: 'Large', dim: '4 × 6 in, landscape', page: '152.4mm 101.6mm', margin: '0' } };
  function printLabels(nodes, size) {
    if (size !== '50x25') { printNow(nodes, size); return; }
    askLabelSize(function (k) { printNow(nodes, k); });
  }
  function askLabelSize(go) { // which labels are in the printer? Small or Large, remembered on this phone
    var old = document.getElementById('lblAsk'); if (old) old.remove();
    var last = (S.settings && S.settings.lblSize) || 'S', el = document.createElement('div');
    el.className = 'pop'; el.id = 'lblAsk';
    el.innerHTML = '<div class="pop-card lbl-ask" role="dialog" aria-modal="true" aria-label="Label size"><h3>Which labels are in the printer?</h3><div class="lbl-ask-b">' +
      ['S', 'L'].map(function (k) { var z = LBL_SIZES[k]; return '<button type="button" class="btn' + (k === last ? ' primary' : '') + '" data-lsz="' + k + '"><b>' + z.name + '</b><span>' + z.dim + '</span></button>'; }).join('') +
      '</div><div class="small">In the print box: paper size the same as the labels, margins <b>None</b>, scale <b>100</b>, and untick <b>Headers and footers</b>.</div><button type="button" class="btn dark pop-x" data-lsz="">Cancel</button></div>';
    document.body.appendChild(el); document.body.classList.add('pop-on');
    var close = function () { el.remove(); document.body.classList.remove('pop-on'); };
    el.onclick = function (e) {
      var b = e.target.closest('[data-lsz]'); if (!b && e.target !== el) return;
      close(); if (!b || !b.dataset.lsz) return;
      S.settings = S.settings || {}; S.settings.lblSize = b.dataset.lsz; save(); go(b.dataset.lsz);
    };
  }
  function sizeBarcodes(area, big) { // a large label gets a bigger barcode: whole printer dots, quiet zones kept, never stretched
    if (!big) return;
    area.querySelectorAll('svg.bc').forEach(function (svg) {
      var modules = parseFloat(svg.getAttribute('width')) || 100, mm = 0.508;
      while ((modules + 2 * QUIET) * mm > 130 && mm > 0.254) mm -= 0.127;
      svg.style.width = (modules * mm).toFixed(3) + 'mm'; svg.style.height = '26mm'; svg.style.padding = '0 ' + (QUIET * mm).toFixed(2) + 'mm';
    });
  }
  function printNow(nodes, size) {
    var area = document.getElementById('print-area'); area.innerHTML = '';
    nodes.forEach(function (n) { area.appendChild(n); });
    var lbl = LBL_SIZES[size];
    area.className = lbl ? 'lbl-' + size : '';
    sizeBarcodes(area, size === 'L');
    var st = document.getElementById('page-size');
    if (!st) { st = document.createElement('style'); st.id = 'page-size'; document.head.appendChild(st); }
    var dim = lbl ? lbl.page : size === 'A4' ? 'A4 landscape' : 'A4 portrait';
    st.textContent = '@page{size:' + dim + ';margin:' + (lbl ? lbl.margin : '10mm') + '}';
    toast(lbl ? 'Opening print dialog: thermal printer, ' + lbl.name + ' labels ' + lbl.dim + ', margins None, no headers and footers.' : 'Opening print dialog: normal printer, ' + dim + '.');
    setTimeout(function () { try { window.print(); } catch (e) {} }, 150);
  }

  // ---------- views ----------
  var app = document.getElementById('app');
  function h(html) { app.innerHTML = '<div class="view">' + html + '</div>'; }

  // opening count on the dashboard: put aways are already in the totals above; box counts still wait for Apply
  function countCard() {
    var keys = Object.keys(S.shelf || {}), put = 0, top = 0, boxes = {}, nets = {}, today = 0;
    keys.forEach(function (k) { var r = S.shelf[k], q = Number(r.qty) || 0; if (!q) return; nets[r.net] = 1; if (r.box === FLOOR2) top += q; else { put += q; boxes[r.box] = 1; } });
    S.log.forEach(function (e) { if (e.type === 'BOXADD' && isToday(e.t) && !isUndone(e)) today += Number(e.qty) || 0; });
    var waiting = Object.keys(S.counts || {}).length;
    if (!keys.length && !waiting) return '';
    return '<div class="card"><h3>Opening count</h3><div class="small">' +
      (keys.length ? 'Put away so far: <b>' + put + '</b> nets in <b>' + Object.keys(boxes).length + '</b> boxes' + (top ? ' + <b>' + top + '</b> on top of the racks' : '') + ' (' + Object.keys(nets).length + ' kinds of net' + (today ? ', ' + today + ' put away today' : '') + '). These are already in the totals above.' : '') +
      (waiting ? (keys.length ? '<br>' : '') + '<b>' + waiting + '</b> box recounts are waiting: they change stock only after <a href="#stock">Stock → Box recount → Review and apply</a>.' : '') + '</div></div>';
  }
  function viewDashboard() {
    var total = 0, out = 0, low = 0;
    NETS.forEach(function (n) { var q = onHand(n.id); total += q; if (q <= 0) out++; else if (q <= n.refillAt) low++; });
    var open = woOpen(), inProd = open.reduce(function (a, o) { return a + Math.max(0, o.qty - o.racked - o.rejected); }, 0);
    var outToday = 0, inToday = 0;
    S.log.forEach(function (e) { if (!isToday(e.t) || isUndone(e)) return; if (e.type === 'OUT' || e.type === 'FBA') outToday += e.qty; if (e.type === 'IN' || e.type === 'RETURN' || e.type === 'WOIN') inToday += e.qty; });
    var cols = STAGES.map(function (s, i) {
      var items = Object.values(S.batches).filter(function (b) { return i < 6 ? b.stage === i : (b.stage === 6 && isToday(b.history[b.history.length - 1].t)); });
      return '<div class="col"><h4><span>' + (i < 6 ? esc(s) : 'Racked today') + '</span><span>' + items.length + '</span></h4>' +
        items.map(function (b) { var n = BY_ID[b.net]; var last = b.history[b.history.length - 1];
          return '<div class="wo c-' + n.color + '" data-wo="' + b.id + '"><b>' + b.id + '</b><br>' + esc(netLabel(n)) + ' · ' + b.good + '<br><span class="muted">' + esc(wname(last.by)) + '</span></div>'; }).join('') + '</div>';
    }).join('');
    var lows = NETS.filter(function (n) { return status(n) !== 'ok'; }).sort(function (a, b) { return (b.perDay - a.perDay) || (onHand(a.id) - onHand(b.id)); }).slice(0, 12);
    var lowRows = lows.map(function (n) {
      var need = Math.max(20, Math.ceil((n.cap - onHand(n.id)) / 20) * 20);
      var st = status(n);
      return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + esc(n.pick) + '</code></td><td>' + onHand(n.id) + '</td><td>' + (n.perDay || '—') + '</td><td><span class="pill ' + (st === 'out' ? 'p-bad">Out' : 'p-warn">Low') + '</span></td><td><button class="btn" data-make="' + n.id + '" data-qty="' + need + '">Make ' + need + '</button></td></tr>';
    }).join('');
    var perWorker = {}, today = woDaysAgo(0); // work order steps done today, per person (from the sheet)
    (woState().daily || []).forEach(function (r) { if (r.day !== today || !r.done) return; var p = perWorker[r.who] = perWorker[r.who] || { name: r.name || wname(r.who), steps: {}, n: 0 }; p.steps[r.step] = (p.steps[r.step] || 0) + r.done; p.n += r.done; });
    var wRows = Object.keys(perWorker).sort(function (a, b) { return perWorker[b].n - perWorker[a].n; }).map(function (id) { var p = perWorker[id]; return '<tr><td>' + esc(p.name) + '</td><td class="muted small">' + esc(Object.keys(p.steps).map(function (k) { return p.steps[k] + ' ' + k; }).join(', ')) + '</td><td>' + p.n + '</td></tr>'; }).join('') || '<tr><td colspan="3" class="muted">No work order steps done yet today.</td></tr>';
    h('<div class="row" style="justify-content:space-between;align-items:center"><h2>Today at a glance</h2><div class="row"><a class="btn primary" href="#orders">New work order</a><a class="btn dark" href="#scan">Open scan station</a></div></div>' +
      '<div class="grid">' +
      kpi(total.toLocaleString(), 'Doornets on racks', '') + kpi(out, 'Nets out of stock', out ? 'bad' : 'ok') + kpi(low, 'Below refill level', low ? 'warn' : 'ok') +
      kpi(open.length + ' · ' + inProd, 'Work orders · nets in production', open.some(woLate) ? 'warn' : '') + kpi(inToday, 'In today (rack-in + returns)', '') + kpi(outToday, 'Out today (orders + FBA)', '') + '</div>' +
      countCard() + pickCard() +
      woBoard() + (Object.values(S.batches).some(function (b) { return b.stage < 6; }) ? '<div class="card"><h3>Older batch labels</h3><div class="tablewrap" style="border:none"><div class="board">' + cols + '</div></div></div>' : '') +
      '<div class="grid2"><div class="card"><h3>Needs attention</h3><div class="tablewrap"><table><thead><tr><th>Net</th><th>Rack</th><th>On hand</th><th>Sells/day</th><th></th><th></th></tr></thead><tbody>' + (lowRows || '<tr><td colspan="6" class="muted">Everything is above its refill level.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="card"><h3><a href="#production">Work order steps done today</a></h3><div class="tablewrap"><table><thead><tr><th>Name</th><th>Steps</th><th>Nets</th></tr></thead><tbody>' + wRows + '</tbody></table></div>' +
      '<h3>Last scans</h3><div class="tablewrap"><table><tbody>' + S.log.slice(0, 8).map(logRow).join('') + '</tbody></table></div></div></div>');
    app.querySelectorAll('[data-make]').forEach(function (b) { b.onclick = function () { location.hash = '#batches'; setTimeout(function () { prefill(b.dataset.make, b.dataset.qty); }, 30); }; });
    app.querySelectorAll('[data-wo]').forEach(function (d) { d.onclick = function () { showBatch(d.dataset.wo); }; });
  }
  function pickCard() { // today's pick lists for the manager: how far each is, and who said picking is done
    var lists = shownPicks(); if (!lists.length) return '';
    return '<div class="card"><h3><a href="#pick">Pick lists</a></h3><div class="small pl-dash">' + lists.map(function (p) {
      var m = pickSum(p);
      return '<div><b>' + esc(pickTitle(p)) + '</b> · ' + m.got + ' of ' + m.all + ' picked · ' + doneLine(p) + '</div>';
    }).join('') + '</div></div>';
  }
  function kpi(n, l, cls) { return '<div class="card kpi ' + cls + '"><span class="n">' + n + '</span><span class="l">' + esc(l) + '</span></div>'; }
  function logRow(e) {
    var n = BY_ID[e.net];
    var typ = { STAGE: 'p-mute', IN: 'p-ok', OUT: 'p-warn', FBA: 'p-warn', RETURN: 'p-ok', DAMAGED: 'p-bad', COUNT: 'p-mute', BATCH: 'p-mute', UNDO: 'p-bad' }[e.type] || 'p-mute';
    return '<tr' + (isUndone(e) ? ' class="undone"' : '') + '><td class="muted">' + fmtT(e.t) + '</td><td><span class="pill ' + typ + '">' + esc(e.type) + '</span></td><td>' + esc(wname(e.who)) + '</td><td>' + (e.wo ? '<code>' + esc(e.wo) + '</code> ' : '') + esc(n ? netLabel(n) : (e.net || '')) + '</td><td>' + (e.qty != null ? e.qty : '') + '</td><td>' + (e.loc ? '<code>' + esc(e.loc) + '</code>' : '') + '</td><td class="muted">' + esc(e.note || '') + '</td></tr>';
  }

  function showBatch(wo) {
    var b = S.batches[wo]; if (!b) return;
    location.hash = '#batches';
    setTimeout(function () {
      var el = document.getElementById('batchDetail'); if (!el) return;
      renderBatchDetail(el, b); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }
  function stepsHtml(b) {
    return '<div class="steps">' + SHORT.map(function (s, i) { return '<span class="' + (i <= b.stage ? 'done' : (i === b.stage + 1 ? 'next' : '')) + '">' + s + '</span>'; }).join('') + '</div>';
  }
  function renderBatchDetail(el, b) {
    var n = BY_ID[b.net];
    el.innerHTML = '<div class="row" style="justify-content:space-between"><h3>' + b.id + ' · ' + esc(netLabel(n)) + ' · ' + b.qty + ' nets</h3><div class="row"><button class="btn" id="boxtags">Box tags (' + Math.max(1, Math.ceil(b.good / 20)) + ')</button><button class="btn primary" id="reprint">Print label</button></div></div>' + stepsHtml(b) +
      '<div class="row"><div id="lblPrev"></div><div class="tablewrap" style="flex:1"><table><thead><tr><th>Step</th><th>Who</th><th>Good</th><th>Rejected</th><th>When</th></tr></thead><tbody>' +
      b.history.map(function (x) { return '<tr><td>' + esc(STAGES[x.stage]) + (x.loc ? ' <code>' + esc(x.loc) + '</code>' : '') + '</td><td>' + esc(wname(x.by)) + '</td><td>' + x.qty + '</td><td>' + (x.rej || '') + '</td><td class="muted">' + fmtT(x.t) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    el.querySelector('#lblPrev').appendChild(batchLabel(b));
    el.querySelector('#reprint').onclick = function () { printLabels([batchLabel(b)], '50x25'); };
    var tg = el.querySelector('#boxtags'); if (tg) tg.onclick = function () { var k = Math.max(1, Math.ceil(b.good / 20)), arr = []; for (var i = 0; i < k; i++) arr.push(batchLabel(b)); printLabels(arr, '50x25'); };
    el.hidden = false;
  }
  function prefill(id, qty) {
    var n = BY_ID[id]; if (!n) return;
    var s = document.getElementById('fSize'), c = document.getElementById('fColor'), q = document.getElementById('fQty');
    if (s) { s.value = n.size; c.value = n.color; q.value = qty; updateHint(); q.focus(); }
  }
  function updateHint() {
    var s = document.getElementById('fSize'), c = document.getElementById('fColor'), hint = document.getElementById('fHint');
    if (!s || !hint) return;
    var n = BY_ID['DN-' + s.value + '-' + { Black: 'BK', Brown: 'BR', Grey: 'GR' }[c.value]];
    hint.innerHTML = n ? 'Goes to <code>' + esc(n.home) + '</code> · on hand ' + onHand(n.id) + ' of ' + n.cap + (n.perDay ? ' · sells ' + n.perDay + '/day' : '') : '';
  }
  function viewBatches() {
    var sizes = Array.from(new Set(NETS.map(function (n) { return n.size; }))).sort(function (a, b) { var x = a.split('x').map(Number), y = b.split('x').map(Number); return x[0] - y[0] || x[1] - y[1]; });
    var list = Object.values(S.batches).sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    h('<h2>Batches &amp; labels</h2><div class="card"><h3>Create a production batch</h3>' +
      '<form id="fNew" class="row" style="align-items:flex-end">' +
      '<label class="f">Size (h × w cm)<select id="fSize">' + sizes.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Color<select id="fColor">' + COLORS.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Quantity<input id="fQty" type="number" min="1" value="100" style="width:110px"></label>' +
      '<button class="btn primary" type="submit">Create &amp; print label</button></form><div class="small muted" id="fHint"></div>' +
      '<div class="small muted">Classic and Royal use the same batch. The Royal extra is added at packing.</div>' + (window.self !== window.top ? '<div class="note small">You are viewing the preview. Printing and downloads work when you open the app from your computer or GitHub.</div>' : '') + '</div>' +
      '<div class="card" id="batchDetail" hidden></div>' +
      '<div class="card"><h3>All batches</h3><div class="tablewrap"><table><thead><tr><th>Batch</th><th>Net</th><th>Qty</th><th>Good</th><th>Progress</th><th>Created</th><th></th></tr></thead><tbody>' +
      list.map(function (b) { var n = BY_ID[b.net]; return '<tr><td><code>' + b.id + '</code></td><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td>' + b.qty + '</td><td>' + b.good + '</td><td>' + stepsHtml(b) + '</td><td class="muted">' + fmtT(b.created) + '</td><td><button class="btn" data-open="' + b.id + '">Open</button></td></tr>'; }).join('') +
      '</tbody></table></div></div>');
    document.getElementById('fSize').value = '210x100';
    ['fSize', 'fColor'].forEach(function (id) { document.getElementById(id).onchange = updateHint; });
    updateHint();
    document.getElementById('fNew').onsubmit = function (e) {
      e.preventDefault();
      var s = document.getElementById('fSize').value, c = document.getElementById('fColor').value, q = parseInt(document.getElementById('fQty').value, 10);
      if (!(q > 0)) { toast('Enter a quantity above 0.'); return; }
      var id = 'DN-' + s + '-' + { Black: 'BK', Brown: 'BR', Grey: 'GR' }[c];
      var b = newBatch(id, q, 'Manager'); save();
      viewBatches(); showBatch(b.id);
      printLabels([batchLabel(b)], '50x25');
    };
    app.querySelectorAll('[data-open]').forEach(function (x) { x.onclick = function () { renderBatchDetail(document.getElementById('batchDetail'), S.batches[x.dataset.open]); document.getElementById('batchDetail').scrollIntoView({ behavior: 'smooth' }); }; });
  }

  // ---------- scan station ----------
  var sess = { emp: null, mode: null, await: null, net: null, wo: null, loc: null, last: null };
  function viewScan() {
    // Scan station (owner 22 Nov 2026): only IN and OUT for everyone, Box recount for managers. Other actions are hidden for now
    // (their barcodes on the command sheet still work). Every save can show a check first; each person switches it on or off.
    h('<h2 class="scan-h2">Scan station</h2><div class="station"><div class="scanbox">' +
      '<div class="who-row"><div class="who">Scanning as <span class="name" id="who">—</span><span class="muted small" id="whoRole"></span></div>' +
      '<div class="small who-not">Not you? <a href="#" id="soLink">Sign out</a></div></div>' +
      '<div class="acts" id="acts"></div>' +
      '<div class="cfm-tg"><label><input type="checkbox" id="cfmTg"' + (checkOn() ? ' checked' : '') + '><span class="tg"></span><span>Check before saving</span></label>' + tipBtn('CHECK') + '</div>' +
      '<button type="button" class="btn camBtn" id="camBtn">Scan with camera</button>' +
      '<div class="prompt" id="prompt"></div>' +
      '<input id="scanIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type a code…" aria-label="Scan input">' +
      '<div class="feedback" id="fb" role="status">Ready.</div>' +
      '<div id="adjust"></div><div id="qbar"></div><div id="undoBar"></div>' +
      '<div class="small sb-hint">' + (TOUCH ? 'Tap <b>IN</b> or <b>OUT</b>. Or tap <b>Scan with camera</b> and point at a shelf label.' : 'Keep this box selected. The scanner types the code and presses Enter. You can also type a code and press Enter.') + '</div></div>' +
      (can('Manager') ? '<details class="card"' + (TOUCH ? '' : ' open') + '><summary><h3 style="display:inline">Test without a scanner</h3></summary><div class="small muted">Tap a code to send it as if it were scanned.</div>' +
      '<div class="small"><b>1 · Worker badge</b></div><div class="sim" id="simW"></div>' +
      '<div class="small"><b>2 · Work order net label</b></div><div class="sim" id="simB"></div>' +
      '<div class="small"><b>3 · Box label</b></div><div class="sim" id="simL"></div>' +
      '<div class="small"><b>Commands</b></div><div class="sim" id="simC"></div>' +
      '<h3 style="margin-top:6px">How it works</h3><ol class="small" style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px">' +
      '<li>You are signed in, so your name goes on every scan. Sharing a phone? Scan your <b>badge</b> and type your PIN.</li>' +
      '<li>Putting nets in: tap <b>IN</b>, type the size (e.g. 210 90), tap the color. The app shows the box in big letters. Put the nets in and tap how many. Box full: put the rest on top of the rack as full boxes (25 each) or a part box.</li>' +
      '<li>Taking nets out: tap <b>OUT</b>, type the size, tap the color. The app shows the box. Take the nets out and tap how many.</li>' +
      '<li>Made a mistake? Tap <b>Undo my last scan</b> within ' + UNDO_MIN + ' minutes and pick why.</li>' +
      '<li>Managers: <b>Box recount</b>. Scan each shelf label and type how many are in that box. Scan <b>TOP</b> for the top of the racks. Apply the counts on <a href="#stock">Stock</a>.</li>' +
      '<li>Work orders: scan the <b>net label</b> (WOMQD…) at your step and tap the one green button: <b>Received</b> when the net reaches you, <b>Done</b> when your step is finished. Rack-in: scan the net, put it in the box the app shows, scan the box.</li></ol></details>' : '') + '</div>');
    var inp = document.getElementById('scanIn');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = inp.value; inp.value = ''; handle(v); } });
    if (!TOUCH) document.addEventListener('click', refocus);
    document.getElementById('soLink').onclick = function (e) { e.preventDefault(); e.stopPropagation(); signOut(); };
    // after a good scan the camera closes and you are back on this screen with the details filled in (owner, 22 Nov 2026).
    // It stays open after a wrong code (scan again) and after a batch label at rack-in (the box label comes next).
    document.getElementById('camBtn').onclick = function () { if (window.ArmorXCam) window.ArmorXCam.open(function (c) { camLast = String(c || '').trim().toUpperCase(); handle(c); }, { keep: camKeep, after: camBack }); };
    document.getElementById('acts').onclick = function (e) { var b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation(); var a = b.dataset.act;
      if (a === 'CANCEL' || a === sess.mode) handle('CMD-CANCEL'); else handle('CMD-' + a); if (!TOUCH) refocus(); };
    document.getElementById('qbar').onclick = function (e) { var b = e.target.closest('[data-q]'); if (!b) return; e.stopPropagation(); handle(b.dataset.q); if (!TOUCH) refocus(); };
    document.getElementById('undoBar').onclick = function (e) { var b = e.target.closest('[data-undo]'); if (!b) return; e.stopPropagation(); handle('CMD-UNDO'); if (!TOUCH) refocus(); };
    var tg = document.getElementById('cfmTg');
    tg.onchange = function (e) { e.stopPropagation(); setCheck(tg.checked); toast(tg.checked ? 'Check before saving is on.' : 'Check before saving is off. Numbers save at once (very high numbers still ask).'); if (!TOUCH) refocus(); };
    tg.parentNode.onclick = function (e) { e.stopPropagation(); };
    function sim(id, codes) { var el = document.getElementById(id); if (!el) return; el.innerHTML = codes.map(function (c) { return '<button type="button" data-c="' + esc(c[0]) + '" title="' + esc(c[1] || '') + '">' + esc(c[0]) + (c[1] ? ' · ' + esc(c[1]) : '') + '</button>'; }).join(''); }
    sim('simW', S.workers.map(function (w) { return [w.id, w.name.replace(' (sample)', '')]; }));
    var simW = []; woOpen().forEach(function (o) { woNetList(o).forEach(function (x) { var nx = woNext(x); if (nx && simW.length < 6) simW.push([woCode(o, x), nx.say]); }); });
    sim('simB', simW);
    var picks = ['DN-210x100-BK', 'DN-210x100-GR', 'DN-200x100-BK', 'DN-250x150-GR', 'DN-210x95-BR', 'DN-205x90-GR', 'DN-210x100-BR'].map(function (id) { return [BY_ID[id].pick, BY_ID[id].size + ' ' + BY_ID[id].color]; }).concat([[FLOOR2, 'top of racks']]);
    sim('simL', picks);
    sim('simC', [['CMD-PUTAWAY', 'IN'], ['CMD-TAKEOUT', 'OUT'], ['CMD-BOXCOUNT', 'Box recount'], ['CMD-UNDO'], ['CMD-CANCEL'], ['QTY-1'], ['QTY-5'], ['QTY-20']]);
    if (app.querySelector('.sim')) app.querySelectorAll('.sim button').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); handle(b.dataset.c); if (!TOUCH) refocus(); }; });
    paint(); if (!TOUCH) inp.focus();
  }
  var camLast = '';
  function camKeep() { // stays open after a wrong code, or when a box label is the next thing to scan (rack-in, or a mode like OUT / EMPTY / REFILL / Count boxes)
    var f = document.getElementById('fb');
    return !!(f && /\bbad\b/.test(f.className)) || sess.await === 'loc' || sess.await === 'woloc' || (/^CMD-/.test(camLast) && !/^CMD-(PUTAWAY|TAKEOUT|CANCEL|UNDO)$/.test(camLast) && !!sess.mode);
  }
  function camBack() { var a = document.getElementById('adjust'); showOnPhone(a && a.innerHTML ? 'adjust' : 'fb'); }
  function refocus() { var i = document.getElementById('scanIn'); if (i && document.activeElement !== i && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.id !== 'scanIn')) i.focus(); }
  function fb(msg, kind) { var el = document.getElementById('fb'); if (el) { el.className = 'feedback ' + (kind || ''); el.innerHTML = msg; } beep(kind !== 'bad'); }
  function paint() {
    var w = worker(sess.emp);
    var who = document.getElementById('who'); if (!who) return;
    who.textContent = w ? w.name : 'nobody yet'; document.getElementById('whoRole').textContent = w ? '· ' + w.role : '';
    var p = 'Scan your worker badge';
    if (sess.emp) {
      if (sess.await === 'loc' && sess.wo) p = 'Now scan the box label for ' + esc(netLabel(BY_ID[S.batches[sess.wo].net])) + ' <span class="small">(home ' + esc(BY_ID[S.batches[sess.wo].net].home) + ')</span>';
      else if (sess.await === 'color') p = 'Which color? Tap Black, Brown or Grey below';
      else if (sess.await === 'reason') p = 'Why is the count different? Tap a reason below';
      else if (sess.await === 'ureason') p = 'Why are you undoing it? Tap a reason below';
      else if (sess.await === 'bcnet') p = 'Top of racks: pick the size, then tap the color';
      else if (sess.await === 'bctop' && sess.bc) p = 'How many boxes of ' + esc(netLabel(sess.net)) + ' are on top of the racks?';
      else if (sess.await === 'check') p = 'Check, then tap Yes';
      else if (sess.await === 'woloc') p = 'Rack-in: scan the box label';
      else if (sess.woc) p = 'Tap the step below, or scan the next net';
      else if (sess.await === 'pasize') p = paOut() ? 'OUT: which net are you taking out?' : 'IN: what net is in your hand?';
      else if (sess.await === 'paqty') p = paOut() ? 'Take the nets out of the box below, then tap how many' : 'Put the nets in the box below, then tap how many';
      else if (sess.await === 'bcqty' && sess.bc) p = 'How many ' + esc(netLabel(sess.net)) + ' ' + esc(sess.bc.loc === FLOOR2 ? 'on top of the racks' : 'in ' + sess.bc.loc) + '? <span class="small">' + (sess.bc.nets.length > 1 ? 'Count only the ' + esc(sess.net.color) + ' bin · ' : '') + (sess.bc.loc === FLOOR2 ? 'number of nets: a full box is ' + TOP_BOX : 'type the number (0 if none)') + '</span>';
      else if (sess.await === 'qty') p = esc({ OUT: 'How many going out?', FBA: 'How many for FBA?', RETURN: 'How many returned?', DAMAGED: 'How many damaged?', COUNT: 'How many in total, racks plus top of racks?' }[sess.mode]) + ' <span class="small">' + esc(netLabel(sess.net)) + ' · type a number or scan QTY</span>';
      else if (sess.mode) p = esc((sess.mode === 'BOXCOUNT' ? 'Box recount' : sess.mode) + ' · ' + MODE_HELP[sess.mode]);
      else p = 'Tap IN or OUT';
    }
    document.getElementById('prompt').innerHTML = p;
    var acts = document.getElementById('acts');
    if (acts) acts.innerHTML = sess.emp ? '<div class="acts-io">' + ['PUTAWAY', 'TAKEOUT'].map(function (a) { return '<div class="io-w"><button type="button" class="act io' + (sess.mode === a ? ' on' : '') + '" data-act="' + a + '">' + esc(ACTS[a]) + '</button>' + tipBtn(a === 'PUTAWAY' ? 'IN' : 'OUT') + '</div>'; }).join('') + '</div>' +
      (sess.mode && !paMode() && sess.mode !== 'BOXCOUNT' ? '<div class="acts-h">Doing: <b>' + esc(ACTS[sess.mode]) + '</b> · <button type="button" class="linkbtn" data-act="CANCEL">stop</button></div>' : '') +
      (can('Manager') ? '<div class="acts-mg"><span class="acts-mgl">Manager</span><div class="io-w"><button type="button" class="act mg' + (sess.mode === 'BOXCOUNT' ? ' on' : '') + '" data-act="BOXCOUNT">Box recount</button>' + tipBtn('RECOUNT') + '</div></div>' : '') : '';
    var qb = document.getElementById('qbar');
    if (qb) qb.innerHTML = sess.await === 'qty' ? '<div class="qbtns">' + [1, 2, 3, 4, 5, 10, 20].map(function (q) { return '<button type="button" class="act" data-q="' + q + '">' + q + '</button>'; }).join('') + '<button type="button" class="act ghost" data-q="CMD-CANCEL">Cancel</button></div><div class="small" style="color:#cfd6db">Other number: type it in the box above and press Enter.</div>'
      : sess.await === 'bcqty' && sess.bc && sess.bc.loc !== FLOOR2 ? '<div class="qbtns">' + boxQtyButtons().map(function (q) { return '<button type="button" class="act" data-q="' + q[0] + '">' + esc(q[1]) + '</button>'; }).join('') + '<button type="button" class="act ghost" data-q="CMD-CANCEL">Cancel</button></div><div class="small" style="color:#cfd6db">Other number: type it in the box above and press Enter.</div>' : '';
    var ub = document.getElementById('undoBar'), u = undoState();
    if (ub) ub.innerHTML = u && !/reason$/.test(sess.await || '') ? '<button type="button" class="act ghost undo" data-undo="1">Undo my last scan: ' + esc(u.what) + '</button>' : '';
  }
  function boxQtyButtons() { // box recount: 0 = empty, the box's full number, and a few common numbers
    var bc = sess.bc, bx = BOXES[bc.loc], n = sess.net, full = bx ? (bx.mix ? bx.mix[n.id] : bx.cap) : 0;
    var list = [[0, '0 · empty']];
    [1, 2, 3, 5, 10].forEach(function (q) { if (q !== full) list.push([q, String(q)]); });
    if (full) list.push([full, full + ' · full']);
    return list;
  }
  var ACTS = { OUT: 'Pick for order', FBA: 'FBA shipment', SWAP: 'Swap backup down', REFILL: 'Refill box', EMPTY: 'Box is empty', RETURN: 'Customer return', DAMAGED: 'Return, damaged', COUNT: 'Count', BOXCOUNT: 'Box recount', PUTAWAY: 'IN', TAKEOUT: 'OUT' };
  // Hidden for now (owner 22 Nov 2026): Pick for order, FBA, Swap, Refill, Empty, returns and Count have no button; their barcodes still work.
  function askAction(code, box, list, r) { // a shelf label scanned with nothing chosen: IN or OUT for this box
    var adj = document.getElementById('adjust'); if (!adj) return;
    if (window.ArmorXCam) window.ArmorXCam.close();
    var n = list[0];
    fb('<code>' + esc(code) + '</code> · <b>' + esc(netLabel(n)) + '</b> · ' + (box.role === 'pick' ? 'PICK box' : 'BACKUP box') + (S.shelf[countKey(code, n.id)] ? ' · ' + counted(code, n.id) + ' in this box' : '') + (r && r.state === 'empty' ? ' · <b>marked empty</b>' : '') + '. <b>IN or OUT?</b>', 'ok');
    adj.innerHTML = '<div class="acts-io">' + [['PUTAWAY', 'IN'], ['TAKEOUT', 'OUT']].map(function (a) { return '<button type="button" class="act io" data-do="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>' +
      (can('Manager') ? '<button type="button" class="act mg" data-do="BOXCOUNT" style="margin-top:8px;width:100%">Box recount</button>' : '');
    adj.querySelectorAll('[data-do]').forEach(function (b) { b.onclick = function (e) {
      e.stopPropagation(); adj.innerHTML = ''; var a = b.dataset.do; handle('CMD-' + a);
      if (a === 'BOXCOUNT') { if (sess.mode === 'BOXCOUNT') scanBox(code); } else if (paMode()) paChoose(n, code);
      if (!TOUCH) refocus();
    }; });
  }
  function handle(raw) {
    var code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    if (sess.await === 'check') { // a check is open: a command leaves it (nothing saved), anything else waits for Yes or Back
      if (!/^CMD-/.test(code)) { fb('Tap <b>Yes, save</b>, or <b>Back</b> to change it.', 'warn'); return; }
      sess.await = null;
    }
    if (code === '2F') code = FLOOR2; // labels printed before 11 Nov 2026
    var woBox = sess.await === 'woloc' && sess.woc && (BOXES[code] || code === FLOOR2);
    if (sess.woc && !woBox && !/^WOMQD/.test(code)) { sess.woc = null; if (sess.await === 'woloc') sess.await = null; } // a work order card closes on any other scan
    var adj = document.getElementById('adjust'); if (adj && !/^\d+$/.test(code) && !woBox) adj.innerHTML = '';
    if (woBox) { woRackScan(code); return; } // rack-in: the box for the work order net just scanned
    if (/^EMP-\d+$/.test(code)) {
      var w = worker(code); if (!w) { fb('Unknown badge <b>' + esc(code) + '</b>. Ask the admin to add it on the People page.', 'bad'); return; }
      if (code === sess.emp) { sess.mode = null; sess.await = null; fb('Hello ' + esc(w.name) + '.', 'ok'); paint(); return; }
      askSwitch(w); return; // someone else's badge: they type their own PIN, so nobody can scan in another person's name
    }
    if (code === 'CMD-CANCEL') { sess.woc = null; sess.mode = null; sess.await = null; sess.wo = null; sess.net = null; sess.bc = null; if (adj) adj.innerHTML = ''; fb('Cleared.', 'ok'); paint(); return; }
    if (!sess.emp) { fb('Scan your worker badge first, so the system knows who did this.', 'bad'); return; }
    if (code === 'CMD-UNDO') { startUndo(); return; }
    var m = /^CMD-(OUT|FBA|RETURN|DAMAGED|COUNT|SWAP|REFILL|EMPTY|BOXCOUNT|PUTAWAY|TAKEOUT)$/.exec(code);
    if (m && m[1] === 'COUNT' && !can('Manager')) { fb('Only a manager can change a count. Use <b>IN</b> or <b>OUT</b>.', 'bad'); return; }
    if (m && m[1] === 'BOXCOUNT' && !can('Manager')) { fb('Box recount is for managers. Use <b>IN</b> or <b>OUT</b>.', 'bad'); return; }
    if (m && m[1] === 'PUTAWAY' && sheetOn() && (S.sheetV || 0) < PA_V) { fb(OLD_SHEET + 'ask the manager.', 'bad'); return; }
    if (m && m[1] === 'TAKEOUT' && !sheetV8()) { fb(OLD_SHEET + 'use Pick for order.', 'bad'); return; }
    if (m && m[1] === 'PUTAWAY') { sess.mode = 'PUTAWAY'; sess.wo = null; sess.bc = null; fb('<b>IN.</b> Type the size of the net in your hand, tap the color, and the app shows the box.', 'ok'); paStart(); return; }
    if (m && m[1] === 'TAKEOUT') { sess.mode = 'TAKEOUT'; sess.wo = null; sess.bc = null; fb('<b>OUT.</b> Type the size of the net you are taking out, tap the color, and the app shows the box.', 'ok'); paStart(); return; }
    if (m && m[1] === 'BOXCOUNT' && !sheetNew()) { fb(OLD_SHEET + 'use the count sheet on the Stock page.', 'bad'); return; }
    if (m) { sess.mode = m[1]; sess.await = null; sess.wo = null; sess.bc = null; fb(esc(m[1] === 'BOXCOUNT' ? 'BOX RECOUNT' : m[1]) + ' mode on. ' + esc(MODE_HELP[m[1]]) + (m[1] === 'BOXCOUNT' ? ' ' + countProgressText() : ''), 'ok'); paint(); return; }
    if (/reason$/.test(sess.await || '')) { fb('Tap a reason first, or scan CANCEL.', 'bad'); return; }
    if (/^WOMQD/.test(code)) { woScan(code); return; } // a work order net: show where it is and its next step
    var q = /^QTY-(\d+)$/.exec(code) || (/^\d+$/.test(code) ? [code, code] : null);
    if (q) { applyQty(parseInt(q[1], 10)); return; }
    if (/^WO-\d+$/.test(code)) { if (paMode() && S.batches[code] && sess.pa) { paChoose(BY_ID[S.batches[code].net], null); return; } scanBatch(code); return; } // IN / OUT: a batch label fills in the size and colour
    if (BOXES[code] || BY_ID[code] || code === FLOOR2) { scanBox(code); return; }
    fb('Unknown code <b>' + esc(code) + '</b>.', 'bad');
  }
  function scanBatch(wo) {
    var b = S.batches[wo]; if (!b) { fb('Batch <b>' + esc(wo) + '</b> not found.', 'bad'); return; }
    sess.mode = null; sess.await = null; var n = BY_ID[b.net];
    if (b.stage >= 6) { fb(esc(wo) + ' is already on the rack at <code>' + esc(b.loc) + '</code>.', 'warn'); return; }
    if (b.stage === 5) { sess.wo = wo; sess.await = 'loc'; fb(esc(wo) + ' · ' + esc(netLabel(n)) + ' · ' + b.good + ' nets ready for the rack. Scan the box label.', 'ok'); paint(); return; }
    var next = b.stage + 1, prevB = { stage: b.stage, good: b.good, loc: b.loc || null };
    b.stage = next; b.history.push({ stage: next, by: sess.emp, qty: b.good, rej: 0, t: now() });
    var sev = addLog({ type: 'STAGE', stage: next, who: sess.emp, wo: wo, net: b.net, qty: b.good, note: STAGES[next] });
    remember(sev, { batch: { wo: wo, prev: prevB } });
    save(); sess.last = wo;
    fb('<b>' + esc(STAGES[next]) + '</b> done for ' + esc(wo) + ' · ' + esc(netLabel(n)) + ' · ' + b.good + ' nets · by ' + esc(wname(sess.emp)), 'ok');
    var adj = document.getElementById('adjust');
    adj.innerHTML = '<div class="qtyrow"><label class="f">Good nets<input id="adjGood" type="number" min="0" value="' + b.good + '"></label><button class="btn primary" id="adjSave">Save count</button><span class="small" style="color:#cfd6db">Only if some were rejected.</span></div>';
    document.getElementById('adjSave').onclick = function (e) {
      e.stopPropagation(); var g = parseInt(document.getElementById('adjGood').value, 10); var last = b.history[b.history.length - 1];
      if (!(g >= 0) || g > last.qty + last.rej) { toast('Enter a number up to ' + (last.qty + last.rej) + '.'); return; }
      var prev = last.qty + last.rej; last.rej = prev - g; last.qty = g; b.good = g; S.log[0].qty = g; S.log[0].note = STAGES[next] + (last.rej ? ' · ' + last.rej + ' rejected' : ''); queue({ type: 'ADJUST', who: sess.emp, wo: b.id, net: b.net, qty: g, rej: prev - g, note: 'Good count corrected at ' + STAGES[next] });
      if (S.undo && S.undo.id === sev.id && S.undo.batch) S.undo.batch.rej = last.rej; // undo also takes back the rejected nets

      save(); adj.innerHTML = ''; fb('Saved: ' + g + ' good' + (last.rej ? ', ' + last.rej + ' rejected' : '') + '.', 'ok'); refocus();
    };
    paint();
  }
  var MODE_HELP = { OUT: 'scan the PICK box', FBA: 'scan a box label or TOP', RETURN: 'scan the PICK box', DAMAGED: 'scan the PICK box', COUNT: 'scan any box of the net', BOXCOUNT: 'scan a shelf label (or TOP), then type how many nets are in that box. Stock changes only when the manager applies it on the Stock page.', PUTAWAY: 'type the size of the net in your hand, tap the color, put the nets where the app says.',
    SWAP: 'scan the backup box you are bringing down', REFILL: 'scan the empty box you are filling from the top of the racks', EMPTY: 'scan the box that just went empty' };
  function fmtD(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : 'date unknown'; }
  function boxRec(code) { return S.boxes[code] || null; } // null = not tracked yet (treated as full, date unknown)
  function isEmpty(code) { var r = boxRec(code); return !!(r && r.state === 'empty'); }
  function setBox(code, rec, why) { rec.at = now(); rec.by = sess.emp; S.boxes[code] = rec; }
  function oldest2F(n) { // oldest batch that went to the top of the racks: refills take this first
    return Object.values(S.batches).filter(function (b) { return b.net === n.id && b.stage >= 6 && (b.loc === FLOOR2 || b.loc === '2F'); }).sort(function (a, b) { return a.created < b.created ? -1 : 1; })[0] || null;
  }
  function fullBackups(n) { // backups holding stock, oldest first
    return (n.backups || []).filter(function (c) { return !isEmpty(c); }).sort(function (a, b) { var x = (boxRec(a) || {}).made || '9', y = (boxRec(b) || {}).made || '9'; return x < y ? -1 : x > y ? 1 : sideOrder(a, b); });
  }
  function chooseColor(code, list) {
    if (window.ArmorXCam) window.ArmorXCam.close();
    sess.await = 'color'; sess.loc = code; paint();
    var adj = document.getElementById('adjust'), mix = (BOXES[code] || {}).mix || {};
    adj.innerHTML = '<div class="qtyrow">' + list.map(function (n) { return '<button class="btn colorbtn" data-net="' + n.id + '"><span class="sw sw-' + n.color + '"></span>' + esc(n.color) + (mix[n.id] ? ' <span class="small muted">(' + mix[n.id] + ' in box)</span>' : '') + '</button>'; }).join('') + '</div>';
    fb('<code>' + esc(code) + '</code> is a 3-bin box for ' + esc(list[0].size) + '. Which color?', 'ok');
    adj.querySelectorAll('[data-net]').forEach(function (bt) { bt.onclick = function (e) { e.stopPropagation(); adj.innerHTML = ''; pickedNet(BY_ID[bt.dataset.net], code); refocus(); }; });
  }
  function scanBox(code) {
    var box = BOXES[code], list = BY_ID[code] ? [BY_ID[code]] : netsAt(code);
    // ---- rack-in after Pack: batch goes to an EMPTY home box or to the top of the racks ----
    if (sess.await === 'loc' && sess.wo) {
      var b = S.batches[sess.wo], n = BY_ID[b.net];
      if (code !== FLOOR2) {
        if (!box || box.nets.indexOf(n.id) < 0) { fb('Wrong box. <code>' + esc(code) + '</code> is not a home of ' + esc(netLabel(n)) + '. Use <code>' + esc(homeOf(n).join(', ')) + '</code> or the top of the racks (scan <b>TOP</b>).', 'bad'); return; }
        if (box.kind === 'own' && !isEmpty(code)) {
          var empt = homeOf(n).filter(isEmpty);
          fb('First made, first shipped: <code>' + esc(code) + '</code> still has older nets (' + esc(fmtD((boxRec(code) || {}).made)) + '). New nets never go on top. ' + (empt.length ? 'Use the empty box <code>' + esc(empt.join(', ')) + '</code>' : 'Put them on top of the racks (scan <b>TOP</b>)') + '.', 'bad'); return;
        }
      }
      var own = code !== FLOOR2 && box.kind === 'own', pbx = own ? snapBoxes([code]) : {}, st = {}; st[n.id] = -b.good;
      b.stage = 6; b.loc = code; S.stock[n.id] = onHand(n.id) + b.good;
      if (own) setBox(code, { state: 'full', net: n.id, wo: b.id, made: b.created });
      b.history.push({ stage: 6, by: sess.emp, qty: b.good, rej: 0, t: now(), loc: code });
      var iev = addLog({ type: 'IN', who: sess.emp, wo: b.id, net: n.id, qty: b.good, loc: code, made: b.created, note: code === FLOOR2 ? 'Rack-in · top of racks' : 'Rack-in' });
      var ia = shelfAdd(code, n.id, b.good), ipa = {}; if (ia) ipa[ia.key] = ia;
      remember(iev, { stock: st, batch: { wo: b.id, prev: { stage: 5, good: b.good, loc: null } }, boxes: pbx, putAdd: ipa });
      save(); fb('<b>' + b.good + ' nets in</b> at <code>' + esc(code === FLOOR2 ? 'top of racks' : code) + '</code>. ' + esc(netLabel(n)) + ' now ' + onHand(n.id) + ' in total.', 'ok');
      sess.wo = null; sess.await = null; paint(); return;
    }
    if (paMode()) { paScan(code, box, list); return; }
    if (sess.mode === 'BOXCOUNT') { doBoxCount(code, box, list); return; }
    if (code === FLOOR2) {
      if (sess.mode === 'FBA') { fb('Top of racks. Now scan the product or a box label of the net going to FBA.', 'warn'); return; }
      fb('<b>TOP</b> is the top of the racks. Use it at rack-in (after Pack) for bulk stock.', 'warn'); return;
    }
    var mode = sess.mode;
    if (mode === 'SWAP') { doSwap(code, list); return; }
    if (mode === 'REFILL') { doRefill(code, list); return; }
    if (mode === 'EMPTY') {
      var pe = snapBoxes([code]); setBox(code, { state: 'empty' });
      remember(addLog({ type: 'EMPTY', who: sess.emp, net: list.length === 1 ? list[0].id : '', loc: code, note: 'Box empty' }), { boxes: pe }); save();
      var n0 = list[0], fbk = list.length === 1 && code === n0.pick ? fullBackups(n0) : [];
      fb('<code>' + esc(code) + '</code> marked empty. It is on the refill list.' + (fbk.length ? ' <b>Swap now:</b> bring down <code>' + esc(fbk[0]) + '</code> (scan SWAP, then that box).' : ''), 'ok'); paint(); return;
    }
    if (mode) {
      if ((mode === 'OUT' || mode === 'RETURN' || mode === 'DAMAGED') && box && box.role === 'backup') {
        fb('<code>' + esc(code) + '</code> is a <b>backup</b> box. Pickers only use the pick box <code>' + esc(list[0].pick) + '</code>. When it is empty, scan SWAP.', 'bad'); return;
      }
      if (list.length > 1) { chooseColor(code, list); return; }
      pickedNet(list[0], box ? code : list[0].pick); return;
    }
    var r = boxRec(code);
    if (box) { askAction(code, box, list, r); return; }
    var info = list.map(function (n) { return esc(netLabel(n)) + ' · <b>' + onHand(n.id) + '</b>'; }).join(' · ');
    fb('<code>' + esc(code) + '</code> · ' + (box ? (box.role === 'pick' ? 'PICK box' : 'BACKUP box') + (box.kind === 'bin' ? ' (3 bins)' : '') + ' · ' : '') + info + (r ? ' · ' + (r.state === 'empty' ? 'empty' : 'made ' + esc(fmtD(r.made))) : '') + '. Scan OUT, FBA, SWAP, REFILL or COUNT first.', 'warn');
  }
  function pickedNet(n, code) {
    sess.net = n; sess.loc = code; sess.await = 'qty';
    fb(esc(netLabel(n)) + ' · ' + onHand(n.id) + ' in total. Enter the quantity.', 'ok'); paint();
  }
  function doSwap(code, list) {
    var n = list[0], box = BOXES[code];
    if (!box) { fb('Scan a backup box label.', 'bad'); return; }
    if (box.role === 'pick') {
      var fb1 = fullBackups(n);
      if (!(n.backups || []).length) { fb(esc(list.length > 1 ? n.size : netLabel(n)) + ' has no backup box. Fill it from the top of the racks: scan REFILL, then this box.', 'warn'); return; }
      fb(fb1.length ? 'Bring down <code>' + esc(fb1[0]) + '</code>' + ((boxRec(fb1[0]) || {}).made ? ' (made ' + esc(fmtD(boxRec(fb1[0]).made)) + ', the oldest)' : '') + ' and scan it.' : 'All backups are empty. Use REFILL from the top of the racks.', 'warn'); return;
    }
    var pick = n.pick, fb2 = fullBackups(n);
    if (isEmpty(code)) { fb('<code>' + esc(code) + '</code> is marked empty.' + (fb2.length ? ' Use <code>' + esc(fb2[0]) + '</code>.' : ' Fill it with REFILL.'), 'bad'); return; }
    if (fb2.length && fb2[0] !== code && (boxRec(fb2[0]) || {}).made && (boxRec(code) || {}).made && boxRec(fb2[0]).made < boxRec(code).made) {
      fb('First made, first shipped: <code>' + esc(fb2[0]) + '</code> is older (' + esc(fmtD(boxRec(fb2[0]).made)) + '). Bring that one down first.', 'bad'); return;
    }
    var rec = boxRec(code) || { state: 'full', net: n.id, made: null }, ps = snapBoxes([pick, code]);
    setBox(pick, Object.assign({}, rec, { state: 'full' })); setBox(code, { state: 'empty' });
    remember(addLog({ type: 'SWAP', who: sess.emp, net: list.length === 1 ? n.id : '', loc: code, to: pick, made: rec.made || '', note: 'Swap ' + code + ' → ' + pick }), { boxes: ps });
    save(); fb('<b>Swap:</b> full box from <code>' + esc(code) + '</code> goes into <code>' + esc(pick) + '</code>. Put the empty box up in <code>' + esc(code) + '</code>. It is now on the refill list.', 'ok'); paint();
  }
  function doRefill(code, list) {
    var box = BOXES[code]; if (!box) { fb('Scan a box label.', 'bad'); return; }
    if (box.kind === 'own' && !isEmpty(code) && boxRec(code)) { fb('First made, first shipped: <code>' + esc(code) + '</code> is not empty. Never pour new nets on top. Refill it only when it is empty.', 'bad'); return; }
    var srcs = list.map(function (n) { return [n, oldest2F(n)]; });
    var made = srcs.map(function (x) { return x[1] ? x[1].created : ''; }).filter(Boolean).sort()[0] || null;
    var pr = snapBoxes([code]);
    setBox(code, { state: 'full', net: box.kind === 'own' ? list[0].id : '', wo: srcs[0][1] ? srcs[0][1].id : '', made: made });
    remember(addLog({ type: 'REFILL', who: sess.emp, net: list.length === 1 ? list[0].id : '', loc: code, wo: srcs[0][1] ? srcs[0][1].id : '', made: made || '', note: 'Refill from top of racks' + (box.kind === 'bin' ? ' · 3 bins, new nets to the back' : '') }), { boxes: pr });
    save();
    fb('<b>Refill</b> <code>' + esc(code) + '</code> from the top of the racks' + (box.kind === 'bin' ? ': top up each color bin, new nets at the back. ' : '. ') + srcs.map(function (x) { return x[1] ? esc(x[0].color) + ': take batch <b>' + esc(x[1].id) + '</b> (made ' + esc(fmtD(x[1].created)) + ', the oldest)' : ''; }).filter(Boolean).join(' · '), 'ok'); paint();
  }
  function applyQty(q, reason) {
    if (sess.await === 'bcqty' && sess.bc) { recordBoxCount(q); return; }
    if (sess.await === 'bctop' && sess.bc) { recordBoxCount(q); return; }
    if (paMode()) { if (sess.await === 'paqty') paAdd(q, false); else { fb('First type the size of the net in your hand, in the size box below.', 'warn'); paDraw(); } return; }
    if (sess.await !== 'qty' || !sess.net) {
      var adjG = document.getElementById('adjGood');
      if (adjG) { adjG.value = q; document.getElementById('adjSave').click(); return; }
      fb('A quantity needs a box first. Scan OUT, FBA, RETURN or COUNT, then a box label.', 'bad'); return;
    }
    var n = sess.net, before = onHand(n.id), mode = sess.mode;
    if (mode === 'OUT' && (pickLeft(n.id) || keptLeft(n.id))) { // pick for order of a net on the pick list: tick it off, stock already went down
      var pr = outNets(n, q, sess.loc, function () { return 'Order pick'; });
      if (pr.err) { fb('Only ' + pr.err + ' on hand for ' + esc(netLabel(n)) + '. Check the box, or scan COUNT to correct it.', 'bad'); return; }
      fb('<b>OUT ' + q + '</b> · ' + esc(netLabel(n)) + ' · ' + pickSaid(pr) + 'now ' + onHand(n.id) + ' in total.', 'ok');
      sess.await = null; sess.net = null; paint(); return;
    }
    if ((mode === 'OUT' || mode === 'FBA') && q > before) { fb('Only ' + before + ' on hand for ' + esc(netLabel(n)) + '. Check the box, or scan COUNT to correct it.', 'bad'); return; }
    if (mode === 'COUNT' && q !== before && !reason) { // every count change needs a reason
      sess.await = 'reason'; paint();
      fb('<b>Count ' + q + '</b> · ' + esc(netLabel(n)) + ' · the system had ' + before + ' (' + (q > before ? '+' : '') + (q - before) + '). <b>Why is it different?</b>', 'warn');
      reasonPicker(COUNT_REASONS, function (r) { sess.await = 'qty'; applyQty(q, r); });
      return;
    }
    if (mode === 'OUT' || mode === 'FBA') S.stock[n.id] = before - q;
    else if (mode === 'RETURN') S.stock[n.id] = before + q;
    else if (mode === 'COUNT') S.stock[n.id] = q;
    var ev = addLog({ type: mode, who: sess.emp, net: n.id, qty: q, loc: sess.loc, reason: reason || '', note: mode === 'COUNT' ? 'Counted (was ' + before + ')' + (reason ? ' · reason: ' + reason : ' · matches') : ({ OUT: 'Order pick', FBA: 'FBA shipment', RETURN: 'Customer return · good', DAMAGED: 'Customer return · damaged, not restocked' }[mode]) });
    var sd = {}; if (onHand(n.id) !== before) sd[n.id] = before - onHand(n.id);
    var sa = mode === 'OUT' || mode === 'FBA' ? shelfAdd(sess.loc, n.id, -q, true) : mode === 'RETURN' ? shelfAdd(sess.loc, n.id, q) : null, spa = {}; if (sa && sa.add) spa[sa.key] = sa;
    remember(ev, { stock: sd, putAdd: spa });
    save();
    var after = onHand(n.id), warn = after <= n.refillAt && (mode === 'OUT' || mode === 'FBA');
    fb('<b>' + esc(mode) + ' ' + q + '</b> · ' + esc(netLabel(n)) + ' · now ' + after + ' in total.' + (warn ? ' <b>Below refill level.</b>' : ''), warn ? 'warn' : 'ok');
    sess.await = null; sess.net = null; paint();
  }

  // ---------- check before saving (owner 22 Nov 2026): each person switches it on or off; a very high number always asks ----------
  function checkOn() { return !((S.settings && S.settings.noCheck) || {})[sess.emp || (S.auth && S.auth.id) || '']; }
  function setCheck(on) { S.settings.noCheck = S.settings.noCheck || {}; var me = sess.emp || (S.auth && S.auth.id) || ''; if (on) delete S.settings.noCheck[me]; else S.settings.noCheck[me] = true; save(); }
  // o = { title, what, rows: [[label, before, after]], notes, warn, sure }. Shows the change in #adjust; Yes saves, Back goes back.
  function check(o, go, back) {
    var adj = document.getElementById('adjust');
    if (!adj || (!o.warn && !checkOn())) { go(); return; }
    var was = sess.await; sess.await = 'check'; paint();
    adj.innerHTML = '<div class="cfm' + (o.warn ? ' cfm-warn' : '') + '" role="group" aria-label="Check before saving"><div class="cfm-t">' + esc(o.title) + '</div>' +
      (o.warn ? '<div class="cfm-w"><b>Are you sure?</b> ' + o.warn + '</div>' : '') +
      '<div class="cfm-what">' + esc(o.what) + '</div><div class="cfm-rows">' + (o.rows || []).map(function (r) { return '<div class="cfm-r"><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + ' <i>→</i> ' + esc(String(r[2])) + '</b></div>'; }).join('') + '</div>' +
      (o.notes || []).map(function (x) { return '<div class="small cfm-n">' + esc(x) + '</div>'; }).join('') +
      '<div class="cfm-b"><button type="button" class="act cfm-yes" data-cfm="1">' + (o.warn ? 'Yes, ' + esc(o.sure) + ' is right' : 'Yes, save') + '</button><button type="button" class="act ghost" data-cfm="0">Back</button></div></div>';
    fb(o.warn ? '<b>Check this number.</b> Tap Yes if it is right.' : 'Check, then tap <b>Yes, save</b>.', o.warn ? 'warn' : 'ok');
    adj.onclick = function (e) {
      var b = e.target.closest('[data-cfm]'); if (!b) return; e.stopPropagation();
      if (sess.await === 'check') sess.await = was;
      if (b.dataset.cfm === '1') go(); else { fb('Not saved. Change the number, or tap another one.', 'ok'); if (back) back(); else if (paMode()) paDraw(); else paint(); }
      if (!TOUCH) refocus();
    };
    showOnPhone('adjust');
  }
  // the small "i" next to an action: three short lines (what it does, what you enter, what changes). Texts in data/help.js.
  function tipBtn(k) { return (window.HELP_TIPS || {})[k] ? '<button type="button" class="ibtn" data-tip="' + k + '" aria-label="What is this?">i</button>' : ''; }
  function showTip(k) {
    var t = (window.HELP_TIPS || {})[k]; if (!t) return;
    var el = document.getElementById('tipPop');
    if (!el) { el = document.createElement('div'); el.id = 'tipPop'; el.className = 'pop tip-pop'; document.body.appendChild(el); }
    el.innerHTML = '<div class="pop-card tip-card" role="dialog" aria-modal="true" aria-label="' + esc(t.h) + '"><div class="tip-h">' + esc(t.h) + '</div>' +
      t.lines.map(function (l) { return '<div class="tip-l"><span>' + esc(l[0]) + '</span><div>' + l[1] + '</div></div>'; }).join('') +
      (t.more ? '<a class="small" href="#help?q=' + encodeURIComponent(t.more) + '" data-tipx="1">More in Help</a>' : '') +
      '<button type="button" class="btn dark pop-x" data-tipx="1">OK</button></div>';
    el.hidden = false;
    el.onclick = function (e) { if (e.target === el || e.target.closest('[data-tipx]')) { e.stopPropagation(); el.hidden = true; if (!TOUCH) refocus(); } };
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-tip]'); if (b) { e.preventDefault(); e.stopPropagation(); showTip(b.dataset.tip); } }, true);

  // ---------- undo my last scan, reasons for count changes ----------
  var UNDO_MIN = 15; // a worker can undo their own last scan on this device for 15 minutes
  var UNDO_REASONS = ['Wrong box', 'Wrong number', 'Wrong net or color', 'Scanned twice', 'Other'];
  var COUNT_REASONS = ['Opening count', 'Full count', 'Picked without scanning', 'Found extra nets', 'Damaged, thrown out', 'Counted wrong before', 'Other'];
  var SHEET_V = 4; // Code.gs version that understands UNDO and box counts
  var OLD_SHEET = 'The Google Sheet script is an older version. Ask the manager to paste the new google-sheet/Code.gs and deploy a new version. Until then, ';
  function sheetNew() { return !sheetOn() || (S.sheetV || 0) >= SHEET_V; }
  function clone(o) { return o == null ? null : JSON.parse(JSON.stringify(o)); }
  function snapBoxes(codes) { var o = {}; codes.forEach(function (c) { o[c] = clone(S.boxes[c] || null); }); return o; }
  function boxSig(r) { return r ? (r.state || 'full') + '|' + (r.made || '') : 'none'; }
  function undoWhat(ev) {
    if (/^WO/.test(ev.type)) return ev.note || ev.type;
    var n = BY_ID[ev.net];
    return [ev.type === 'STAGE' ? ev.note : ev.type === 'BOXCOUNT' ? 'Box recount' : ev.type === 'BOXADD' ? 'IN +' + ev.qty : ev.type === 'BOXQTY' ? 'Box change ' + ev.was + ' → ' + ev.qty : ev.type, ev.qty != null && ev.type !== 'STAGE' && ev.type !== 'BOXADD' && ev.type !== 'BOXQTY' ? ev.qty : '', n ? netLabel(n) : '', ev.wo || '', ev.loc ? (ev.loc === FLOOR2 ? 'top of racks' : ev.loc) : ''].filter(function (x) { return x !== ''; }).join(' · ');
  }
  // r = what to put back: { stock: { net: change }, batch: { wo, prev }, boxes: { code: record before }, counts: { key: record before } }
  function remember(ev, r) {
    var u = { id: ev.id, type: ev.type, t: ev.t, who: ev.who, what: undoWhat(ev), stock: r.stock || {}, batch: null, boxes: {}, counts: {}, countAdd: r.countAdd || {}, putAdd: r.putAdd || {}, picks: r.picks || {}, topParts: r.topParts || {} };
    if (r.wo) { var wx = woState().orders[r.wo.order].nets[r.wo.no]; u.wo = { order: r.wo.order, no: r.wo.no, prev: r.wo.prev, after: woSig(wx) }; }
    if (r.batch) { var b = S.batches[r.batch.wo]; u.batch = { wo: r.batch.wo, prev: r.batch.prev, after: { stage: b.stage, loc: b.loc || null }, rej: 0 }; }
    Object.keys(r.boxes || {}).forEach(function (c) { u.boxes[c] = { prev: r.boxes[c], after: boxSig(S.boxes[c]) }; });
    Object.keys(r.counts || {}).forEach(function (k) { u.counts[k] = { prev: r.counts[k], after: S.counts[k] ? Number(S.counts[k].qty) : null }; });
    S.undo = u;
  }
  function undoState() {
    var u = S.undo;
    if (!u || !sess.emp || u.who !== sess.emp) return null;
    if (Date.now() - new Date(u.t).getTime() > UNDO_MIN * 60000) return null;
    if (S.resetAt && new Date(u.t) < new Date(S.resetAt)) return null; // the inventory was reset since then
    return u;
  }
  function undoConflict(u) { // someone else changed the same thing since: do not undo blindly
    if (u.wo) { var wo = woState().orders[u.wo.order], wx = wo && wo.nets && wo.nets[u.wo.no]; if (!wx || woSig(wx) !== u.wo.after) return 'that net has moved on since then'; }
    if (u.batch) {
      var b = S.batches[u.batch.wo];
      if (!b || b.stage !== u.batch.after.stage || (b.loc || null) !== u.batch.after.loc) return 'batch ' + u.batch.wo + ' has moved on since then' + (b ? ' (now: ' + STAGES[b.stage] + ')' : '');
    }
    var bad = Object.keys(u.boxes).filter(function (c) { return boxSig(S.boxes[c]) !== u.boxes[c].after; });
    if (bad.length) return 'box ' + bad.join(', ') + ' was changed since then';
    var low = Object.keys(u.countAdd || {}).filter(function (k) { return (S.counts[k] ? Number(S.counts[k].qty) : 0) < u.countAdd[k].add; });
    if (low.length) return 'that box count is lower now than what you added';
    var lowP = Object.keys(u.putAdd || {}).filter(function (k) { return (S.shelf[k] ? Number(S.shelf[k].qty) : 0) < u.putAdd[k].add; });
    if (lowP.length) return 'that box has fewer put away now than what you added';
    var lowT = Object.keys(u.topParts || {}).filter(function (id) { var have = topOf(id).parts.slice(); return (u.topParts[id].del || []).some(function (x) { var i = have.indexOf(x); if (i < 0) return true; have.splice(i, 1); return false; }); });
    if (lowT.length) return 'the boxes on top of the rack were changed since then';
    var lowK = Object.keys(u.picks || {}).filter(function (k) { var p = k.split('|'), l = ((S.picks || {})[p[0]] || { lines: {} }).lines[p[1]]; return !l || l.picked < u.picks[k]; });
    if (lowK.length) return 'that pick list line was changed since then';
    var badC = Object.keys(u.counts).filter(function (k) { return (S.counts[k] ? Number(S.counts[k].qty) : null) !== u.counts[k].after; });
    if (badC.length) return 'that box was counted again since then';
    var neg = Object.keys(u.stock).filter(function (id) { return onHand(id) + u.stock[id] < 0; });
    if (neg.length) return 'stock of ' + neg.map(function (id) { return BY_ID[id] ? netLabel(BY_ID[id]) : id; }).join(', ') + ' would go below 0';
    return '';
  }
  function showOnPhone(id) { if (TOUCH) setTimeout(function () { var el = document.getElementById(id); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60); }
  function reasonPicker(list, done) { // tap a reason; "Other" asks for a few words
    var adj = document.getElementById('adjust'); if (!adj) return;
    showOnPhone('adjust');
    adj.innerHTML = '<div class="acts-g reasons">' + list.map(function (r) { return '<button type="button" class="act" data-why="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '<button type="button" class="act ghost" data-why="">Cancel</button></div>';
    adj.querySelectorAll('[data-why]').forEach(function (b) { b.onclick = function (e) {
      e.stopPropagation(); var r = b.dataset.why;
      if (!r) { adj.innerHTML = ''; sess.await = null; sess.net = null; fb('Cancelled. Nothing was changed.', 'ok'); paint(); resumeMode(); if (!TOUCH) refocus(); return; } // the mode stays on
      if (r !== 'Other') { adj.innerHTML = ''; done(r); if (!TOUCH) refocus(); return; }
      adj.innerHTML = '<div class="qtyrow"><label class="f" style="flex:1">What happened?<input id="whyTxt" maxlength="80" style="width:100%"></label><button type="button" class="btn primary" id="whyOk">Save</button></div>';
      var t = document.getElementById('whyTxt'), ok = function (ev) { if (ev) ev.stopPropagation(); var v = t.value.trim(); if (!v) { toast('Type a few words.'); return; } adj.innerHTML = ''; done('Other: ' + v); if (!TOUCH) refocus(); };
      document.getElementById('whyOk').onclick = ok; t.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } }; t.focus();
    }; });
  }
  function resumeMode() { // after an undo or a cancelled undo, IN / OUT carries on where it was
    if (sess.woc) { woCard(false); return; }
    if (!paMode()) return;
    if (!sess.pa) { paStart(); return; }
    sess.await = sess.pa.net ? 'paqty' : 'pasize'; paDraw();
  }
  function startUndo() {
    if (!sheetNew()) { fb(OLD_SHEET + 'fix mistakes with COUNT.', 'bad'); return; }
    var u = undoState();
    if (!u) { fb('Nothing to undo. You can undo only your own last scan on this device, within ' + UNDO_MIN + ' minutes. For an older mistake, scan COUNT and type the right number.', 'warn'); resumeMode(); return; }
    var c = undoConflict(u);
    if (c) { fb('Cannot undo: ' + esc(c) + '. Scan COUNT and type the right number instead.', 'bad'); resumeMode(); return; }
    sess.wo = null; sess.net = null; sess.bc = null; sess.await = 'ureason'; paint(); // the mode stays on, so a box count carries on after an undo
    fb('Undo <b>' + esc(u.what) + '</b>? <b>Tap why.</b>', 'warn');
    reasonPicker(UNDO_REASONS, doUndo);
  }
  function doUndo(reason) {
    var u = undoState(); sess.await = null;
    if (!u) { fb('Too late to undo. Scan COUNT and type the right number.', 'bad'); paint(); return; }
    var c = undoConflict(u); if (c) { fb('Cannot undo: ' + esc(c) + '.', 'bad'); paint(); return; }
    var ev = { type: 'UNDO', who: sess.emp, undoes: u.id, undoType: u.type, reason: reason, note: 'Undo ' + u.what + ' · reason: ' + reason, stock: u.stock, boxes: {}, counts: {} };
    var ids = Object.keys(u.stock);
    ids.forEach(function (id) { S.stock[id] = onHand(id) + u.stock[id]; });
    if (ids.length === 1) { ev.net = ids[0]; ev.qty = u.stock[ids[0]]; }
    if (u.batch) {
      var b = S.batches[u.batch.wo], p = u.batch.prev;
      b.stage = p.stage; b.good = p.good; b.loc = p.loc; b.history = b.history.filter(function (h) { return h.stage <= p.stage; });
      ev.wo = b.id; ev.net = ev.net || b.net;
      ev.batch = { wo: b.id, stage: p.stage, good: p.good, loc: p.loc || '', rej: u.batch.rej || 0 };
    }
    Object.keys(u.boxes).forEach(function (code) {
      var pr = u.boxes[code].prev;
      if (pr) S.boxes[code] = pr; else delete S.boxes[code];
      ev.boxes[code] = pr ? { state: pr.state || 'full', net: pr.net || '', wo: pr.wo || '', made: pr.made || '' } : null;
    });
    Object.keys(u.counts).forEach(function (k) {
      var pr = u.counts[k].prev;
      if (pr) S.counts[k] = pr; else delete S.counts[k];
      ev.counts[k] = pr ? { box: pr.box, net: pr.net, qty: pr.qty } : null;
      ev.loc = ev.loc || k.split('|')[0]; ev.net = ev.net || k.split('|')[1];
    });
    if (Object.keys(u.countAdd || {}).length) ev.countsAdd = {};
    Object.keys(u.countAdd || {}).forEach(function (k) { // put away: take only these nets back off, other phones' adds stay
      var a = u.countAdd[k], q = (S.counts[k] ? Number(S.counts[k].qty) : 0) - a.add;
      if (a.drop && q <= 0) delete S.counts[k]; else if (S.counts[k]) S.counts[k].qty = Math.max(0, q);
      ev.countsAdd[k] = { add: -a.add, drop: a.drop }; ev.loc = ev.loc || k.split('|')[0]; ev.net = ev.net || k.split('|')[1];
    });
    if (Object.keys(u.putAdd || {}).length) ev.putAdd = {};
    Object.keys(u.putAdd || {}).forEach(function (k) { // put away: take only these nets back off the box number (stock comes back above)
      var a = u.putAdd[k], q = (S.shelf[k] ? Number(S.shelf[k].qty) : 0) - a.add;
      if (a.drop && q <= 0) delete S.shelf[k]; else if (S.shelf[k]) S.shelf[k].qty = Math.max(0, q);
      ev.putAdd[k] = { add: -a.add, drop: a.drop }; ev.loc = ev.loc || k.split('|')[0];
    });
    if (Object.keys(u.topParts || {}).length) ev.topParts = u.topParts;
    Object.keys(u.topParts || {}).forEach(function (id) { var r = S.shelf[countKey(FLOOR2, id)]; if (r) r.parts = fitParts(partsOps(topOf(id).kept, u.topParts[id]), Number(r.qty) || 0); });
    if (Object.keys(u.picks || {}).length) ev.picks = {};
    Object.keys(u.picks || {}).forEach(function (k) { var p = k.split('|'); pickTick(p[0], p[1], -u.picks[k]); ev.picks[k] = -u.picks[k]; ev.net = ev.net || p[1]; });
    S.log.forEach(function (e) { if (e.id === u.id && !isUndone(e)) { e.undone = true; e.note = (e.note || '') + ' · UNDONE'; } });
    if (u.wo) { // a work order scan: the net goes back to where it was; the sheet works out the rest (stock, box, numbers)
      var wo = woState().orders[u.wo.order]; wo.nets[u.wo.no] = u.wo.prev; woCount(wo);
      ev = { type: 'WOUNDO', who: sess.emp, undoes: u.id, reason: reason, order: wo.id, net: wo.net, note: 'Undo ' + u.what + ' · reason: ' + reason };
    }
    S.undo = null; addLog(ev); save();
    var n = ev.net && BY_ID[ev.net];
    fb('<b>Undone:</b> ' + esc(u.what) + '. Reason saved: ' + esc(reason) + '.' + (n ? ' ' + esc(netLabel(n)) + ' is ' + onHand(n.id) + ' in total.' : ''), 'ok');
    paint(); resumeMode();
  }

  // ---------- box recount (managers): scan the shelf, type the number ----------
  function countKey(box, net) { return box + '|' + net; }
  // ---------- put away (opening count, net first): type the size, tap the color, the app says where it goes ----------
  // The worker has a few nets of one size and color in hand. Each tap ADDS to stock straight away and to that box's number,
  // so many small trips and several phones add up. No Apply step: the dashboard shows the new total at once.
  var PA_V = 7; // Code.gs version where a put away (BOXADD) adds to stock straight away and keeps the number per box
  var SIZES = Array.from(new Set(NETS.map(function (n) { return n.size; })));
  function boxCap(c, id) { var b = BOXES[c]; return b ? (b.mix ? b.mix[id] : b.cap) : 0; }
  function counted(c, id) { var r = S.shelf[countKey(c, id)]; return r ? Number(r.qty) : 0; } // nets in that box now (put away, picks, box changes)
  // change the number in a box (or TOP) by d, like Code.gs does. onlyIfKnown: a pick from a box with no number yet changes nothing
  function shelfAdd(loc, id, d, onlyIfKnown) {
    if (!loc || !d) return null; loc = loc === '2F' ? FLOOR2 : loc;
    var k = countKey(loc, id), r = S.shelf[k];
    if (!r) { if (onlyIfKnown || d < 0) return null; S.shelf[k] = { box: loc, net: id, qty: d, at: now(), by: sess.emp }; return { key: k, add: d, drop: true }; }
    var a = Math.max(-Number(r.qty), d), w = Number(r.qty); r.qty = w + a; r.at = now(); r.by = sess.emp;
    if (loc === FLOOR2) r.parts = fitParts(fitParts(r.parts, w), r.qty);
    return { key: k, add: a, drop: false };
  }
  function sheetV8() { return !sheetOn() || (S.sheetV || 0) >= BOXQTY_V; }
  function topOf(id) { var r = S.shelf[countKey(FLOOR2, id)]; return topSplit(r ? r.qty : 0, r ? r.parts : []); } // nets on top as full boxes + part boxes
  function boxTotal(c) { return (BOXES[c] ? BOXES[c].nets : []).reduce(function (a, id) { return a + counted(c, id); }, 0); }
  function boxKnown(c) { return (BOXES[c] ? BOXES[c].nets : []).some(function (id) { return !!S.shelf[countKey(c, id)]; }); }
  function inBoxes(id) { var n = BY_ID[id]; return homeOf(n).reduce(function (a, c) { return a + counted(c, id); }, 0); }
  // A manager sets the number in one box (or TOP): stock moves by the difference. Also used row by row by the Excel upload.
  var BOXQTY_V = 8;
  function setBoxQty(loc, id, q, reason, upload, opt) {
    opt = opt || {};
    var n = BY_ID[id], k = countKey(loc, id), was = counted(loc, id), d = q - was, prev = !!S.shelf[k], top = loc === FLOOR2;
    var own = !top && BOXES[loc] && BOXES[loc].kind === 'own', pbx = !top ? snapBoxes([loc]) : {}, t0 = top ? topOf(id) : null;
    S.shelf[k] = { box: loc, net: id, qty: q, at: now(), by: sess.emp };
    if (top) S.shelf[k].parts = fitParts(opt.parts || t0.kept, q); // the manager's part boxes, or the ones there (fitted to the new number)
    S.stock[id] = Math.max(0, onHand(id) + d);
    var state = '';
    if (loc !== FLOOR2 && !opt.keepState) { var tot = boxTotal(loc); if (tot === 0 && !isEmpty(loc)) state = 'empty'; else if (tot > 0 && isEmpty(loc)) state = 'full'; }
    if (state) setBox(loc, state === 'empty' ? { state: 'empty' } : { state: 'full', net: own ? id : '', wo: '', made: null });
    var ev = addLog({ type: 'BOXQTY', who: sess.emp, net: id, qty: q, was: was, loc: loc, reason: reason, upload: upload || '', boxState: state, boxNet: own ? id : '', parts: top && opt.parts ? S.shelf[k].parts : undefined,
      note: (upload ? 'Excel upload ' + upload + ': ' : 'Box change: ') + (top ? 'top of racks ' + topText(t0) + ' → ' + topText(topOf(id)) : loc + ' ' + was + ' → ' + q) + ' · reason: ' + reason });
    var st = {}; st[id] = -d; var pa = {}; pa[k] = { add: d, drop: !prev }; var tp = {}; if (top) tp[id] = { add: t0.kept, del: S.shelf[k].parts };
    if (!upload && !opt.noUndo) remember(ev, { stock: st, putAdd: pa, boxes: state ? pbx : {}, topParts: tp });
    return { ev: ev, d: d, was: was, n: n };
  }
  function paBox(n) { var hs = homeOf(n); for (var i = 0; i < hs.length; i++) if (counted(hs[i], n.id) < boxCap(hs[i], n.id)) return hs[i]; return n.pick; } // first box with room
  function locHint(c) {
    var m = /^([A-Z])([LR])-C(\d)-R(\d)$/.exec(c); if (!m) return '';
    return 'Rack ' + m[1] + ' · ' + (m[2] === 'L' ? 'left' : 'right') + ' side · column ' + m[3] + ' · row ' + m[4] + (m[4] === '1' ? ' (floor)' : m[4] === '5' ? ' (top row)' : '');
  }
  function paMode() { return sess.mode === 'PUTAWAY' || sess.mode === 'TAKEOUT'; }
  function paOut() { return sess.mode === 'TAKEOUT'; } // OUT: same steps as IN, but the nets come out of the box
  function outBox(n) { // OUT: the pick box if it has nets, else the first box of this net that has nets
    var hs = homeOf(n), has = hs.filter(function (c) { return counted(c, n.id) > 0; });
    return has.indexOf(n.pick) >= 0 ? n.pick : has[0] || n.pick;
  }
  function paStart() { sess.pa = { net: null, box: null, size: null, last: (sess.pa || {}).last || null }; sess.await = 'pasize'; paDraw(); }
  function paDraw() {
    var adj = document.getElementById('adjust'); if (!adj || !paMode()) return;
    var pa = sess.pa || {}; paint();
    if (!pa.net) {
      var last = pa.last && BY_ID[pa.last];
      adj.innerHTML = '<div class="pa">' + (last ? '<button type="button" class="act pa-same" data-pa-net="' + last.id + '">Same net again: ' + esc(netLabel(last)) + '</button>' : '') +
        (pa.size ? '<div class="pa-step">' + esc(pa.size.replace('x', ' × ')) + ' · which color?</div><div class="pa-cols">' +
          NETS.filter(function (n) { return n.size === pa.size; }).map(function (n) { return '<button type="button" class="act pa-col" data-pa-net="' + n.id + '"><span class="sw sw-' + n.color + '"></span>' + esc(n.color) + '</button>'; }).join('') +
          '</div><button type="button" class="act ghost" data-pa-back="1">Other size</button>'
        : '<label class="pa-step" for="paSize">Size of the net in your hand</label><input id="paSize" class="pa-in" inputmode="numeric" autocomplete="off" placeholder="type e.g. 210 90"><div class="pa-sizes" id="paList"></div>') + '</div>';
      var inp = document.getElementById('paSize');
      if (inp) {
        var list = function () {
          var d = inp.value.replace(/\D/g, ''), hits = d ? SIZES.filter(function (s) { return s.replace('x', '').indexOf(d) === 0; }) : [];
          document.getElementById('paList').innerHTML = hits.slice(0, 12).map(function (s) { return '<button type="button" class="act" data-pa-size="' + s + '">' + esc(s.replace('x', ' × ')) + '</button>'; }).join('') +
            (d && !hits.length ? '<div class="small" style="color:#cfd6db">No door net size starts with ' + esc(d) + '. Check the size on the net.</div>' : '');
        };
        inp.oninput = list; inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); var b = adj.querySelector('[data-pa-size]'); if (b) b.click(); } };
        list(); if (!TOUCH || !last) inp.focus();
      }
    } else {
      var n = BY_ID[pa.net], c = pa.box, have = counted(c, n.id), known = !!S.shelf[countKey(c, n.id)], cap = boxCap(c, n.id), out = paOut();
      var others = homeOf(n).filter(function (x) { return x !== c; });
      adj.innerHTML = '<div class="pa pa-card' + (out ? ' pa-outc' : '') + '"><div class="pa-net"><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n).replace('x', ' × ')) + '<span class="pa-tot">' + onHand(n.id) + ' in stock</span></div>' +
        (out ? pickNote(n) : '') +
        '<div class="pa-go">' + (out ? 'Take it out of box' : 'Put it in box') + '</div><div class="pa-loc">' + esc(c) + '</div><div class="pa-hint">' + esc(locHint(c)) + '</div>' +
        '<div class="pa-have">In this box: <b>' + (known ? have : '—') + '</b>' + (cap ? ' · a full box holds ' + cap : '') + (!out && cap && have >= cap ? ' · <b>box is full</b>' : '') + '</div>' +
        '<div class="pa-step">' + (out ? 'How many did you take out?' : 'How many did you put in?') + '</div><div class="qbtns">' + [1, 2, 3, 4, 5, 10].map(function (q) { return '<button type="button" class="act pa-add" data-pa-add="' + q + '">' + (out ? '−' : '+') + q + '</button>'; }).join('') + '</div>' +
        '<div class="qtyrow"><label class="f">Other number<input id="paQty" type="number" min="1" inputmode="numeric"></label><button type="button" class="btn primary" data-pa-other="1">' + (out ? 'Take out' : 'Add') + '</button></div>' +
        topBlock(out, topOf(n.id)) +
        (others.length ? '<div class="small pa-others">' + (out ? 'Other boxes: ' : 'This net also has boxes: ') + others.map(function (x) { return '<button type="button" class="linkbtn" data-pa-box="' + x + '">' + esc(x) + (S.shelf[countKey(x, n.id)] ? ' (' + counted(x, n.id) + ')' : '') + '</button>'; }).join(' ') + '</div>' : '') +
        '<button type="button" class="act ghost" data-pa-back="1">Choose another net</button></div>';
    }
    var oq = document.getElementById('paQty'), tq = document.getElementById('paTopQty'), tn = document.getElementById('paTopN');
    if (oq) oq.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); var v = parseInt(oq.value, 10); if (v > 0) paAdd(v, 'box'); } };
    if (tq) tq.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); var v = parseInt(tq.value, 10); if (v > 0) paAdd(v, 'part'); } };
    if (tn) tn.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); var v = parseInt(tn.value, 10); if (v > 0) paAdd(v, 'full'); } };
    adj.onclick = function (e) {
      var b = e.target.closest('[data-pa-size],[data-pa-net],[data-pa-back],[data-pa-add],[data-pa-topfull],[data-pa-toppart],[data-pa-topother],[data-pa-box],[data-pa-other],[data-st]'); if (!b) return; e.stopPropagation();
      var d = b.dataset;
      if (d.paSize) { sess.pa.size = d.paSize; paDraw(); }
      else if (d.paNet) paChoose(BY_ID[d.paNet], null);
      else if (d.paBack) { sess.pa.net = null; sess.pa.size = null; sess.await = 'pasize'; paDraw(); }
      else if (d.paAdd) paAdd(+d.paAdd, 'box');
      else if (d.st) stepIt(b, +d.st, 1);
      else if (d.paTopfull) { var nv = parseInt(document.getElementById('paTopN').value, 10); if (nv > 0) paAdd(nv, 'full'); else toast('Type how many full boxes.'); }
      else if (d.paToppart) paAdd(+d.paToppart, 'partbox');
      else if (d.paBox) { sess.pa.box = d.paBox; paDraw(); }
      else if (d.paTopother) { var tv = parseInt(document.getElementById('paTopQty').value, 10); if (tv > 0) paAdd(tv, 'part'); else toast(paOut() ? 'Type how many nets you took.' : 'Type how many nets are in that box.'); }
      else if (d.paOther) { var v = parseInt(document.getElementById('paQty').value, 10); if (v > 0) paAdd(v, 'box'); else toast(paOut() ? 'Type how many you took out.' : 'Type how many you put in.'); }
      if (!TOUCH) refocus();
    };
  }
  function stepIt(b, d, min) { var i = b.parentNode.querySelector('input'); if (!i) return; i.value = Math.max(min, (parseInt(i.value, 10) || 0) + d); i.dispatchEvent(new Event('input', { bubbles: true })); }
  // top of the rack (owner 22 Nov 2026): full boxes of 25 (any number of them) or a part box (any count). OUT can take a part box by its count.
  function topBlock(out, t) {
    var h = '<div class="pa-top"><div class="pa-top-h"><span>' + (out ? 'Took it from the top of the rack?' : 'Box full? Put the rest on top of the rack') + '</span>' + tipBtn('TOP') + '</div>' +
      '<div class="pa-top-now">On top now: <b>' + esc(topText(t)) + '</b></div>' +
      '<div class="pa-top-r"><span class="pa-top-l">Full boxes<small>' + TOP_BOX + ' nets each</small></span><span class="stepper"><button type="button" data-st="-1" aria-label="One less">−</button><input id="paTopN" type="number" min="1" inputmode="numeric" value="1" aria-label="Full boxes"><button type="button" data-st="1" aria-label="One more">+</button></span><button type="button" class="btn primary" data-pa-topfull="1">' + (out ? 'Take off top' : 'Put on top') + '</button></div>';
    if (out && t.parts.length) h += '<div class="pa-top-r"><span class="pa-top-l">Part box<small>tap the one you took</small></span><span class="chips">' + t.parts.map(function (p) { return '<button type="button" class="chip" data-pa-toppart="' + p + '">' + p + '</button>'; }).join('') + '</span></div>';
    return h + '<div class="pa-top-r"><span class="pa-top-l">' + (out ? 'Some nets<small>from a box on top</small>' : 'Part box<small>nets in a box that is not full</small>') + '</span><input id="paTopQty" type="number" min="1" inputmode="numeric" placeholder="nets" aria-label="' + (out ? 'Nets taken from the top' : 'Nets in the part box') + '"><button type="button" class="btn primary" data-pa-topother="1">' + (out ? 'Take off top' : 'Put on top') + '</button></div></div>';
  }
  function paChoose(n, box) {
    sess.pa.net = n.id; sess.pa.size = null; sess.pa.box = box || (paOut() ? outBox(n) : paBox(n)); sess.await = 'paqty'; sess.net = n;
    fb((paOut() ? 'Take the ' + esc(netLabel(n)) + ' nets out of <b>' : 'Put the ' + esc(netLabel(n)) + ' nets in <b>') + esc(sess.pa.box) + '</b>, then tap how many.', 'ok');
    paDraw(); showOnPhone('adjust');
  }
  function paScan(code, box, list) { // scanning the shelf is optional: it confirms the box, or picks the net from the shelf
    if (code === FLOOR2) { fb(sess.pa && sess.pa.net ? 'For the top of the rack, use <b>Full box on top</b> or type how many are in the box.' : 'First type the size of the net in your hand.', 'warn'); paDraw(); return; }
    if (BY_ID[code] && !box) { paChoose(BY_ID[code], null); return; } // a net's own label fills in the size and colour
    if (!box) { fb('That is not a shelf label.', 'bad'); paDraw(); return; }
    var n = sess.pa && sess.pa.net && BY_ID[sess.pa.net];
    if (n && homeOf(n).indexOf(code) >= 0) { sess.pa.box = code; fb('✓ Right box: <b>' + esc(code) + '</b>. Now tap how many you ' + (paOut() ? 'took out.' : 'put in.'), 'ok'); paDraw(); return; }
    if (n) { fb('<b>Wrong box.</b> ' + esc(code) + ' is for ' + esc(list.length > 1 ? list[0].size + ' (3 bins)' : netLabel(list[0])) + '. ' + esc(netLabel(n)) + ' goes in <b>' + esc(sess.pa.box) + '</b>.', 'bad'); paDraw(); return; }
    if (list.length === 1) { paChoose(list[0], code); return; }
    sess.pa.size = list[0].size; paDraw(); fb(esc(code) + ' is a 3-bin box for ' + esc(list[0].size) + '. Tap the color.', 'ok');
  }
  // ---------- IN / OUT: q nets into or out of the box, or on top of the rack ----------
  // kind: 'box' (q nets), 'full' (q full boxes on top), 'part' (IN: a part box of q nets; OUT: q nets from a box on top), 'partbox' (OUT: the part box of q)
  var ODD_BOX = 60, ODD_TOP = 1000; // "Are you sure?" above these (never a limit): more than 2 full boxes' worth in a shelf box (60 if not known), or 1000 nets on top in one go
  function oddBox(q, cap) { return q > (cap ? 2 * cap : ODD_BOX) ? '<b>' + q + '</b> is a lot for one box' + (cap ? ' (a full box holds ' + cap + ')' : '') + '.' : ''; }
  function partsOps(list, ops) { var p = list.slice(); (ops.del || []).forEach(function (x) { var i = p.indexOf(x); if (i >= 0) p.splice(i, 1); }); return p.concat(ops.add || []); }
  function paAdd(q, kind) {
    var n = BY_ID[sess.pa.net]; if (!n || !(q > 0)) return;
    kind = kind || 'box';
    if (paOut()) { paTake(q, kind); return; }
    if (kind === 'partbox') kind = 'part';
    var top = kind !== 'box', loc = top ? FLOOR2 : sess.pa.box, nets = kind === 'full' ? q * TOP_BOX : q, cap = top ? 0 : boxCap(loc, n.id), was = counted(loc, n.id);
    var t0 = topOf(n.id), t1 = topSplit(t0.q + (top ? nets : 0), t0.kept.concat(kind === 'part' ? [q] : []));
    var warn = kind === 'box' ? oddBox(nets, cap) : kind === 'full' ? (nets >= ODD_TOP ? '<b>' + q + ' full boxes</b> is ' + nets + ' nets.' : '') : (q >= TOP_BOX ? 'A part box has fewer than ' + TOP_BOX + ' nets. <b>' + q + '</b> is a full box or more.' : '');
    check({ title: 'IN · ' + netLabel(n), what: top ? (kind === 'full' ? q + ' full box' + (q > 1 ? 'es' : '') + ' (' + nets + ' nets) on top of the rack' : 'a part box of ' + q + ' on top of the rack') : nets + ' into box ' + loc,
      rows: [[top ? 'Top of rack' : 'Box ' + loc, top ? topText(t0) : was, top ? topText(t1) : was + nets], ['Total in stock', onHand(n.id), onHand(n.id) + nets]],
      warn: warn, sure: kind === 'full' ? q + ' full boxes' : String(q) }, function () { paPut(n, loc, nets, kind === 'part' ? q : 0, kind === 'full' ? q : 0); });
  }
  function paPut(n, loc, q, part, fullN) { // IN saved: stock and the box (or top) go up now
    var top = loc === FLOOR2, key = countKey(loc, n.id), prev = clone(S.shelf[key] || null), was = prev ? Number(prev.qty) : 0, tot = was + q;
    var own = !top && BOXES[loc] && BOXES[loc].kind === 'own', pbx = !top && isEmpty(loc) ? snapBoxes([loc]) : {}, st = {}; st[n.id] = -q;
    S.shelf[key] = { box: loc, net: n.id, qty: tot, at: now(), by: sess.emp };
    if (top) S.shelf[key].parts = fitParts(prev ? prev.parts : [], was).concat(part ? [part] : []);
    S.stock[n.id] = onHand(n.id) + q;
    if (!top && isEmpty(loc)) setBox(loc, { state: 'full', net: own ? n.id : '', wo: '', made: null });
    var what = top ? (fullN ? fullN + ' full box' + (fullN > 1 ? 'es' : '') + ' (' + q + ')' : 'part box ' + part) : '+' + q;
    var ev = addLog({ type: 'BOXADD', who: sess.emp, net: n.id, qty: q, loc: loc, boxNet: own ? n.id : '', partAdd: part ? [part] : undefined, note: 'Put away ' + what + (top ? ' on top' : '') + ' (now ' + (top ? topText(topOf(n.id)) : tot) + ' there, ' + onHand(n.id) + ' in total)' });
    var pa = {}; pa[key] = { add: q, drop: !prev }; var tp = {}; if (part) tp[n.id] = { add: [], del: [part] };
    remember(ev, { stock: st, putAdd: pa, boxes: pbx, topParts: tp }); save();
    var cap = top ? 0 : boxCap(loc, n.id), over = cap && tot > cap;
    fb('Added <b>' + (fullN ? fullN + ' full box' + (fullN > 1 ? 'es' : '') + ' (' + q + ')' : q) + '</b> ' + esc(netLabel(n)) + ' → <b>' + esc(top ? 'top of the rack' : loc) + '</b>. Now ' + (top ? esc(topText(topOf(n.id))) : tot) + ' there, ' + onHand(n.id) + ' in stock.' + (over ? ' The box has more than a full box (' + cap + '): that is fine, the next ones can go on top.' : '') + ' <b>Next net:</b> type its size.', 'ok');
    sess.pa = { net: null, box: null, size: null, last: n.id }; sess.await = 'pasize'; sess.net = null;
    paDraw();
  }
  function paTake(q, kind) { // OUT: check first, then the nets come out (stock goes down at once, except nets on a pick list)
    var n = BY_ID[sess.pa.net], top = kind !== 'box', loc = top ? FLOOR2 : sess.pa.box, t0 = topOf(n.id), ops = { add: [], del: [] }, nets = kind === 'full' ? q * TOP_BOX : q, warn = '';
    var known = !!S.shelf[countKey(loc, n.id)], have = counted(loc, n.id);
    if (kind === 'full' && q > t0.full) warn = 'The app has <b>' + t0.full + '</b> full box' + (t0.full === 1 ? '' : 'es') + ' of this net on top.';
    if (kind === 'partbox') ops.del = [q];
    if (kind === 'part') { // nets from a box on top: that part box gets smaller, or a full box is opened
      var pp = t0.parts.slice().sort(function (a, b) { return a - b; }), big = pp.filter(function (p) { return p > q; })[0];
      if (pp.indexOf(q) >= 0) ops.del = [q]; else if (big) { ops.del = [big]; ops.add = [big - q]; } else if (t0.full && q < TOP_BOX) ops.add = [TOP_BOX - q];
    }
    var bxd = Math.min(boxedLeft(n.id), nets), offBox = nets - bxd; // nets of a list already taken off the box at Final do not come off it again
    if (!warn && top && offBox > t0.q) warn = 'The app has only <b>' + t0.q + '</b> nets of this net on top.';
    if (!warn && !top && known && offBox > have) warn = 'The app has only <b>' + have + '</b> in this box.';
    if (!warn && nets >= ODD_TOP) warn = '<b>' + nets + '</b> nets is a lot to take out in one go.';
    var listed = Math.min(pickLeft(n.id), nets);
    if (nets - listed > onHand(n.id)) { fb('Only <b>' + onHand(n.id) + '</b> ' + esc(netLabel(n)) + ' in stock. Check the number, or ask the manager to count it.', 'bad'); return; }
    var t1 = offBox ? topSplit(Math.max(0, t0.q - offBox), partsOps(t0.kept, ops)) : t0;
    check({ title: 'OUT · ' + netLabel(n), what: kind === 'full' ? q + ' full box' + (q > 1 ? 'es' : '') + ' (' + nets + ' nets) off the top of the rack' : kind === 'partbox' ? 'the part box of ' + q + ' off the top of the rack' : top ? q + ' nets off the top of the rack' : q + ' out of box ' + loc,
      rows: [[top ? 'Top of rack' : 'Box ' + loc, top ? topText(t0) : (known ? have : '—'), top ? topText(t1) : (known ? Math.max(0, have - offBox) : '—')], ['Total in stock', onHand(n.id), onHand(n.id) - (nets - listed)]],
      notes: listed ? [listed + ' ' + (listed === 1 ? 'is' : 'are') + ' on the pick list: already off stock, this only ticks the list.'] : [],
      warn: warn, sure: kind === 'full' ? q + ' full boxes' : String(q) }, function () { paOutSave(n, loc, nets, top ? ops : null, kind, q); });
  }
  function paOutSave(n, loc, nets, ops, kind, q) {
    var top = loc === FLOOR2, said = kind === 'full' ? q + ' full box' + (q > 1 ? 'es' : '') + ' (' + nets + ')' : kind === 'partbox' ? 'the part box of ' + q : String(nets);
    var r = outNets(n, nets, loc, function (k) { return 'OUT −' + k + ' from ' + (top ? 'top of rack' + (kind === 'full' ? ' (' + q + ' full)' : kind === 'partbox' ? ' (part box ' + q + ')' : '') : loc); }, ops);
    if (r.err) { fb('Only <b>' + r.err + '</b> ' + esc(netLabel(n)) + ' in stock. Check the number, or ask the manager to count it.', 'bad'); return; }
    var left = counted(loc, n.id), warn = onHand(n.id) <= n.refillAt;
    fb('Took out <b>' + said + '</b> ' + esc(netLabel(n)) + ' from <b>' + esc(top ? 'top of the rack' : loc) + '</b>. ' + pickSaid(r) + (S.shelf[countKey(loc, n.id)] ? (top ? 'On top now: ' + esc(topText(topOf(n.id))) : left + ' left there') + ', ' : '') + onHand(n.id) + ' in stock.' + (warn ? ' <b>Running low.</b>' : '') + ' <b>Next net:</b> type its size.', warn ? 'warn' : 'ok');
    sess.pa = { net: null, box: null, size: null, last: n.id }; sess.await = 'pasize'; sess.net = null;
    paDraw();
  }
  // ---------- pick lists (Code.gs version 9, numbered lists and "don't remove" version 11) ----------
  // The manager presses Final on a pick list. Yes: the whole list leaves stock at once, and when a picker then takes those
  // nets out (OUT), the app only ticks the list and takes them off the box: stock never goes down twice.
  // No (owner 23 Nov 2026): the list is still made and numbered, stock stays; the pickers' OUT takes the nets off stock and ticks it.
  // Many lists a day: each has a number for that day (#1, #2 ...) with its date and time.
  var PICK_V = 9, PICK2_V = 11;
  function allPicks() { return Object.keys(S.picks || {}).map(function (k) { return S.picks[k]; }).filter(function (p) { return p.state !== 'undone'; }).sort(function (a, b) { return (a.created || '') < (b.created || '') ? -1 : 1; }); }
  function openPicks() { return allPicks().filter(function (p) { return p.state !== 'done' && p.off !== false; }); } // off stock at Final
  function keptPicks() { return allPicks().filter(function (p) { return p.state !== 'done' && p.off === false; }); } // stock comes off at OUT
  function pickLeft(id) { return openPicks().reduce(function (a, p) { var l = p.lines[id]; return a + (l ? Math.max(0, l.qty - l.picked) : 0); }, 0); }
  // lists made final with version 11 also took the nets off the boxes at Final (owner 23 Nov 2026: "remove" means everything
  // goes down at once). For those, a picker's OUT only ticks the list. Older lists still take the nets off the box at OUT.
  function boxedLeft(id) { return openPicks().reduce(function (a, p) { var l = p.lines[id]; return a + (l && p.boxed ? Math.max(0, l.qty - l.picked) : 0); }, 0); }
  function takeFromBoxes(n, q) { // which boxes the nets of a final list come off: pick box, backups, then the top of the racks
    var out = [], rest = q;
    homeOf(n).concat([FLOOR2]).forEach(function (c) { if (rest <= 0) return; var k = Math.min(counted(c, n.id), rest); if (k > 0) { out.push([c, k]); rest -= k; } });
    return out;
  }
  function keptLeft(id) { return keptPicks().reduce(function (a, p) { var l = p.lines[id]; return a + (l ? Math.max(0, l.qty - l.picked) : 0); }, 0); }
  function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
  function pickNo(p) { // the list's number for its day: from the sheet, or its place among that day's lists
    if (p.no) return p.no;
    var day = allPicks().filter(function (x) { return sameDay(x.created, p.created); });
    return Math.max(1, day.indexOf(p) + 1 + day.filter(function (x) { return x.no; }).reduce(function (a, x) { return Math.max(a, x.no); }, 0) - day.filter(function (x) { return x.no; }).length);
  }
  function nextPickNo() { return allPicks().filter(function (p) { return isToday(p.created); }).reduce(function (a, p) { return Math.max(a, pickNo(p)); }, 0) + 1; }
  function whenText(iso) { var d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function pickTitle(p) { return 'Pick list #' + pickNo(p) + ' · ' + whenText(p.created); }
  function pickTick(list, id, d) {
    var p = (S.picks || {})[list]; if (!p || !p.lines[id]) return;
    p.lines[id].picked = Math.max(0, p.lines[id].picked + d);
    p.state = Object.keys(p.lines).every(function (k) { return p.lines[k].picked >= p.lines[k].qty; }) ? 'done' : 'open';
  }
  function pickNote(n) { // the line on the OUT card
    var left = pickLeft(n.id), kept = keptLeft(n.id);
    if (left) return '<div class="pa-pick">✓ On the pick list: <b>' + left + '</b> to pick. Already off stock' + (boxedLeft(n.id) ? ' and off the box' : '') + ': your number only ticks the list.</div>';
    if (kept) return '<div class="pa-pick">✓ On the pick list: <b>' + kept + '</b> to pick.</div>';
    return allPicks().some(function (p) { return p.state !== 'done'; }) ? '<div class="pa-pick no">Not on the pick list. This takes it off stock.</div>' : '';
  }
  function outNets(n, q, loc, note, top) { // returns { picked, rest } or { err: nets in stock }. top = part box changes on top of the rack
    var parts = [], rest = q;
    openPicks().forEach(function (p) { var l = p.lines[n.id]; if (!l || rest <= 0) return; var k = Math.min(Math.max(0, l.qty - l.picked), rest); if (k > 0) { parts.push({ list: p.id, q: k }); rest -= k; } });
    var before = onHand(n.id); if (rest > before) return { err: String(before) };
    var where = loc === FLOOR2 ? 'top of rack' : loc, pk = {}, kept = [], r2 = rest;
    keptPicks().forEach(function (p) { var l = p.lines[n.id]; if (!l || r2 <= 0) return; var k = Math.min(Math.max(0, l.qty - l.picked), r2); if (k > 0) { kept.push({ list: p.id, q: k }); r2 -= k; } });
    var boxedQ = 0; parts.forEach(function (x) { x.boxed = !!(S.picks[x.list] || {}).boxed; if (x.boxed) boxedQ += x.q; });
    var evs = parts.map(function (x) { var e = { type: 'PICKED', who: sess.emp, list: x.list, net: n.id, qty: x.q, note: 'Pick list ' + x.list + ': picked ' + x.q + ' from ' + where + (x.boxed ? ' (already off the box)' : '') }; if (!x.boxed) e.loc = loc; return e; });
    kept.forEach(function (x) { evs.push({ type: 'PICKED', who: sess.emp, list: x.list, net: n.id, qty: x.q, note: 'Pick list ' + x.list + ': picked ' + x.q + ' from ' + where + ' (off stock with this OUT)' }); }); // no box: the OUT takes it off
    parts = parts.concat(kept);
    if (rest) evs.push({ type: 'OUT', who: sess.emp, net: n.id, qty: rest, loc: loc, note: note(rest) });
    var ops = top && q > boxedQ && ((top.add || []).length || (top.del || []).length) ? top : null;
    if (ops) { evs[evs.length - 1].partAdd = ops.add; evs[evs.length - 1].partDel = ops.del; } // Code.gs applies them after the nets come off the top
    parts.forEach(function (x) { pickTick(x.list, n.id, x.q); pk[x.list + '|' + n.id] = x.q; });
    if (rest) S.stock[n.id] = before - rest;
    var ev = null; evs.forEach(function (e) { ev = addLog(e); });
    var key = countKey(FLOOR2, n.id), tr = S.shelf[key], keptBefore = loc === FLOOR2 && tr ? fitParts(tr.parts, Number(tr.qty) || 0) : null;
    var sa = q > boxedQ ? shelfAdd(loc, n.id, -(q - boxedQ), true) : null, spa = {}; if (sa && sa.add) spa[sa.key] = sa;
    var tp = {};
    if (keptBefore && S.shelf[key]) { S.shelf[key].parts = fitParts(ops ? partsOps(keptBefore, ops) : keptBefore, Number(S.shelf[key].qty) || 0); tp[n.id] = { add: keptBefore, del: S.shelf[key].parts }; }
    var st = {}; if (rest) st[n.id] = rest;
    remember(ev, { stock: st, putAdd: spa, picks: pk, topParts: tp }); save();
    return { picked: q - rest, rest: rest, kept: rest - r2 };
  }
  function outToday(id) { // nets that left stock today: picks, FBA, pick lists made final (from the sheet when it has version 9)
    var n = S.outToday ? Number(S.outToday[id]) || 0 : 0;
    S.log.forEach(function (e) { // from the sheet: only what this phone did since the last refresh; without it: the log
      if (!isToday(e.t) || isUndone(e) || (S.outToday && !(S.outAt && e.t > S.outAt))) return;
      if ((e.type === 'OUT' || e.type === 'FBA') && e.net === id) n += Number(e.qty) || 0;
      if (e.type === 'PICKLIST' && !e.keep) (e.lines || []).forEach(function (l) { if (l.net === id) n += Number(l.qty) || 0; });
    });
    return n;
  }
  function pickSaid(r) { return r.picked ? '<b>' + r.picked + ' ticked off the pick list</b> (already off stock). ' + (r.rest ? r.rest + ' more taken off stock. ' : '') : r.kept ? '<b>' + r.kept + ' ticked off the pick list.</b> ' : ''; }
  // ---------- (box count continued) ----------
  function boxCounted(code) { return BOXES[code].nets.every(function (id) { return S.counts[countKey(code, id)]; }); }
  function countProgress() {
    var codes = Object.keys(BOXES), done = codes.filter(boxCounted).length;
    var floor = Object.keys(S.counts).filter(function (k) { return k.indexOf(FLOOR2 + '|') === 0; }).length;
    return { done: done, total: codes.length, floor: floor };
  }
  function countProgressText() { var p = countProgress(); return p.done + ' of ' + p.total + ' boxes counted' + (p.floor ? ', ' + p.floor + ' nets counted on top of the racks' : '') + '.'; }
  function doBoxCount(code, box, list) {
    if (code === FLOOR2) { chooseFloorNet(); return; }
    if (!box) { fb('In box recount, scan a shelf label, or <b>TOP</b> for the top of the racks.', 'bad'); return; }
    if (window.ArmorXCam) window.ArmorXCam.close();
    sess.bc = { loc: code, nets: list.map(function (n) { return n.id; }), i: 0 };
    askBoxQty('');
  }
  function chooseFloorNet() {
    if (window.ArmorXCam) window.ArmorXCam.close();
    sess.bc = null; sess.await = 'bcnet'; paint();
    var adj = document.getElementById('adjust'), sizes = Array.from(new Set(NETS.map(function (n) { return n.size; })));
    adj.innerHTML = '<div class="qtyrow"><label class="f">Size<select id="bcSize">' + sizes.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select></label>' +
      COLORS.map(function (c) { return '<button type="button" class="btn colorbtn" data-col="' + c + '"><span class="sw sw-' + c + '"></span>' + c + '</button>'; }).join('') + '</div>';
    fb('<b>Top of racks.</b> Pick the size and tap the color, then count its full boxes (' + TOP_BOX + ' each) and part boxes on top of the racks.', 'ok');
    adj.querySelectorAll('[data-col]').forEach(function (b) { b.onclick = function (e) {
      e.stopPropagation(); var sz = document.getElementById('bcSize').value, n = NETS.filter(function (x) { return x.size === sz && x.color === b.dataset.col; })[0];
      if (!n) { toast('That size has no ' + b.dataset.col + ' net.'); return; }
      adj.innerHTML = ''; sess.bc = { loc: FLOOR2, nets: [n.id], i: 0 }; askBoxQty(''); if (!TOUCH) refocus();
    }; });
  }
  function askBoxQty(before) {
    var bc = sess.bc, n = BY_ID[bc.nets[bc.i]], prev = S.counts[countKey(bc.loc, n.id)], bx = BOXES[bc.loc];
    sess.net = n; sess.loc = bc.loc; sess.await = bc.loc === FLOOR2 ? 'bctop' : 'bcqty';
    fb(before + '<code>' + esc(bc.loc === FLOOR2 ? 'TOP' : bc.loc) + '</code> · ' + (bx ? (bx.role === 'pick' ? 'PICK' : 'BACKUP') + ' · ' : 'top of racks · ') + '<b>' + esc(netLabel(n)) + '</b>. ' +
      (prev ? 'Already counted: <b>' + (bc.loc === FLOOR2 ? esc(topText(topSplit(prev.qty, prev.parts))) : prev.qty) + '</b> by ' + esc(wname(prev.by)) + '. A new count replaces it.' : 'Count the nets and type the number.'), 'ok');
    paint();
    if (bc.loc !== FLOOR2) { showOnPhone('qbar'); return; }
    var adj = document.getElementById('adjust'), t = prev ? topSplit(prev.qty, prev.parts) : { full: 0, parts: [] };
    adj.innerHTML = '<div class="pa-card">' + topForm('bt', t) + '<div class="cfm-b"><button type="button" class="act cfm-yes" id="btSave">Save count</button><button type="button" class="act ghost" data-q="CMD-CANCEL" id="btNo">Cancel</button></div></div>';
    var f = topFormWire('bt');
    document.getElementById('btNo').onclick = function (e) { e.stopPropagation(); handle('CMD-CANCEL'); };
    document.getElementById('btSave').onclick = function (e) { e.stopPropagation(); var v = f.read(); recordBoxCount(v.q, v.parts); };
    showOnPhone('adjust');
  }
  function recordBoxCount(q, parts) {
    var bc = sess.bc, n = BY_ID[bc.nets[bc.i]], bx = BOXES[bc.loc], top = bc.loc === FLOOR2;
    if (top && parts === undefined) { fb('For the top of the racks, type the full boxes and part boxes below, then tap <b>Save count</b>.', 'warn'); return; }
    var key = countKey(bc.loc, n.id), prev = clone(S.counts[key] || null), t = top ? topSplit(q, parts) : null, cap = bx ? boxCap(bc.loc, n.id) : 0;
    var appNow = top ? topText(topOf(n.id)) : (S.shelf[key] ? counted(bc.loc, n.id) : '—');
    check({ title: 'Box recount · ' + netLabel(n), what: (top ? 'Top of racks' : 'Box ' + bc.loc) + ': you counted ' + (top ? topText(t) : q),
      rows: [['App has now', appNow, top ? topText(t) : q]], notes: ['Stock changes only when the manager applies the recount on the Stock page.'],
      warn: top ? (q >= ODD_TOP * 5 ? '<b>' + q + '</b> nets on top of the racks.' : '') : oddBox(q, cap), sure: String(q) }, function () {
      var pc = {}; pc[key] = prev;
      S.counts[key] = { box: bc.loc, net: n.id, qty: q, at: now(), by: sess.emp }; if (top) S.counts[key].parts = t.kept;
      remember(addLog({ type: 'BOXCOUNT', who: sess.emp, net: n.id, qty: q, loc: bc.loc, parts: top ? t.kept : undefined, note: 'Box recount' + (top ? ': ' + topText(t) : '') + (prev ? ' (replaces ' + prev.qty + ')' : '') }), { counts: pc });
      save();
      var said = 'Saved <b>' + esc(n.color) + ' ' + q + '</b>. ';
      bc.i++;
      if (bc.i < bc.nets.length) { askBoxQty(said); return; }
      sess.bc = null; sess.await = null; sess.net = null; var adj = document.getElementById('adjust'); if (adj) adj.innerHTML = '';
      fb((bc.nets.length > 1 ? said : '') + '<b>' + esc(top ? netLabel(n) + ' on top of the racks' : bc.loc) + ': ' + esc(top ? topText(t) : String(q)) + '</b> counted. ' + countProgressText() + ' Scan the next ' + (top ? 'shelf label or TOP' : 'shelf label') + '.', 'ok');
      paint();
    }, function () { askBoxQty('Not saved. '); });
  }
  // full boxes + part boxes on top of the racks, as a small form (box recount on TOP, and the manager's change on the Rack map)
  function topForm(p, t) {
    return '<div class="topf" id="' + p + '"><div class="pa-top-r"><span class="pa-top-l">Full boxes<small>' + TOP_BOX + ' nets each</small></span><span class="stepper"><button type="button" data-st="-1" aria-label="One less">−</button><input id="' + p + 'Full" type="number" min="0" inputmode="numeric" value="' + (t.full || 0) + '" aria-label="Full boxes"><button type="button" data-st="1" aria-label="One more">+</button></span></div>' +
      '<div class="pa-top-r"><span class="pa-top-l">Part boxes<small>tap × to take one off</small></span><span class="chips" id="' + p + 'Chips" data-parts="' + esc(JSON.stringify(t.parts || [])) + '"></span></div>' +
      '<div class="pa-top-r"><span class="pa-top-l">Add a part box<small>nets in it</small></span><input id="' + p + 'Add" type="number" min="1" inputmode="numeric" placeholder="nets" aria-label="Nets in the part box"><button type="button" class="btn" id="' + p + 'AddB">Add</button></div>' +
      '<div class="topf-sum" id="' + p + 'Sum"></div></div>';
  }
  function topFormWire(p, onChange) {
    var root = document.getElementById(p), chips = document.getElementById(p + 'Chips'), parts = JSON.parse(chips.dataset.parts || '[]');
    function read() { var full = Math.max(0, parseInt(document.getElementById(p + 'Full').value, 10) || 0); return { full: full, parts: parts.slice(), q: full * TOP_BOX + sum(parts) }; }
    function draw() {
      chips.innerHTML = parts.map(function (x, i) { return '<button type="button" class="chip on" data-rm="' + i + '" aria-label="Take off part box ' + x + '">' + x + ' <i>×</i></button>'; }).join('') || '<span class="muted small">none</span>';
      var v = read(); document.getElementById(p + 'Sum').innerHTML = '= <b>' + v.q + '</b> nets' + (v.full || v.parts.length ? ' (' + esc(topText(topSplit(v.q, v.parts), true)) + ')' : '');
      if (onChange) onChange(v);
    }
    function add() { var i = document.getElementById(p + 'Add'), v = parseInt(i.value, 10); if (!(v > 0)) { toast('Type how many nets are in the part box.'); return; } parts.push(v); i.value = ''; draw(); }
    root.onclick = function (e) {
      var b = e.target.closest('[data-st],[data-rm],#' + p + 'AddB'); if (!b) return; e.stopPropagation();
      if (b.dataset.st) stepIt(b, +b.dataset.st, 0); else if (b.dataset.rm != null) { parts.splice(+b.dataset.rm, 1); draw(); } else add();
    };
    document.getElementById(p + 'Full').oninput = draw;
    document.getElementById(p + 'Add').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } };
    draw();
    return { read: read };
  }

  // ---------- stock ----------
  function walkSorted() { return NETS.slice().sort(function (a, b) { return sideOrder(a.pick, b.pick) || COLORS.indexOf(a.color) - COLORS.indexOf(b.color); }); }
  function viewStock() {
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Stock</h2><div class="row" style="align-items:flex-end"><label class="f">Search size, color or rack<input id="q" placeholder="e.g. 210x100, Grey, AR-C1"></label><button class="btn" id="cntPrint">Print count sheet</button><button class="btn primary" id="cntMode">Enter counts</button></div></div>' +
      '<div class="card" id="bcCard"></div>' +
      '<div class="card" id="mvCard" hidden></div>' +
      '<div class="card" id="xlCard"></div>' +
      '<div class="note small" id="cntHelp" hidden>Count mode. Type what you counted in the boxes and on top of the racks. Only rows you fill in are saved, as COUNT scans with your name. Leave a row empty to keep it as it is. If any count is different from the system, pick a reason before saving.</div>' +
      '<div class="tablewrap"><table><thead id="th"></thead><tbody id="tb"></tbody></table></div><div class="row" id="cntBar" hidden style="justify-content:flex-end;align-items:flex-end;margin-top:8px"><span class="small muted" id="cntMsg"></span>' + reasonSelect('cntWhy') + '<button class="btn" id="cntCancel">Cancel</button><button class="btn primary" id="cntSave">Save counts</button></div>');
    var counting = false;
    function draw() {
      var q = document.getElementById('q').value.trim().toLowerCase();
      var list = walkSorted().filter(function (n) { return !q || (n.size + ' ' + n.color + ' ' + n.home + ' ' + n.skus).toLowerCase().indexOf(q) >= 0; });
      document.getElementById('th').innerHTML = counting ? '<tr><th>Pick box</th><th>Net</th><th>In system</th><th>Counted in boxes</th><th>Counted on top</th><th>New total</th></tr>'
        : '<tr><th>Net</th><th>Rack location</th><th>In total</th><th>Rack space</th><th>Refill at</th><th>Sells / day</th><th>Days left</th><th>Status</th><th>Amazon SKUs</th></tr>';
      document.getElementById('tb').innerHTML = list.map(function (n) {
        var oh = onHand(n.id), st = status(n), days = n.perDay ? Math.floor(oh / n.perDay) : '—';
        if (counting) return '<tr data-id="' + n.id + '"><td><code>' + esc(n.pick) + '</code></td><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + (n.kind === 'bin' ? ' <span class="small muted">(3 bins)</span>' : '') + '</td><td>' + oh + '</td><td><input class="cin" data-k="r" type="number" min="0" inputmode="numeric"></td><td><input class="cin" data-k="f" type="number" min="0" inputmode="numeric"></td><td class="tot muted">—</td></tr>';
        return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + esc(n.home) + '</code></td><td><b>' + oh + '</b></td><td>' + n.cap + '</td><td>' + n.refillAt + '</td><td>' + (n.perDay || '—') + '</td><td>' + days + '</td><td><span class="pill ' + (st === 'out' ? 'p-bad">Out' : st === 'low' ? 'p-warn">Low' : 'p-ok">OK') + '</span></td><td class="muted small">' + esc(n.skus) + '</td></tr>';
      }).join('');
      if (counting) app.querySelectorAll('#tb tr').forEach(function (tr) {
        tr.querySelectorAll('.cin').forEach(function (inp) { inp.oninput = function () {
          var r = tr.querySelector('[data-k=r]').value, f = tr.querySelector('[data-k=f]').value;
          tr.querySelector('.tot').textContent = (r === '' && f === '') ? '—' : (Number(r || 0) + Number(f || 0));
        }; });
      });
    }
    function setMode(on) { counting = on; ['cntHelp', 'cntBar'].forEach(function (id) { document.getElementById(id).hidden = !on; }); document.getElementById('cntMode').hidden = on; draw(); }
    document.getElementById('cntMode').onclick = function () { setMode(true); };
    document.getElementById('cntCancel').onclick = function () { setMode(false); };
    document.getElementById('cntSave').onclick = function () {
      var who = sess.emp || S.settings.me || 'MANAGER', k = 0, rows = [];
      app.querySelectorAll('#tb tr').forEach(function (tr) {
        var r = tr.querySelector('[data-k=r]').value, f = tr.querySelector('[data-k=f]').value;
        if (r === '' && f === '') return;
        rows.push({ n: BY_ID[tr.dataset.id], r: Number(r || 0), f: Number(f || 0) });
      });
      var changed = rows.filter(function (x) { return x.r + x.f !== onHand(x.n.id); }).length, why = readReason('cntWhy');
      if (changed && why === null) { document.getElementById('cntMsg').textContent = changed + ' counts are different from the system. Pick a reason first.'; return; }
      rows.forEach(function (x) {
        var n = x.n, before = onHand(n.id), tot = x.r + x.f, diff = tot !== before;
        S.stock[n.id] = tot; k++;
        addLog({ type: 'COUNT', who: who, net: n.id, qty: tot, loc: n.pick, reason: diff ? why : '', note: 'Count sheet: boxes ' + x.r + ' + top ' + x.f + ' (was ' + before + ')' + (diff ? ' · reason: ' + why : ' · matches') });
      });
      save(); toast(k ? k + ' counts saved.' : 'Nothing filled in.'); setMode(false);
    };
    document.getElementById('cntPrint').onclick = function () {
      var t = document.createElement('div'); t.className = 'sheet';
      t.innerHTML = '<h3>ArmorX doornet count sheet · ' + esc(new Date().toLocaleDateString()) + ' · counted by ____________</h3><table><thead><tr><th>Pick box</th><th>Net</th><th>Other boxes</th><th>In boxes</th><th>On top</th><th>Total</th></tr></thead><tbody>' +
        walkSorted().map(function (n) { return '<tr><td>' + esc(n.pick) + '</td><td>' + esc(netLabel(n)) + (n.kind === 'bin' ? ' (bin)' : '') + '</td><td>' + esc((n.backups || []).join(' ')) + '</td><td></td><td></td><td></td></tr>'; }).join('') + '</tbody></table>';
      printLabels([t], 'A4P');
    };
    document.getElementById('q').oninput = draw; draw();
    drawBoxCount(false);
    drawMoves();
    drawExcel();
  }
  // Rack change (22 Nov 2026, one colour per box): box numbers still kept under a box that no longer holds that net.
  // After the nets are carried to their new box, a manager moves the numbers in one go. The total of each net stays the same.
  function oldBoxRows() {
    return Object.keys(S.shelf).map(function (k) { return S.shelf[k]; }).filter(function (r) {
      var b = BOXES[r.box], n = BY_ID[r.net]; return n && r.box !== FLOOR2 && Number(r.qty) > 0 && !(b && b.nets.indexOf(r.net) >= 0);
    }).map(function (r) { var n = BY_ID[r.net]; return { from: r.box, n: n, q: Number(r.qty), to: (window.LAYOUT_MOVES || {})[r.box + '|' + r.net] || n.pick }; })
      .sort(function (a, b) { return sideOrder(a.from, b.from); });
  }
  function drawMoves() {
    var el = document.getElementById('mvCard'); if (!el) return;
    var rows = oldBoxRows(); el.hidden = !rows.length || !can('Manager'); if (el.hidden) return;
    el.innerHTML = '<h3>Rack change: move box numbers</h3><div class="small">These nets are still counted in a box they no longer belong to. Carry them to their new box first, then press <b>Move numbers</b>. Totals do not change.</div>' +
      '<div class="tablewrap"><table><thead><tr><th>Net</th><th>Old box</th><th>Nets</th><th>New box</th></tr></thead><tbody>' +
      rows.map(function (x) { return '<tr><td><span class="sw sw-' + x.n.color + '"></span>' + esc(netLabel(x.n)) + '</td><td><code>' + esc(x.from) + '</code></td><td><b>' + x.q + '</b></td><td><code>' + esc(x.to === FLOOR2 ? 'TOP (top of racks)' : x.to) + '</code></td></tr>'; }).join('') +
      '</tbody></table></div><div class="row" style="justify-content:flex-end"><span class="small" id="mvMsg"></span><button class="btn primary" id="mvGo">Move numbers</button></div>';
    document.getElementById('mvGo').onclick = function () {
      if (!sheetV8()) { document.getElementById('mvMsg').textContent = 'Needs the Google Sheet script version ' + BOXQTY_V + '.'; return; }
      rows.forEach(function (x) {
        setBoxQty(x.to, x.n.id, counted(x.to, x.n.id) + x.q, 'Rack change', '', { noUndo: true }); // add to the new box first, so the total never dips
        setBoxQty(x.from, x.n.id, 0, 'Rack change', '', { noUndo: true, keepState: true });
      });
      S.undo = null; save(); toast(rows.length + ' box numbers moved.'); route();
    };
  }
  function reasonSelect(id) {
    return '<label class="f">Reason for changes<select id="' + id + '"><option value="">— pick a reason —</option>' + COUNT_REASONS.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Details (for Other)<input id="' + id + 'Txt" maxlength="80"></label>';
  }
  function readReason(id) { // null = not given
    var v = document.getElementById(id).value, t = document.getElementById(id + 'Txt').value.trim();
    if (!v) return null;
    if (v === 'Other') return t ? 'Other: ' + t : null;
    return t ? v + ': ' + t : v;
  }
  // box count review: per net, every home box counted -> new total = boxes + top of racks
  function countRows() {
    return walkSorted().map(function (n) {
      var homes = homeOf(n), got = homes.filter(function (c) { return S.counts[countKey(c, n.id)]; }), fl = S.counts[countKey(FLOOR2, n.id)];
      var racks = got.reduce(function (a, c) { return a + Number(S.counts[countKey(c, n.id)].qty); }, 0), floor = fl ? Number(fl.qty) : 0;
      return { n: n, racks: racks, floor: floor, fl: !!fl, total: racks + floor, missing: homes.filter(function (c) { return got.indexOf(c) < 0; }), any: got.length > 0 || !!fl };
    });
  }
  function drawBoxCount(open) {
    var el = document.getElementById('bcCard'); if (!el) return;
    var p = countProgress(), rows = countRows().filter(function (x) { return x.any; });
    var ready = rows.filter(function (x) { return !x.missing.length; }), part = rows.filter(function (x) { return x.missing.length; });
    var diff = ready.filter(function (x) { return x.total !== onHand(x.n.id); });
    var left = Object.keys(BOXES).filter(function (c) { return !boxCounted(c); }).sort(sideOrder);
    el.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center"><h3>Box recount ' + tipBtn('RECOUNT') + '</h3>' + (rows.length ? '<button class="btn" id="bcOpen">' + (open ? 'Hide' : 'Review and apply') + '</button>' : '') + '</div>' +
      '<div class="small">' + (rows.length ? '<b>' + p.done + ' of ' + p.total + '</b> boxes counted' + (p.floor ? ', ' + p.floor + ' nets on top of the racks' : '') + '. Counts change stock only when you press Apply.' : 'No box recounts yet. On a phone: Scan station → <b>Box recount</b> (managers), scan each shelf label and type how many are in it. Scan <b>TOP</b> for the top of the racks.') + '</div>' +
      (open ? '<details class="small"' + (left.length && left.length <= 40 ? ' open' : '') + '><summary>' + left.length + ' boxes not counted yet</summary><div class="mono">' + (left.map(esc).join(' ') || 'none') + '</div></details>' +
        '<div class="tablewrap"><table><thead><tr><th>Net</th><th>In system</th><th>Boxes</th><th>On top</th><th>New total</th><th>Change</th></tr></thead><tbody>' +
        ready.map(function (x) { var d = x.total - onHand(x.n.id), fc = S.counts[countKey(FLOOR2, x.n.id)]; return '<tr><td><span class="sw sw-' + x.n.color + '"></span>' + esc(netLabel(x.n)) + '</td><td>' + onHand(x.n.id) + '</td><td>' + x.racks + '</td><td>' + (x.fl ? x.floor + (fc && x.floor ? ' <span class="small muted">' + esc(topText(topSplit(x.floor, fc.parts), true)) + '</span>' : '') : '<span class="muted">not counted = 0</span>') + '</td><td><b>' + x.total + '</b></td><td>' + (d ? '<b>' + (d > 0 ? '+' : '') + d + '</b>' : '<span class="muted">same</span>') + '</td></tr>'; }).join('') +
        (part.length ? '<tr><td colspan="6" class="small"><b>Not applied yet (' + part.length + ' nets), boxes still to count:</b> ' + part.map(function (x) { return esc(netLabel(x.n)) + ' <code>' + esc(x.missing.join(' ')) + '</code>'; }).join(' · ') + '</td></tr>' : '') +
        '</tbody></table></div><div class="small muted">A net is applied when all its boxes are counted. Its count on top of the racks is added if one was entered, otherwise it counts as 0 on top. Boxes counted 0 are marked empty and go on the refill list. Part-full boxes are fine: the app keeps one total per net.</div>' +
        '<div class="row" style="justify-content:flex-end;align-items:flex-end"><span class="small muted" id="bcMsg"></span>' + (diff.length ? reasonSelect('bcWhy') : '') + '<button class="btn primary" id="bcApply"' + (ready.length ? '' : ' disabled') + '>Apply ' + ready.length + ' counts</button></div>' : '');
    var ob = document.getElementById('bcOpen'); if (ob) ob.onclick = function () { drawBoxCount(!open); };
    var ab = document.getElementById('bcApply'); if (ab) ab.onclick = function () { applyBoxCount(ready, diff.length ? readReason('bcWhy') : '', diff.length); };
  }
  function applyBoxCount(ready, why, ndiff) {
    var msg = document.getElementById('bcMsg'), who = sess.emp || S.settings.me;
    if (!who) { msg.textContent = 'Sign in first, so the counts carry your name.'; return; }
    if (sheetOn() && !sheetNew()) { msg.textContent = OLD_SHEET + 'use the count sheet.'; return; }
    if (ndiff && why === null) { msg.textContent = ndiff + ' nets are different from the system. Pick a reason first.'; return; }
    var used = [], boxes = {};
    ready.forEach(function (x) {
      var n = x.n, before = onHand(n.id), d = x.total !== before;
      S.stock[n.id] = x.total;
      addLog({ type: 'COUNT', who: who, net: n.id, qty: x.total, loc: n.pick, reason: d ? why : '', note: 'Box recount: boxes ' + x.racks + ' + top ' + x.floor + ' (was ' + before + ')' + (d ? ' · reason: ' + why : ' · matches') });
      homeOf(n).forEach(function (c) { used.push(countKey(c, n.id)); boxes[c] = 1; });
      if (x.fl) used.push(countKey(FLOOR2, n.id));
    });
    Object.keys(boxes).sort(sideOrder).forEach(function (c) { // counted boxes: 0 = empty (refill list), more = has nets
      if (!boxCounted(c)) return;
      var sum = BOXES[c].nets.reduce(function (a, id) { return a + Number(S.counts[countKey(c, id)].qty); }, 0);
      if (sum === 0 && !isEmpty(c)) { S.boxes[c] = { state: 'empty', at: now(), by: who }; addLog({ type: 'EMPTY', who: who, loc: c, note: 'Box recount: empty' }); }
      else if (sum > 0 && isEmpty(c)) { var own = BOXES[c].kind === 'own' ? BOXES[c].nets[0] : ''; S.boxes[c] = { state: 'full', net: own, wo: '', made: null, at: now(), by: who }; addLog({ type: 'BOXSET', who: who, net: own, loc: c, state: 'full', note: 'Box recount: ' + sum + ' nets in box' }); }
    });
    used.forEach(function (k) { var c = S.counts[k]; if (c) { S.shelf[k] = { box: c.box, net: c.net, qty: Number(c.qty) || 0, at: now(), by: who }; if (c.box === FLOOR2) S.shelf[k].parts = fitParts(c.parts, Number(c.qty) || 0); } delete S.counts[k]; }); // the counted number is now the box's number
    addLog({ type: 'COUNTDONE', who: who, keys: used, note: 'Box recount applied: ' + ready.length + ' nets' + (why ? ' · reason: ' + why : '') });
    S.undo = null; save(); toast(ready.length + ' counts applied.'); route();
  }

  // ---------- Excel: download the inventory (one row per net and box, plus top of racks), edit, upload ----------
  var XL_COLS = ['Net ID', 'Size', 'Color', 'Box', 'Box type', 'In box', 'Net total now', 'Not in a box', 'Top as boxes'];
  function xlRows() {
    var rows = [];
    walkSorted().forEach(function (n) {
      var nb = Math.max(0, onHand(n.id) - inBoxes(n.id) - counted(FLOOR2, n.id));
      homeOf(n).concat([FLOOR2]).forEach(function (c) {
        rows.push([n.id, n.size, n.color, c, c === FLOOR2 ? 'top of racks' : (BOXES[c].role === 'pick' ? 'pick' : 'backup') + (BOXES[c].kind === 'bin' ? ' (3 bins)' : ''), counted(c, n.id), onHand(n.id), nb, c === FLOOR2 ? topText(topOf(n.id)) : '']);
      });
    });
    return rows;
  }
  // a tiny .xlsx writer (no packages): one sheet, plain cells, zip without compression
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], cd = [], off = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; } function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), c = crc32(data);
      var head = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(c), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      cd.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(c), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
      off += head.length + name.length + data.length;
    });
    var cdLen = cd.reduce(function (a, x) { return a + x.length; }, 0);
    return new Blob(parts.concat(cd, [new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdLen), u32(off), u16(0)))]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xmlEsc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xlsx(rows) {
    var sheet = rows.map(function (row, ri) { return '<row r="' + (ri + 1) + '">' + row.map(function (v, ci) { var ref = colName(ci) + (ri + 1);
      return typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t>' + xmlEsc(v) + '</t></is></c>'; }).join('') + '</row>'; }).join('');
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' + sheet + '</sheetData></worksheet>']
    ]);
  }
  // reading an .xlsx (from Excel or Google Sheets) or a .csv back in
  function unzip(buf) {
    var d = new DataView(buf), u8 = new Uint8Array(buf), e = buf.byteLength - 22;
    while (e >= 0 && d.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) return Promise.reject(new Error('not an Excel file'));
    var n = d.getUint16(e + 10, true), p = d.getUint32(e + 16, true), out = {}, jobs = [], dec = new TextDecoder();
    for (var i = 0; i < n; i++) {
      var meth = d.getUint16(p + 10, true), size = d.getUint32(p + 20, true), nl = d.getUint16(p + 28, true), el = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true), lo = d.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
      if (!/^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name)) continue;
      var start = lo + 30 + d.getUint16(lo + 26, true) + d.getUint16(lo + 28, true), raw = u8.subarray(start, start + size);
      jobs.push((function (name, meth, raw) {
        if (meth === 0) { out[name] = dec.decode(raw); return Promise.resolve(); }
        if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('this browser cannot open .xlsx files; save the file as CSV and upload that'));
        return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text().then(function (t) { out[name] = t; });
      })(name, meth, raw));
    }
    return Promise.all(jobs).then(function () { return out; });
  }
  function xlsxRows(files) {
    var X = function (t) { return new DOMParser().parseFromString(t, 'application/xml'); }, ss = [];
    if (files['xl/sharedStrings.xml']) Array.prototype.forEach.call(X(files['xl/sharedStrings.xml']).getElementsByTagName('si'), function (si) { ss.push(Array.prototype.map.call(si.getElementsByTagName('t'), function (t) { return t.textContent; }).join('')); });
    var first = 'xl/worksheets/sheet1.xml';
    if (files['xl/workbook.xml'] && files['xl/_rels/workbook.xml.rels']) { // the first sheet in the workbook, whatever its file name
      var sh = X(files['xl/workbook.xml']).getElementsByTagName('sheet')[0], rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      Array.prototype.forEach.call(X(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship'), function (rl) { if (rl.getAttribute('Id') === rid) first = 'xl/' + rl.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, ''); });
    }
    var doc = files[first] || files[Object.keys(files).filter(function (k) { return /worksheets\/sheet\d+\.xml$/.test(k); }).sort()[0]];
    if (!doc) throw new Error('no sheet found in the file');
    return Array.prototype.map.call(X(doc).getElementsByTagName('row'), function (row) {
      var out = [];
      Array.prototype.forEach.call(row.getElementsByTagName('c'), function (c) {
        var ref = c.getAttribute('r') || '', col = 0, m = /^([A-Z]+)/.exec(ref);
        if (m) for (var i = 0; i < m[1].length; i++) col = col * 26 + m[1].charCodeAt(i) - 64; col = m ? col - 1 : out.length;
        var t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = '';
        if (t === 's') val = ss[Number(v ? v.textContent : -1)] || ''; else if (t === 'inlineStr') val = Array.prototype.map.call(c.getElementsByTagName('t'), function (x) { return x.textContent; }).join(''); else val = v ? v.textContent : '';
        out[col] = val;
      });
      return out;
    });
  }
  function csvRows(text) {
    var rows = [], row = [], cell = '', q = false, sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  // compare the file with what the app has now: changes, and rows that cannot be used (with why)
  function xlCompare(rows) {
    var h = -1, ci = {};
    for (var i = 0; i < Math.min(rows.length, 10); i++) { var low = (rows[i] || []).map(function (v) { return String(v || '').trim().toLowerCase(); }); if (low.indexOf('net id') >= 0 && low.indexOf('box') >= 0 && low.indexOf('in box') >= 0) { h = i; ['net id', 'box', 'in box'].forEach(function (k) { ci[k] = low.indexOf(k); }); break; } }
    if (h < 0) return { error: 'The file needs the columns Net ID, Box and In box (download the inventory first and edit that file).' };
    var changes = [], bad = [], seen = {};
    rows.slice(h + 1).forEach(function (row, j) {
      var line = h + j + 2, id = String(row[ci['net id']] || '').trim(), box = String(row[ci.box] || '').trim().toUpperCase(), raw = String(row[ci['in box']] == null ? '' : row[ci['in box']]).trim();
      if (!id && !box && !raw) return;
      if (box === '2F' || box === 'TOP OF RACKS') box = FLOOR2;
      var n = BY_ID[id];
      if (!n) { bad.push([line, id || '(empty)', 'unknown Net ID']); return; }
      if (box !== FLOOR2 && homeOf(n).indexOf(box) < 0) { bad.push([line, id + ' ' + box, 'this box is not a home of ' + netLabel(n) + ' (its boxes: ' + homeOf(n).join(', ') + ', or TOP)']); return; }
      if (raw === '') return; // left empty: keep as it is
      if (!/^\d+(\.0+)?$/.test(raw)) { bad.push([line, id + ' ' + box, '"' + raw + '" is not a whole number of nets (0 or more)']); return; }
      var k = countKey(box, id); if (seen[k]) { bad.push([line, id + ' ' + box, 'this net and box is in the file twice']); return; } seen[k] = 1;
      var q = Math.round(Number(raw)), now = counted(box, id);
      if (q !== now) changes.push({ n: n, box: box, from: now, to: q, odd: box === FLOOR2 ? q - now >= ODD_TOP : !!oddBox(q, boxCap(box, id)) });
    });
    return { changes: changes, bad: bad, rows: rows.length - h - 1 };
  }
  function drawExcel(res) {
    var el = document.getElementById('xlCard'); if (!el) return;
    var lu = S.lastUpload;
    el.innerHTML = '<h3>Excel: download and upload the inventory</h3><div class="small">Download gives one row per net and box, plus the top of the racks: <b>In box</b> is the number in that box, <b>Not in a box</b> is stock the app cannot place yet. ' +
      'To correct many numbers: download, change the <b>In box</b> column in Excel, save, and upload the file here. You see every change before anything is saved; the total of each net moves by the same amount.</div>' +
      '<div class="row" style="align-items:flex-end"><button class="btn" id="xlDown">Download Excel</button><label class="btn" style="cursor:pointer">Upload Excel or CSV<input id="xlUp" type="file" accept=".xlsx,.csv,text/csv" hidden></label>' +
      (lu ? '<button class="btn danger" id="xlUndo">Undo last upload (' + esc(lu.id) + ', ' + lu.rows.length + ' changes)</button>' : '') + '</div><div class="small" id="xlMsg"></div><div id="xlPrev"></div>';
    document.getElementById('xlDown').onclick = function () {
      var a = document.createElement('a'); a.href = URL.createObjectURL(xlsx([XL_COLS].concat(xlRows())));
      a.download = 'ArmorX inventory ' + new Date().toISOString().slice(0, 10) + '.xlsx'; a.click();
    };
    document.getElementById('xlUp').onchange = function () {
      var f = this.files[0], msg = document.getElementById('xlMsg'); if (!f) return;
      if (!sheetV8()) { msg.textContent = 'Excel upload needs the Google Sheet script version ' + BOXQTY_V + '. Paste the new Code.gs and deploy it first.'; return; }
      msg.textContent = 'Reading ' + f.name + '…';
      var job = /\.csv$/i.test(f.name) ? f.text().then(csvRows) : f.arrayBuffer().then(unzip).then(xlsxRows);
      job.then(function (rows) { xlPreview(xlCompare(rows), f.name); }).catch(function (e) { msg.textContent = 'Could not read the file: ' + e.message + '.'; });
      this.value = '';
    };
    var ub = document.getElementById('xlUndo'); if (ub) ub.onclick = function () { xlUndo(); };
  }
  function xlPreview(res, name) {
    var msg = document.getElementById('xlMsg'), pv = document.getElementById('xlPrev');
    if (res.error) { msg.textContent = res.error; pv.innerHTML = ''; return; }
    var nets = {}; res.changes.forEach(function (c) { nets[c.n.id] = (nets[c.n.id] || 0) + (c.to - c.from); });
    msg.innerHTML = '<b>' + esc(name) + '</b>: ' + res.rows + ' rows read, <b>' + res.changes.length + '</b> changes' + (res.bad.length ? ', <b>' + res.bad.length + ' rows cannot be used</b> (listed below, nothing saved for them)' : '') + '.';
    pv.innerHTML = (res.changes.length ? '<div class="tablewrap"><table><thead><tr><th>Net</th><th>Box</th><th>Now</th><th>New</th><th>Change</th><th>Net total after</th></tr></thead><tbody>' +
      res.changes.map(function (c) { var d = c.to - c.from; return '<tr' + (c.odd ? ' class="odd"' : '') + '><td><span class="sw sw-' + c.n.color + '"></span>' + esc(netLabel(c.n)) + '</td><td><code>' + esc(c.box === FLOOR2 ? 'TOP' : c.box) + '</code></td><td>' + c.from + '</td><td><b>' + c.to + '</b>' + (c.odd ? ' <span class="pill p-warn">very high, sure?</span>' : '') + '</td><td><b>' + (d > 0 ? '+' : '') + d + '</b></td><td>' + Math.max(0, onHand(c.n.id) + nets[c.n.id]) + ' <span class="muted small">(now ' + onHand(c.n.id) + ')</span></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="small">No numbers are different from the app. Nothing to save.</div>') +
      (res.bad.length ? '<details class="small" open><summary>' + res.bad.length + ' rows cannot be used</summary><div class="tablewrap"><table><thead><tr><th>Line</th><th>Row</th><th>Why</th></tr></thead><tbody>' + res.bad.map(function (b) { return '<tr><td>' + b[0] + '</td><td>' + esc(b[1]) + '</td><td>' + esc(b[2]) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : '') +
      (res.changes.length ? '<div class="row" style="justify-content:flex-end;align-items:flex-end">' + reasonSelect('xlWhy') + '<button class="btn" id="xlNo">Cancel</button><button class="btn primary" id="xlOk">Save ' + res.changes.length + ' changes</button></div>' : '');
    var no = document.getElementById('xlNo'); if (no) no.onclick = function () { pv.innerHTML = ''; msg.textContent = 'Cancelled. Nothing was changed.'; };
    var ok = document.getElementById('xlOk'); if (ok) ok.onclick = function () {
      var why = readReason('xlWhy'); if (why === null) { msg.textContent = 'Pick a reason for the changes first.'; return; }
      var id = 'UP-' + new Date().toISOString().slice(5, 16).replace(/[-:T]/g, ''), done = [];
      res.changes.forEach(function (c) { setBoxQty(c.box, c.n.id, c.to, why, id); done.push({ loc: c.box, net: c.n.id, from: c.from, to: c.to }); });
      S.lastUpload = { id: id, at: now(), who: sess.emp, rows: done }; S.undo = null; save();
      toast(done.length + ' changes saved from ' + name + '.'); route();
    };
  }
  function xlUndo() { // put back the numbers from before the last upload, where nobody changed them since
    var lu = S.lastUpload, msg = document.getElementById('xlMsg'); if (!lu) return;
    var back = 0, skip = [];
    lu.rows.forEach(function (x) { if (counted(x.loc, x.net) === x.to) { setBoxQty(x.loc, x.net, x.from, 'Undo Excel upload ' + lu.id, lu.id + '-undo'); back++; } else skip.push(netLabel(BY_ID[x.net]) + ' ' + (x.loc === FLOOR2 ? 'TOP' : x.loc)); });
    S.lastUpload = null; save(); route();
    toast(back + ' changes undone.' + (skip.length ? ' ' + skip.length + ' kept, because they changed since: ' + skip.slice(0, 5).join(', ') + (skip.length > 5 ? '…' : '') + '.' : ''));
  }

  // ---------- pick list: paste today's self-ship orders, get them in walking order ----------
  var SKU_MAP = null;
  function skuMap() {
    if (SKU_MAP) return SKU_MAP; SKU_MAP = {};
    NETS.forEach(function (n) { String(n.skus || '').split(',').forEach(function (k) { k = k.trim().toUpperCase(); if (k) { SKU_MAP[k] = n; SKU_MAP['FC-' + k] = n; } }); SKU_MAP[n.id] = n; });
    return SKU_MAP;
  }
  function findNet(line) {
    var up = line.toUpperCase(), toks = up.split(/[\t,;| ]+/).filter(Boolean), m = skuMap(), n = null;
    for (var i = 0; i < toks.length && !n; i++) if (m[toks[i]]) n = m[toks[i]];
    if (!n) { var sz = /(\d{3})\s*[X×*]\s*(\d{2,3})/.exec(up), col = /BLACK|BROWN|GR[AE]Y/.exec(up);
      if (sz && col) { var c = col[0][0] === 'B' ? (col[0] === 'BLACK' ? 'Black' : 'Brown') : 'Grey'; n = NETS.filter(function (x) { return x.size === sz[1] + 'x' + sz[2] && x.color === c; })[0] || null; } }
    var nums = toks.filter(function (t) { return /^\d{1,3}$/.test(t); });
    return { net: n, qty: nums.length ? parseInt(nums[nums.length - 1], 10) : 1 };
  }
  // owner 22 Nov 2026: pickers pick only from the boxes on the racks, never from the top. So the list compares with the pick box
  // (plus the backup boxes for 210x100), not with the total. A short line gets a warning and a choice; it never blocks the list.
  function rackOf(n) {
    var pick = counted(n.pick, n.id), bk = (n.backups || []).reduce(function (a, c) { return a + counted(c, n.id); }, 0);
    return { pick: pick, backup: bk, rack: pick + bk, known: homeOf(n).some(function (c) { return !!S.shelf[countKey(c, n.id)]; }), top: topOf(n.id) };
  }
  // the printed pick list (A4): the same sheet before Final and for every saved list, any time
  function pickSheet(title, rows) { // rows: [{ n, qty, note (html) }]
    var units = rows.reduce(function (a, x) { return a + x.qty; }, 0);
    return '<div class="sheet"><h3>' + esc(title) + ' · ' + units + ' nets · picker ____________</h3><table><thead><tr><th>✓</th><th>Box</th><th>Net</th><th>Qty</th><th>In the box</th><th>Note</th></tr></thead><tbody>' +
      rows.map(function (x) {
        var n = x.n, r = rackOf(n);
        return '<tr' + (x.drop ? ' class="pl-drop"' : '') + '><td>☐</td><td><b>' + esc(n.pick) + '</b>' + (r.backup ? '<br><small>backups ' + esc(n.backups.join(' ')) + '</small>' : '') + '</td><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><b>' + x.qty + '</b></td><td>' + r.rack + (r.backup ? ' <small>(' + r.pick + ' + ' + r.backup + ' backup)</small>' : '') + '</td><td>' + (x.note || '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="small">Tap <b>OUT</b> on the scan station, type the size (or scan the shelf), tap the color and how many.</p></div>';
  }
  function pickRows(p) { return Object.keys(p.lines).map(function (id) { return BY_ID[id]; }).filter(Boolean).sort(function (a, b) { return sideOrder(a.pick, b.pick) || COLORS.indexOf(a.color) - COLORS.indexOf(b.color); }); }
  function printPick(p) {
    var el = document.createElement('div');
    el.innerHTML = pickSheet(pickTitle(p), pickRows(p).map(function (n) { var l = p.lines[n.id]; return { n: n, qty: l.qty, note: esc(l.note || '') }; }));
    printLabels([el.firstChild], 'A4P');
  }
  function viewPick() {
    h('<h2>Pick list</h2><div class="note small">Paste today\'s self-ship orders (Easyship, Seller Flex, website): one line per order item, with the SKU (or size and color, e.g. "210x100 Black") and the quantity. Copying the SKU and Quantity columns from the Amazon order report works. The list comes back in walking order: AR → AL → BR → BL → CR → CL → DR → DL. It checks what is in the boxes on the racks, because pickers never pick from the top.</div>' +
      '<div id="pOpen"></div>' +
      '<h3>New pick list</h3><textarea id="pIn" rows="8" style="width:100%;font-family:var(--f-mono);padding:8px;border:1px solid var(--line);border-radius:2px;background:var(--surface);color:var(--ink)" placeholder="MQDR-210x100-BK\t2&#10;MQ-DR-205x90-GR\t1&#10;200x100 Brown 1"></textarea>' +
      '<div class="row"><button class="btn primary" id="pGo">Make pick list</button><button class="btn" id="pPrint" hidden>Print</button></div><div id="pOut"></div><div id="pFinal"></div>');
    var lastNode = null, made = null;
    function lineQty(x) { var c = made.choice[x.n.id]; return Math.max(0, Math.min(x.want, onHand(x.n.id), c === 'cut' ? x.r.rack : c === 'drop' ? 0 : x.want)); }
    function noteText(x) { // what the Note column says for a line (plain text; saved with the list)
      var c = made.choice[x.n.id], q = lineQty(x);
      if (x.short) return c === 'drop' ? 'Removed' : c === 'cut' ? 'Cut to ' + q + ' (what is in the box)' : c === 'keep' ? 'Bring ' + Math.min(x.short, x.r.top.q) + ' down from the top first' : '';
      if (x.want > x.r.pick && x.r.backup) return 'Pick box has ' + x.r.pick + ': swap a backup box down, or pick from it';
      return '';
    }
    function drawList() {
      var rows = made.rows.map(function (n) { var r = rackOf(n), want = made.tot[n.id]; return { n: n, want: want, r: r, short: Math.max(0, want - r.rack) }; });
      var shorts = rows.filter(function (x) { return x.short; });
      var html = pickSheet('Pick list · not final yet · ' + whenText(now()), rows.map(function (x) {
        var c = made.choice[x.n.id];
        return { n: x.n, qty: x.short && c ? lineQty(x) : x.want, drop: c === 'drop' && x.short, note: x.short && !c ? '<b>' + x.short + ' short</b>' : esc(noteText(x)) };
      }));
      var warn = shorts.length ? '<div class="card pl-short"><h3>' + shorts.length + ' line' + (shorts.length > 1 ? 's are' : ' is') + ' short in the boxes ' + tipBtn('SHORT') + '</h3><div class="small">Pickers take nets only from the boxes on the racks. Choose for each line. You can still make the list final.</div>' +
        shorts.map(function (x) {
          var n = x.n, c = made.choice[n.id], top = x.r.top.q, stock = onHand(n.id);
          var why = 'Wants <b>' + x.want + '</b>, the box' + (x.r.backup ? 'es have' : ' has') + ' <b>' + x.r.rack + '</b>' + (x.r.known ? '' : ' (no box number yet)') + ': <b>' + x.short + ' short</b>. ' +
            (top ? 'On top: ' + esc(topText(x.r.top)) + '. Bring ' + Math.min(x.short, top) + ' down to the box.' : 'Nothing on top of the racks.') + (stock < x.want ? ' Only <b>' + stock + '</b> in stock in all.' : '');
          return '<div class="pls"><div class="pls-n"><span class="sw sw-' + n.color + '"></span><b>' + esc(netLabel(n)) + '</b> <code>' + esc(n.pick) + '</code></div><div class="small">' + why + '</div><div class="pls-b">' +
            [['keep', 'Keep ' + Math.min(x.want, stock) + (top ? ', bring from top' : '')], ['cut', 'Cut to ' + Math.min(x.r.rack, stock)], ['drop', 'Remove line']].filter(function (o) { return o[0] !== 'cut' || x.r.rack > 0; })
              .map(function (o) { return '<button type="button" class="btn' + (c === o[0] ? ' primary' : '') + '" data-pchoice="' + n.id + '|' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>';
        }).join('') + '</div>' : '';
      document.getElementById('pOut').innerHTML = warn + html + (made.bad.length ? '<div class="note small"><b>Not recognised (' + made.bad.length + '):</b><br>' + made.bad.map(esc).join('<br>') + '</div>' : '');
      lastNode = document.querySelector('#pOut .sheet');
      document.querySelectorAll('[data-pchoice]').forEach(function (b) { b.onclick = function () { var k = b.dataset.pchoice.split('|'); made.choice[k[0]] = k[1]; drawList(); drawFinal(false); }; });
      return rows;
    }
    document.getElementById('pGo').onclick = function () {
      var lines = document.getElementById('pIn').value.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean), tot = {}, bad = [];
      lines.forEach(function (l) { var r = findNet(l); if (!r.net) { bad.push(l); return; } tot[r.net.id] = (tot[r.net.id] || 0) + r.qty; });
      var rows = Object.keys(tot).map(function (id) { return BY_ID[id]; }).sort(function (a, b) { return sideOrder(a.pick, b.pick) || COLORS.indexOf(a.color) - COLORS.indexOf(b.color); });
      made = { rows: rows, tot: tot, bad: bad, choice: {} };
      if (!rows.length) { document.getElementById('pOut').innerHTML = bad.length ? '<div class="note small"><b>Not recognised (' + bad.length + '):</b><br>' + bad.map(esc).join('<br>') + '</div>' : ''; made = null; lastNode = null; }
      else drawList();
      document.getElementById('pPrint').hidden = !rows.length;
      drawFinal(false);
    };
    document.getElementById('pPrint').onclick = function () { if (lastNode) printLabels([lastNode.cloneNode(true)], 'A4P'); };
    // Final (managers): is the list complete? Yes = take all of it off stock now (pickers' scans only tick it off).
    // No = keep stock as it is (pickers' OUT takes it off). Both make the list, with its number, ready to print.
    function drawFinal(ask) {
      var el = document.getElementById('pFinal'); if (!el) return;
      if (!made || !can('Manager')) { el.innerHTML = ''; return; }
      var lines = made.rows.map(function (n) { var r = rackOf(n), want = made.tot[n.id], x = { n: n, want: want, r: r, short: Math.max(0, want - r.rack) }; x.q = lineQty(x); return x; });
      var open = lines.filter(function (x) { return x.short && !made.choice[x.n.id]; });
      var units = lines.reduce(function (a, x) { return a + x.q; }, 0), short = lines.filter(function (x) { return x.q < x.want && made.choice[x.n.id] !== 'drop' && made.choice[x.n.id] !== 'cut'; });
      el.innerHTML = !ask ? '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div class="small">Is this the whole list?</div><div class="row" style="align-items:center"><button class="btn primary" id="pFin">Final</button>' + tipBtn('FINAL') + '</div></div><div class="small" id="pMsg"></div></div>'
        : '<div class="card final-ask"><h3>Remove all these nets from stock now?</h3><div class="small"><b>' + units + '</b> nets of ' + lines.filter(function (x) { return x.q; }).length + ' kinds. <b>Yes:</b> they come off stock now, in one go; pickers then tap <b>OUT</b> as usual and it only ticks the list. <b>No:</b> stock stays as it is; it comes off when pickers tap <b>OUT</b>. Either way the list is saved as <b>Pick list #' + nextPickNo() + '</b>, ready to print.</div>' +
          (short.length ? '<div class="small"><b>Not enough in stock:</b> ' + short.map(function (x) { return esc(netLabel(x.n)) + ' only ' + x.q + ' of ' + x.want; }).join(', ') + '. Only what is in stock goes on the list.</div>' : '') +
          '<div class="row"><button class="btn primary" id="pYes"' + (units ? '' : ' disabled') + '>Yes, remove from stock</button><button class="btn" id="pKeep"' + (units ? '' : ' disabled') + '>No, don\'t remove</button><button class="btn" id="pNo">Back</button></div><div class="small" id="pMsg"></div></div>';
      var f = document.getElementById('pFin'); if (f) f.onclick = function () {
        if (open.length) { document.getElementById('pMsg').innerHTML = '<b>' + open.length + ' short line' + (open.length > 1 ? 's' : '') + ':</b> choose Keep, Cut or Remove for ' + (open.length > 1 ? 'each' : 'it') + ' above first.'; var w = document.querySelector('.pl-short'); if (w && w.scrollIntoView) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        drawFinal(true);
      };
      var no = document.getElementById('pNo'); if (no) no.onclick = function () { drawFinal(false); };
      function finalize(off, btn) {
        var need = off ? PICK_V : PICK2_V;
        if (sheetOn() && (S.sheetV || 0) < need) { document.getElementById('pMsg').textContent = 'Needs the Google Sheet script version ' + need + '. Paste the new google-sheet/Code.gs and deploy it first.'; return; }
        btn.disabled = true;
        var d = new Date(), id = 'PL-' + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 4).toUpperCase();
        var use = lines.filter(function (x) { return x.q > 0; }), no = nextPickNo(), p = { id: id, no: no, created: now(), by: sess.emp, state: 'open', off: off, boxed: off && (!sheetOn() || (S.sheetV || 0) >= PICK2_V), lines: {} };
        use.forEach(function (x) {
          var from = p.boxed ? takeFromBoxes(x.n, x.q) : [];
          if (off) { S.stock[x.n.id] = onHand(x.n.id) - x.q; from.forEach(function (f) { shelfAdd(f[0], x.n.id, -f[1], true); }); }
          p.lines[x.n.id] = { qty: x.q, picked: 0, note: noteText(x), from: from };
        });
        S.picks = S.picks || {}; S.picks[id] = p;
        addLog({ type: 'PICKLIST', who: sess.emp, list: id, no: no, keep: !off, boxes: p.boxed, lines: use.map(function (x) { return { net: x.n.id, netName: netLabel(x.n), qty: x.q, note: p.lines[x.n.id].note, from: p.lines[x.n.id].from }; }), qty: units,
          note: 'Pick list #' + no + ' (' + id + ') final: ' + units + ' nets' + (off ? ' off stock' : ', stock not changed') });
        save(); made = null; lastNode = null;
        toast('Pick list #' + no + ' made: ' + units + ' nets' + (off ? ' taken off stock.' : '. Stock not changed.')); viewPick();
      }
      var yes = document.getElementById('pYes'); if (yes) yes.onclick = function () { finalize(true, yes); };
      var keep = document.getElementById('pKeep'); if (keep) keep.onclick = function () { finalize(false, keep); };
    }
    drawOpen();
  }
  // the lists: today's, plus any older one not picked yet. Print any of them again; picker taps Picking done; manager can undo Final.
  function shownPicks() { return allPicks().filter(function (p) { return isToday(p.created) || p.state !== 'done'; }).reverse(); }
  function pickSum(p) {
    var ids = pickRows(p), all = ids.reduce(function (a, n) { return a + p.lines[n.id].qty; }, 0), got = ids.reduce(function (a, n) { return a + Math.min(p.lines[n.id].picked, p.lines[n.id].qty); }, 0);
    var short = ids.filter(function (n) { return p.lines[n.id].picked < p.lines[n.id].qty; }).map(function (n) { return netLabel(n) + ' ' + (p.lines[n.id].qty - p.lines[n.id].picked); });
    return { ids: ids, all: all, got: got, short: short };
  }
  function doneLine(p) { // the picked confirmation, for information only: no number changes
    var m = pickSum(p);
    if (!p.doneBy) return '<span class="muted">Picking not confirmed yet.</span>';
    return '<b>✓ Picked</b> by ' + esc(wname(p.doneBy)) + ' at ' + esc(whenText(p.doneAt || p.created)) + (p.doneShort && p.doneShort.length ? ' · <b>short:</b> ' + esc(p.doneShort.join(', ')) : m.short.length ? ' · <b>short:</b> ' + esc(m.short.join(', ')) : ' · all ' + m.all + ' nets');
  }
  function drawOpen() {
    var el = document.getElementById('pOpen'); if (!el) return;
    var lists = shownPicks(), v11 = !sheetOn() || (S.sheetV || 0) >= PICK2_V;
    if (!lists.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h3>Pick lists</h3>' + lists.map(function (p) {
      var m = pickSum(p), mgr = can('Manager');
      return '<div class="card pl-card" data-pl="' + esc(p.id) + '"><div class="row" style="justify-content:space-between;align-items:center"><h3>' + esc(pickTitle(p)) + ' · ' + (p.state === 'done' ? 'all picked' : m.got + ' of ' + m.all + ' picked') + '</h3>' +
        '<span class="small muted">' + (p.off === false ? 'stock comes off when picked' : 'off stock at Final') + (p.by ? ' · ' + esc(wname(p.by)) : '') + '</span></div>' +
        '<div class="small pl-done">' + doneLine(p) + '</div>' +
        '<div class="row pl-acts"><button class="btn" data-plprint="' + esc(p.id) + '">Print</button>' +
        (!p.doneBy && v11 ? '<button class="btn primary" data-pldone="' + esc(p.id) + '">Picking done</button>' : '') +
        (mgr && v11 && !m.got ? '<button class="btn" data-plundo="' + esc(p.id) + '">Undo Final</button>' : '') + '</div>' +
        '<details' + (p.state === 'done' ? '' : ' open') + '><summary class="small">Lines</summary><div class="tablewrap"><table><thead><tr><th>Box</th><th>Net</th><th>To pick</th><th>Picked</th><th>Left</th>' + (mgr ? '<th></th>' : '') + '</tr></thead><tbody>' +
        m.ids.map(function (n) { var l = p.lines[n.id], left = Math.max(0, l.qty - l.picked);
          return '<tr' + (left ? '' : ' class="muted"') + '><td><b>' + esc(n.pick) + '</b></td><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td>' + l.qty + '</td><td>' + l.picked + '</td><td><b>' + (left || '✓') + '</b></td>' +
            (mgr ? '<td>' + (left ? '<button class="btn" data-plback="' + esc(p.id) + '|' + n.id + '">Not picked…</button>' : '') + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div></details><div class="small" data-plmsg="' + esc(p.id) + '"></div></div>';
    }).join('') + '<hr>';
    function msgOf(id) { return el.querySelector('[data-plmsg="' + id + '"]'); }
    el.querySelectorAll('[data-plprint]').forEach(function (b) { b.onclick = function () { printPick(S.picks[b.dataset.plprint]); }; });
    el.querySelectorAll('[data-pldone]').forEach(function (b) { b.onclick = function () {
      var p = S.picks[b.dataset.pldone], m = pickSum(p), msg = msgOf(p.id);
      var go = function () {
        p.doneBy = sess.emp; p.doneAt = now(); p.doneShort = m.short;
        addLog({ type: 'PICKDONE', who: sess.emp, list: p.id, qty: m.got, short: m.short, note: pickTitle(p) + ' picked: ' + m.got + ' of ' + m.all + (m.short.length ? ' · short: ' + m.short.join(', ') : '') });
        save(); toast(pickTitle(p) + ': picking done. The manager can see it.'); drawOpen();
      };
      if (!m.short.length) { go(); return; }
      msg.innerHTML = '<div class="cfm light"><div class="cfm-what"><b>' + (m.all - m.got) + '</b> not picked yet: ' + esc(m.short.join(', ')) + '. Tell the manager. Done anyway?</div><div class="cfm-b"><button type="button" class="btn primary" data-plyes="1">Yes, done</button><button type="button" class="btn" data-plyes="0">Back</button></div></div>';
      msg.querySelectorAll('[data-plyes]').forEach(function (y) { y.onclick = function () { if (y.dataset.plyes === '1') go(); else msg.innerHTML = ''; }; });
    }; });
    el.querySelectorAll('[data-plundo]').forEach(function (b) { b.onclick = function () {
      var p = S.picks[b.dataset.plundo], m = pickSum(p), msg = msgOf(p.id);
      if (m.got > 0) { msg.innerHTML = '<b>Pickers have already picked ' + m.got + ' from this list</b>, so it cannot be undone. Use <b>Not picked…</b> on a line, or make a new list for anything extra.'; return; }
      msg.innerHTML = '<div class="cfm light"><div class="cfm-what">Undo ' + esc(pickTitle(p)) + '? ' + (p.off === false ? 'Stock was not changed by it.' : 'Its <b>' + m.all + '</b> nets go back into stock.') + ' The list comes back below so you can change it and press Final again.</div><div class="cfm-b"><button type="button" class="btn primary" data-plyes="1">Yes, undo Final</button><button type="button" class="btn" data-plyes="0">Back</button></div></div>';
      msg.querySelectorAll('[data-plyes]').forEach(function (y) { y.onclick = function () {
        if (y.dataset.plyes !== '1') { msg.innerHTML = ''; return; }
        var text = m.ids.map(function (n) { return n.size + ' ' + n.color + ' ' + p.lines[n.id].qty; }).join('\n');
        if (p.off !== false) m.ids.forEach(function (n) { S.stock[n.id] = onHand(n.id) + p.lines[n.id].qty; (p.boxed ? p.lines[n.id].from || [] : []).forEach(function (f) { shelfAdd(f[0], n.id, f[1]); }); });
        addLog({ type: 'PICKUNDO', who: sess.emp, list: p.id, keep: p.off === false, lines: m.ids.map(function (n) { return { net: n.id, qty: p.lines[n.id].qty }; }), qty: m.all, note: pickTitle(p) + ': Final undone' + (p.off === false ? '' : ', ' + m.all + ' nets back to stock') });
        delete S.picks[p.id]; S.undo = null; save();
        toast(pickTitle(p) + ' undone.' + (p.off === false ? '' : ' ' + m.all + ' nets back in stock.'));
        viewPick(); document.getElementById('pIn').value = text; document.getElementById('pGo').click();
        var f = document.getElementById('pIn'); if (f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }; });
    }; });
    el.querySelectorAll('[data-plback]').forEach(function (b) { b.onclick = function () {
      var k = b.dataset.plback.split('|'), p = S.picks[k[0]], n = BY_ID[k[1]], l = p.lines[n.id], left = Math.max(0, l.qty - l.picked), td = b.parentNode, kept = p.off === false;
      td.innerHTML = '<div class="pl-back">' + (kept ? '<button class="btn primary" data-plgo="0">Take off the list (' + left + ')</button>' : '<button class="btn primary" data-plgo="1">Back to stock (' + left + ')</button><button class="btn" data-plgo="0">Not on the shelf</button>') + '</div>';
      td.querySelectorAll('[data-plgo]').forEach(function (g) { g.onclick = function () {
        var restock = g.dataset.plgo === '1';
        var back = restock && p.boxed ? ((l.from || [])[0] || [n.pick])[0] : '';
        l.qty -= left; pickTick(p.id, n.id, 0); if (restock) S.stock[n.id] = onHand(n.id) + left;
        if (back) shelfAdd(back, n.id, left);
        addLog({ type: 'PICKBACK', who: sess.emp, list: p.id, net: n.id, qty: left, restock: restock, backTo: back, note: pickTitle(p) + ': ' + left + ' not picked · ' + (kept ? 'off the list, stock not changed' : restock ? 'back to stock' : 'not on the shelf, stays off stock') });
        S.undo = null; save(); toast(netLabel(n) + ': ' + left + (restock ? ' back to stock.' : ' taken off the list.')); drawOpen();
      }; });
    }; });
  }

  // ---------- rack map ----------
  function viewRacks() {
    var sides = window.SIDES || [], COLS = window.RACK_COLS || 6, RNG = window.SIDE_RANGES || {};
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Rack map</h2><label class="f">Find a size<input id="rq" placeholder="e.g. 205x90"></label></div>' +
      '<div class="note small">Sizes in number order. Popular sizes on R2–R4, slow sizes on R1/R5. Extra stock sits on top of the racks. 210×100 is in AR columns 1–3, picked from R3.</div>' +
      '<div class="legend"><span><i style="background:var(--soft-ok)"></i>Pick box, healthy</span><span><i style="background:var(--soft-warn)"></i>Low</span><span><i style="background:var(--soft-bad)"></i>Out / box empty</span><span><i style="border:1px dashed var(--ink)"></i>Backup</span></div>' +
      '<div class="small muted">Tap a box to see everything about that net.</div><div class="pop" id="boxInfo" hidden></div><div class="sides" id="sides"></div>');
    var out = '';
    sides.forEach(function (s) {
      var rg = RNG[s] ? RNG[s][0] + ' – ' + RNG[s][1] + (s === 'AR' ? ' + 210x100' : '') : '';
      out += '<div class="side"><div><span class="tag' + (/R$/.test(s) ? ' r' : '') + '">' + s + '</span> <span class="small muted">' + esc(rg) + '</span></div><div class="rack" style="grid-template-columns:30px repeat(' + COLS + ',minmax(0,1fr))"><div></div>';
      for (var c = 1; c <= COLS; c++) out += '<div class="h">C' + c + '</div>';
      for (var r = USE_R6 ? 6 : 5; r >= 1; r--) {
        out += '<div class="h">R' + r + '</div>';
        for (var c2 = 1; c2 <= COLS; c2++) {
          var code = s + '-C' + c2 + '-R' + r, bx = BOXES[code];
          if (!bx) { out += '<div class="bx free" data-b="' + code + '">·</div>'; continue; }
          var list = netsAt(code), n = list[0], st = isEmpty(code) ? 'out' : (bx.kind === 'bin' ? (list.some(function (x) { return status(x) === 'out'; }) ? 'out' : list.some(function (x) { return status(x) === 'low'; }) ? 'low' : 'ok') : status(n));
          out += '<div class="bx ' + st + (bx.role === 'backup' ? ' bkp' : '') + '" data-b="' + code + '" data-s="' + n.size + '" title="' + code + '"><span>' + n.size + '</span><span>' + (bx.kind === 'bin' ? '3 bins' : n.color) + (bx.role === 'backup' ? ' ·B' : '') + '</span>' + (boxKnown(code) ? '<span class="q">' + boxTotal(code) + '</span>' : '') + '</div>';
        }
      }
      out += '</div></div>';
    });
    document.getElementById('sides').innerHTML = out;
    // tap a box: a pop-up in front of the screen (owner 22 Nov 2026): the total first, then one line per place it sits.
    // The lines always add up to the total. No pictures: plain numbers that are easy to read on a phone.
    function info(code) {
      var bx = BOXES[code], el = document.getElementById('boxInfo');
      var close = function () { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('pop-on'); };
      el.onclick = function (e) { if (e.target === el || e.target.closest('[data-popx]')) close(); };
      el.onkeydown = function (e) { if (e.key === 'Escape') close(); };
      var r = boxRec(code), list = bx ? netsAt(code) : [], edit = bx && can('Manager') && sheetV8(), n = list[0];
      if (!bx) {
        el.innerHTML = '<div class="pop-card" role="dialog" aria-modal="true"><div class="pop-h"><div class="pop-net">' + esc(code) + '</div><div class="small">' + esc(locHint(code)) + '. No net here.</div></div><button type="button" class="btn dark pop-x" data-popx="1">Close</button></div>';
        el.hidden = false; document.body.classList.add('pop-on'); return;
      }
      var t = topOf(n.id), boxesIn = inBoxes(n.id), left = pickLeft(n.id) - boxedLeft(n.id), nb = onHand(n.id) - boxesIn - t.q + left, rows = '';
      homeOf(n).forEach(function (c) {
        var known = !!S.shelf[countKey(c, n.id)], b = BOXES[c];
        rows += '<div class="pl' + (c === code ? ' here' : '') + '"><span>' + (b.role === 'pick' ? 'Pick box' : 'Backup box') + ' <code>' + esc(c) + '</code>' + (c === code ? ' <em>this box</em>' : '') + '<small>' + (isEmpty(c) ? 'marked empty · ' : '') + 'a full box holds ' + boxCap(c, n.id) + '</small></span><b>' + (known ? counted(c, n.id) : '—') + '</b></div>';
      });
      rows += '<div class="pl"><span>On top of the racks<small>' + (t.q ? esc(topText(t, true)) + ' · ' + TOP_BOX + ' in a full box' : 'none') + '</small></span><b>' + t.q + '</b></div>';
      if (left) rows += '<div class="pl"><span>On the pick list<small>already off stock, still to pick</small></span><b>−' + left + '</b></div>';
      if (nb > 0) rows += '<div class="pl"><span>Not in a box<small>in stock, no box number yet</small></span><b>' + nb + '</b></div>';
      var rack = homeOf(n).reduce(function (a, c) { return a + counted(c, n.id); }, 0);
      el.innerHTML = '<div class="pop-card" role="dialog" aria-modal="true" aria-label="Box ' + esc(code) + '">' +
        '<div class="pop-h"><div class="pop-net"><span class="sw sw-' + n.color + '"></span>' + esc(n.size.replace('x', ' × ')) + ' ' + esc(n.color) + '</div>' +
        '<div class="small"><b>' + esc(code) + '</b> · ' + (bx.role === 'pick' ? 'PICK box' : 'BACKUP box') + ' · ' + esc(locHint(code)) + (r && r.state !== 'empty' && r.made ? ' · made ' + esc(fmtD(r.made)) : '') + '</div></div>' +
        '<div class="pop-tot"><span>Total in stock</span><b>' + onHand(n.id) + '</b></div>' +
        '<div class="pop-list">' + rows + '<div class="pl sum"><span>Adds up to</span><b>' + (boxesIn + t.q - left + Math.max(0, nb)) + '</b></div></div>' +
        (nb < 0 ? '<div class="pop-warn">The boxes and the top hold <b>' + (-nb) + '</b> more than the total. Count this net again (Box recount), or a manager fixes a box number below.</div>' : '') +
        '<div class="pop-foot"><span>Ready to pick on the racks <b>' + rack + '</b></span><span>Out today <b>' + outToday(n.id) + '</b></span></div>' +
        (edit ? '<details class="pop-edit"><summary>Change a number (manager)</summary>' + editForm(code, n, t) + '</details>'
          : (can('Manager') ? '<div class="small muted">Changing a box number needs the Google Sheet script version ' + BOXQTY_V + '.</div>' : '')) +
        '<div class="small"><a href="#help?q=I tapped a box">What do these numbers mean?</a></div>' +
        '<button type="button" class="btn dark pop-x" data-popx="1">Close</button></div>';
      el.hidden = false; document.body.classList.add('pop-on');
      if (edit) wireEdit(code, n);
    }
    // manager: change the number in this box, the full boxes on top, or the part boxes on top. Reason needed; the total moves by the difference.
    function editForm(code, n, t) {
      return '<div class="seg" role="tablist">' + [['box', 'This box'], ['full', 'Full boxes on top'], ['part', 'Part boxes on top']].map(function (x, i) { return '<button type="button" class="seg-b' + (i ? '' : ' on') + '" data-seg="' + x[0] + '">' + x[1] + '</button>'; }).join('') + tipBtn('EDIT') + '</div>' +
        '<div data-pane="box"><label class="f">Nets in ' + esc(code) + ' now<input id="bqQty" type="number" min="0" inputmode="numeric" value="' + (S.shelf[countKey(code, n.id)] ? counted(code, n.id) : '') + '"></label></div>' +
        '<div data-pane="full" hidden><div class="pa-top-r"><span class="pa-top-l">Full boxes on top<small>' + TOP_BOX + ' nets each</small></span><span class="stepper"><button type="button" data-st="-1" aria-label="One less">−</button><input id="bqFull" type="number" min="0" inputmode="numeric" value="' + t.full + '"><button type="button" data-st="1" aria-label="One more">+</button></span></div></div>' +
        '<div data-pane="part" hidden>' + topForm('bqT', t).replace('<div class="pa-top-r"><span class="pa-top-l">Full boxes', '<div class="pa-top-r" hidden><span class="pa-top-l">Full boxes') + '</div>' +
        '<div class="small bq-prev" id="bqPrev"></div><div class="row" style="align-items:flex-end">' + reasonSelect('bqWhy') + '</div><div class="row"><button class="btn primary" id="bqSave">Save</button></div><div class="small" id="bqMsg"></div>';
    }
    function wireEdit(code, n) {
      var el = document.getElementById('boxInfo'), seg = 'box', t0 = topOf(n.id), tf = topFormWire('bqT', function () { prev(); });
      function want() { // what the manager typed: { loc, q, parts, text } or null
        if (seg === 'box') { var q = parseInt(document.getElementById('bqQty').value, 10); return q >= 0 ? { loc: code, q: q, text: code + ': ' + counted(code, n.id) + ' → ' + q, odd: oddBox(q, boxCap(code, n.id)), same: q === counted(code, n.id) && !!S.shelf[countKey(code, n.id)] } : null; }
        var full = seg === 'full' ? parseInt(document.getElementById('bqFull').value, 10) : t0.full, parts = seg === 'part' ? tf.read().parts : t0.kept;
        if (!(full >= 0)) return null;
        var q = full * TOP_BOX + sum(parts), t1 = topSplit(q, parts);
        return { loc: FLOOR2, q: q, parts: parts, text: 'Top: ' + topText(t0) + ' → ' + topText(t1), odd: q - t0.q >= ODD_TOP ? '<b>' + (q - t0.q) + '</b> more nets on top.' : parts.some(function (x) { return x >= TOP_BOX; }) ? 'A part box has fewer than ' + TOP_BOX + ' nets.' : '', same: topText(t1) === topText(t0) };
      }
      function prev() { var w = want(), p = document.getElementById('bqPrev'); if (!p) return; p.innerHTML = w ? esc(w.text) + ' · total ' + onHand(n.id) + ' → <b>' + (onHand(n.id) + w.q - counted(w.loc, n.id)) + '</b>' : ''; }
      el.querySelectorAll('[data-seg]').forEach(function (b) { b.onclick = function () {
        seg = b.dataset.seg; el.querySelectorAll('[data-seg]').forEach(function (x) { x.classList.toggle('on', x === b); });
        el.querySelectorAll('[data-pane]').forEach(function (x) { x.hidden = x.dataset.pane !== seg; }); prev();
      }; });
      el.querySelector('[data-pane="full"]').onclick = function (e) { var b = e.target.closest('[data-st]'); if (b) { e.stopPropagation(); stepIt(b, +b.dataset.st, 0); } };
      ['bqQty', 'bqFull'].forEach(function (id) { document.getElementById(id).oninput = prev; });
      prev();
      document.getElementById('bqSave').onclick = function () {
        var w = want(), msg = document.getElementById('bqMsg'), why = readReason('bqWhy');
        if (!w) { msg.textContent = 'Type the number that is really there (0 or more).'; return; }
        if (w.same) { msg.textContent = 'That is already the number.'; return; }
        if (why === null) { msg.textContent = 'Pick a reason first.'; return; }
        var go = function () {
          var x = setBoxQty(w.loc, n.id, w.q, why, '', w.loc === FLOOR2 ? { parts: w.parts } : null); save();
          toast((w.loc === FLOOR2 ? 'Top of racks' : w.loc) + ' · ' + netLabel(x.n) + ' changed. Total now ' + onHand(n.id) + '.');
          document.body.classList.remove('pop-on'); viewRacks(); setTimeout(function () { var b = app.querySelector('[data-b="' + code + '"]'); if (b) b.click(); }, 0);
        };
        if (!w.odd && !checkOn()) { go(); return; }
        msg.innerHTML = '<div class="cfm' + (w.odd ? ' cfm-warn' : '') + ' light">' + (w.odd ? '<div class="cfm-w"><b>Are you sure?</b> ' + w.odd + '</div>' : '') + '<div class="cfm-what">' + esc(w.text) + '</div><div class="cfm-b"><button type="button" class="btn primary" id="bqYes">Yes, save</button><button type="button" class="btn" id="bqBack">Back</button></div></div>';
        document.getElementById('bqYes').onclick = go; document.getElementById('bqBack').onclick = function () { msg.innerHTML = ''; };
      };
    }
    app.querySelectorAll('.bx').forEach(function (b) { b.onclick = function () { info(b.dataset.b); }; });
    document.getElementById('rq').oninput = function () { var v = this.value.trim().toLowerCase(); app.querySelectorAll('.bx').forEach(function (b) { b.classList.toggle('hl', !!v && (b.dataset.s || '').indexOf(v) === 0); }); };
  }

  // ---------- refill list (every 3-4 days, from the top of the racks) ----------
  function viewRefill() {
    var empt = Object.keys(BOXES).filter(isEmpty).sort(sideOrder);
    var low = NETS.filter(function (n) { return status(n) !== 'ok'; }).sort(function (a, b) { return sideOrder(a.pick, b.pick); });
    var untracked = Object.keys(BOXES).filter(function (c) { return !boxRec(c); }).length;
    h('<h2>Refill list</h2><div class="note">Walk the racks in order (AR → AL → BR → BL → CR → CL → DR → DL). For each empty box, take the <b>oldest</b> batch from the top of the racks, fill the box, then scan <b>REFILL</b> and the box. Never pour new nets on top of old ones.</div>' +
      '<div class="card"><h3>Empty boxes to fill (' + empt.length + ')</h3><div class="tablewrap"><table><thead><tr><th>Box</th><th>Type</th><th>Net</th><th>Take from top of racks</th></tr></thead><tbody>' +
      (empt.map(function (c) { var bx = BOXES[c], list = netsAt(c); return '<tr><td><code>' + c + '</code></td><td>' + (bx.role === 'pick' ? 'Pick' : 'Backup') + (bx.kind === 'bin' ? ' · 3 bins' : '') + '</td><td>' + list.map(function (n) { return '<span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + (bx.mix ? ' ×' + bx.mix[n.id] : ' ×' + bx.cap); }).join('<br>') + '</td><td>' + list.map(function (n) { var o = oldest2F(n); return o ? '<code>' + o.id + '</code> made ' + esc(fmtD(o.created)) : '<span class="muted">no batch on top of racks</span>'; }).join('<br>') + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="muted">No empty boxes. Pickers scan EMPTY when a box runs out, or SWAP when they bring a backup down.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><h3>Low in total, make more (' + low.length + ')</h3><div class="tablewrap"><table><thead><tr><th>Net</th><th>Pick box</th><th>In total</th><th>Refill at</th></tr></thead><tbody>' +
      low.map(function (n) { return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + n.pick + '</code></td><td>' + onHand(n.id) + '</td><td>' + n.refillAt + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      (untracked ? '<div class="small muted">' + untracked + ' boxes have not been scanned since the new layout. They count as full with an unknown date until the first REFILL, SWAP or rack-in.</div>' : ''));
  }

  // ---------- door work orders (owner 23 Nov 2026, Code.gs version 12) ----------
  // One label per net: WOMQD045-07/20 = door order 45, net 7 of 20, and the barcode is the same text. A label printed again
  // ends in -R2, -R3 ...; the older label then stops working. Steps: Cutting, Stitch base, Stitch sides, Final finishing, Packing
  // (each Received, then Done), then Rack-in (scan the net, then the box: it goes into stock the same way as IN).
  // A scan shows only the next step. Workers never see numbers per person; managers and the owner do.
  var WO_STEPS = ['Cutting', 'Stitch base', 'Stitch sides', 'Final finishing', 'Packing', 'Rack-in'], WO_RACK = 5, WO_V = 12, WO_MAX = 1000, WODEL_V = 13;
  var REJECT_REASONS = ['Torn or damaged', 'Cut wrong', 'Stitching wrong', 'Wrong size', 'Other'];
  var BACK_REASONS = ['Cut wrong', 'Stitching wrong', 'Finishing wrong', 'Other'];
  function woOn() { return !sheetOn() || (S.sheetV || 0) >= WO_V; }
  function woState() { S.wo = S.wo || { orders: {}, rights: { me: false, ids: [] }, daily: [] }; return S.wo; }
  function canOrders() { return can('Manager') || !!(S.wo && S.wo.rights && S.wo.rights.me); }
  function woPad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function woParse(code) {
    var m = /^(WOMQD\d{3,})-(\d+)\/(\d+)(?:-R(\d+))?$/.exec(String(code || '').trim().toUpperCase());
    return m ? { base: m[1] + '-' + m[2] + '/' + m[3], order: m[1], no: Number(m[2]), label: m[4] ? Number(m[4]) : 1 } : null;
  }
  function woBase(o, no) { return o.id + '-' + woPad(no, Math.max(2, String(o.qty).length)) + '/' + o.qty; }
  function woCode(o, x) { return woBase(o, x.no) + (x.label > 1 ? '-R' + x.label : ''); }
  function woFind(p) { var o = p && woState().orders[p.order], x = o && o.nets ? o.nets[p.no] : null; return x && woBase(o, p.no) === p.base ? { o: o, x: x } : null; }
  function woDate(iso) { var d = new Date(iso); return woPad(d.getMonth() + 1, 2) + woPad(d.getDate(), 2) + String(d.getFullYear()).slice(2); } // 112326 = 23 Nov 2026
  function woWhen(iso) { if (!iso) return ''; var d = new Date(iso); return (isToday(iso) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ') + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function woSig(x) { return x.step + '|' + x.st; }
  function woWhere(x) { // where the net is, in plain words: "Waiting for Stitch sides · last step by Ramesh, 10:40"
    var who = x.by ? wname(x.by) + ', ' + woWhen(x.at) : '';
    if (x.st === 'racked') return 'On the rack' + (x.box ? (x.box === FLOOR2 ? ', on top of the rack' : ' in ' + x.box) : '') + (who ? ' · by ' + who : '');
    if (x.st === 'rejected') return 'Rejected' + (x.note ? ': ' + x.note : '') + (who ? ' · by ' + who : '');
    if (x.st === 'recv') return 'At ' + WO_STEPS[x.step] + ' · received by ' + who;
    return 'Waiting for ' + WO_STEPS[x.step] + (who ? ' · last step by ' + who : '');
  }
  function woNext(x) { // the one next step for this net
    if (x.st === 'wait' && x.step < WO_RACK) return { act: 'RECV', say: WO_STEPS[x.step] + ': received' };
    if (x.st === 'recv') return { act: 'DONE', say: WO_STEPS[x.step] + ': done' };
    if (x.st === 'wait' && x.step === WO_RACK) return { act: 'RACKIN', say: 'Rack-in' };
    return null;
  }
  function woFromRemote(w) {
    var out = { orders: {}, rights: w.rights || { me: false, ids: [] }, daily: w.daily || [] };
    (w.orders || []).forEach(function (o) {
      var x = { id: o.id, net: o.net, qty: o.qty, created: o.created, by: o.by, due: o.due || '', state: o.state, finished: o.finished || '', racked: o.racked || 0, rejected: o.rejected || 0, note: o.note || '', nets: null };
      if (o.nets) { x.nets = {}; o.nets.forEach(function (a) { x.nets[a[0]] = { no: a[0], step: a[1], st: a[2], by: a[3], at: a[4], box: a[5], label: a[6] || 1, rw: a[7] || 0, db: (a[8] || []).slice(), note: a[9] || '' }; }); }
      out.orders[o.id] = x;
    });
    return out;
  }
  function woNetList(o) { return o.nets ? Object.keys(o.nets).map(function (k) { return o.nets[k]; }).sort(function (a, b) { return a.no - b.no; }) : []; }
  function woCount(o) { // racked and rejected; done when every net is on the rack or rejected
    if (!o.nets) return;
    var l = woNetList(o); o.racked = l.filter(function (x) { return x.st === 'racked'; }).length; o.rejected = l.filter(function (x) { return x.st === 'rejected'; }).length;
    var done = l.length && o.racked + o.rejected === l.length;
    if (done && o.state !== 'done') { o.state = 'done'; o.finished = now(); } else if (!done) { o.state = 'open'; o.finished = ''; }
  }
  function woLocal(x, act, who, e) { // the same change the sheet makes, so this phone shows it at once (also offline)
    if (act === 'RECV') x.st = 'recv';
    else if (act === 'DONE') { x.db[x.step] = who; x.step += 1; x.st = 'wait'; }
    else if (act === 'RACKIN') { x.step = 6; x.st = 'racked'; x.box = e.loc; }
    else if (act === 'REJECT') { x.st = 'rejected'; x.note = e.reason; }
    else if (act === 'BACK') { for (var k = e.to; k < 5; k++) x.db[k] = ''; x.step = e.to; x.st = 'wait'; x.rw = (x.rw || 0) + 1; x.note = e.reason; }
    x.by = who; x.at = now();
  }
  function woLate(o) { return o.state !== 'done' && o.due && new Date(o.due).getTime() < Date.now(); }
  function woOpen() { return Object.keys(woState().orders).map(function (k) { return S.wo.orders[k]; }).filter(function (o) { return o.state !== 'done'; }); }
  function woBoxFor(n) { var hs = homeOf(n); for (var i = 0; i < hs.length; i++) if (counted(hs[i], n.id) < boxCap(hs[i], n.id)) return hs[i]; return FLOOR2; } // first box with room, else the top

  // ---- labels: Small 50 x 25 mm (or Large 4 x 6 in): size and colour, barcode, the code and the date. Nothing else. ----
  function woLabel(o, x) {
    var n = BY_ID[o.net], code = woCode(o, x), el = document.createElement('div');
    el.className = 'lbl lbl-wo';
    el.innerHTML = '<div class="wl-net"><span class="wl-size">' + esc(n ? n.size : o.net) + '</span> <span class="wl-col">' + esc(n ? n.color.toUpperCase() : '') + '</span></div>' +
      '<svg class="bc"></svg><div class="wl-code"><span>' + esc(code) + '</span><span>' + esc(woDate(o.created)) + '</span></div>';
    barcode(el.querySelector('.bc'), code, null, '9mm');
    return el;
  }
  function woPrint(o, list) { printLabels(list.map(function (x) { return woLabel(o, x); }), '50x25'); }

  // ---- the scan station: a WO label shows the net, where it is, and the one next step ----
  function woScan(code) {
    if (!woOn()) { fb(OLD_SHEET + 'work order labels cannot be scanned yet.', 'bad'); return; }
    var p = woParse(code);
    if (!p) { fb('<b>' + esc(code) + '</b> is not a work order label.', 'bad'); return; }
    var f = woFind(p);
    if (!f) { fb('Work order net <b>' + esc(p.base) + '</b> is not on this phone yet. Wait a few seconds and scan it again. Still the same? Its work order may have been deleted: give the net to the manager.', 'bad'); if (sheetOn()) pull(); return; }
    if (p.label < f.x.label) { fb('<b>Old label.</b> ' + esc(code) + ' was printed again, so it no longer works. Use the new label: <b>' + esc(woCode(f.o, f.x)) + '</b>.', 'bad'); return; }
    sess.mode = null; sess.bc = null; sess.net = null; sess.await = null; sess.pa = null;
    sess.woc = { code: code, p: p };
    woCard(false);
  }
  function woCard(problem) {
    var adj = document.getElementById('adjust'), c = sess.woc, f = c && woFind(c.p); if (!adj || !f) return;
    var o = f.o, x = f.x, n = BY_ID[o.net], nx = woNext(x), h = '<div class="pa pa-card wo-card"><div class="pa-net"><span class="sw sw-' + esc(n ? n.color : '') + '"></span>' + esc(n ? netLabel(n).replace('x', ' × ') : o.net) + '</div>' +
      '<div class="wo-code">' + esc(woCode(o, x)) + '</div><div class="wo-now">' + esc(woWhere(x)) + '</div>';
    sess.await = null;
    if (problem) {
      h += '<div class="pa-step">What is wrong?</div><button type="button" class="act wo-rej" data-wo-rej="1">Reject: the net is damaged</button>' +
        (x.step > 0 ? '<div class="pa-step">Send back for rework to</div><div class="acts-g">' + WO_STEPS.slice(0, Math.min(x.step, WO_RACK)).map(function (s, k) { return '<button type="button" class="act" data-wo-back="' + k + '">' + esc(s) + '</button>'; }).join('') + '</div>' : '') +
        '<button type="button" class="act ghost" data-wo-card="1">Back</button>';
    } else if (nx && nx.act === 'RACKIN') {
      var box = woBoxFor(n), top = box === FLOOR2;
      sess.await = 'woloc';
      h += '<div class="pa-go">' + (top ? 'Boxes are full: put it on top of the rack' : 'Put it in box') + '</div>' + (top ? '' : '<div class="pa-loc">' + esc(box) + '</div><div class="pa-hint">' + esc(locHint(box)) + '</div>') +
        '<div class="pa-step">Then scan the box label ' + tipBtn('WORACK') + '</div>' +
        (top ? '<button type="button" class="act wo-go" data-wo-box="' + FLOOR2 + '">Put on top of the rack</button>' : '<button type="button" class="act ghost" data-wo-box="' + esc(box) + '">No label to scan? Tap: in ' + esc(box) + '</button><button type="button" class="act ghost" data-wo-box="' + FLOOR2 + '">Box full? Put it on top of the rack</button>');
    } else if (nx) {
      h += '<div class="wo-help">' + woHelp(x) + ' ' + tipBtn(nx.act === 'RECV' ? 'WORECV' : 'WODONE') + '</div>' +
        '<button type="button" class="act wo-go" data-wo="' + nx.act + '">' + esc(nx.say) + '</button>';
    }
    if (x.st === 'wait' || x.st === 'recv') h += problem ? '' : '<button type="button" class="linkbtn wo-pl" data-wo-prob="1">Problem with this net?</button>';
    else h += '<div class="small">Nothing to scan here.' + (x.st === 'rejected' ? ' Ask the manager if it is fixed.' : '') + '</div>';
    adj.innerHTML = h + '</div>';
    adj.onclick = function (e) {
      var b = e.target.closest('[data-wo],[data-wo-box],[data-wo-prob],[data-wo-rej],[data-wo-back],[data-wo-card]'); if (!b) return; e.stopPropagation();
      var d = b.dataset;
      if (d.wo) woDo(d.wo, {});
      else if (d.woBox) woRackScan(d.woBox);
      else if (d.woProb) woCard(true);
      else if (d.woCard) woCard(false);
      else if (d.woRej) { sess.await = 'reason'; paint(); fb('Why is it rejected? <b>Tap a reason.</b>', 'warn'); reasonPicker(REJECT_REASONS, function (r) { sess.await = null; woDo('REJECT', { reason: r }); }); }
      else if (d.woBack) { var to = +d.woBack; sess.await = 'reason'; paint(); fb('Back to <b>' + esc(WO_STEPS[to]) + '</b>. Why? <b>Tap a reason.</b>', 'warn'); reasonPicker(BACK_REASONS, function (r) { sess.await = null; woDo('BACK', { to: to, reason: r }); }); }
      if (!TOUCH) refocus();
    };
    fb(esc(n ? netLabel(n) : o.net) + ' · ' + esc(woCode(o, x)) + '. ' + (problem ? 'Tap what is wrong.' : nx ? (nx.act === 'RACKIN' ? 'Scan the box label.' : 'Tap <b>' + esc(nx.say) + '</b>.') : esc(woWhere(x)) + '.'), x.st === 'rejected' ? 'warn' : 'ok');
    paint(); showOnPhone('adjust');
  }
  function woHelp(x) { // one plain line for someone using the app for the first time
    var s = WO_STEPS[x.step], nxt = WO_STEPS[x.step + 1];
    if (x.st === 'wait') return 'Got this net for <b>' + esc(s) + '</b>? Tap <b>Received</b> now. When you have finished it, scan it again and tap <b>Done</b>.';
    return 'Finished <b>' + esc(s) + '</b> on this net? Tap <b>Done</b>. It then goes to <b>' + esc(nxt === 'Rack-in' ? 'Rack-in (into its box)' : nxt) + '</b>. Not finished yet? Leave it.';
  }
  function woRackScan(code) {
    var c = sess.woc, f = c && woFind(c.p); if (!f) { sess.await = null; paint(); return; }
    var n = BY_ID[f.o.net];
    if (code !== FLOOR2 && homeOf(n).indexOf(code) < 0) { fb('<b>Wrong box.</b> ' + esc(code) + ' is not a box for ' + esc(netLabel(n)) + '. Put it in <b>' + esc(woBoxFor(n)) + '</b>' + (woBoxFor(n) === FLOOR2 ? ' (top of the rack)' : '') + '.', 'bad'); return; }
    woDo('RACKIN', { loc: code });
  }
  function woDo(act, e) {
    var c = sess.woc, f = c && woFind(c.p); if (!f) return;
    var o = f.o, x = f.x, n = BY_ID[o.net], prev = clone(x), from = [x.step, x.st], step = x.step;
    var said = act === 'RECV' ? WO_STEPS[step] + ': received' : act === 'DONE' ? WO_STEPS[step] + ': done' : act === 'RACKIN' ? 'Rack-in ' + (e.loc === FLOOR2 ? 'top of the rack' : e.loc) : act === 'REJECT' ? 'Rejected (' + e.reason + ')' : 'Back to ' + WO_STEPS[e.to] + ' (' + e.reason + ')';
    var ev = { type: 'WOSTEP', who: sess.emp, code: c.code, order: o.id, act: act, from: from, net: o.net, note: said + ' · ' + woBase(o, x.no) };
    if (e.loc) ev.loc = e.loc; if (e.reason) ev.reason = e.reason; if (e.to != null) ev.to = e.to;
    var r = { wo: { order: o.id, no: x.no, prev: prev } };
    if (act === 'RACKIN') { // into stock the same way as IN: the total and the box number go up
      var st = {}; st[o.net] = -1; r.stock = st;
      r.boxes = e.loc !== FLOOR2 && isEmpty(e.loc) ? snapBoxes([e.loc]) : {};
      S.stock[o.net] = onHand(o.net) + 1;
      var sa = shelfAdd(e.loc, o.net, 1), pa = {}; if (sa) pa[sa.key] = sa; r.putAdd = pa;
      if (e.loc !== FLOOR2 && isEmpty(e.loc)) setBox(e.loc, { state: 'full', net: o.net, wo: o.id, made: null });
    }
    woLocal(x, act, sess.emp, e); woCount(o);
    ev = addLog(ev); remember(ev, r); save();
    sess.woc = null; sess.await = null;
    var adj = document.getElementById('adjust'); if (adj) adj.innerHTML = '';
    fb('✓ <b>' + esc(said) + '</b> · ' + esc(n ? netLabel(n) : o.net) + ' · ' + esc(woBase(o, x.no)) + (act === 'RACKIN' ? ' · ' + onHand(o.net) + ' in stock' : '') + '. <b>Scan the next net.</b>', act === 'REJECT' || act === 'BACK' ? 'warn' : 'ok');
    paint();
  }

  // ---- Work orders page (managers, or whoever the manager gave label printing today) ----
  function woSizes() { return Array.from(new Set(NETS.map(function (n) { return n.size; }))).sort(function (a, b) { var x = a.split('x').map(Number), y = b.split('x').map(Number); return x[0] - y[0] || x[1] - y[1]; }); }
  function woNetOf(size, color) { return NETS.filter(function (n) { return n.size === String(size).toLowerCase().replace(/\s*[×*x]\s*/, 'x') && n.color === color; })[0] || null; }
  function woLine(line) { // "210x150 Black 25", "210 x 150 BK 25", "MQDR-210x150-BK 25"
    var up = String(line).toUpperCase().replace(/×/g, 'X'), r = findNet(line), n = r.net;
    var z = /(\d{3})\s*[X*]\s*(\d{2,3})/.exec(up);
    if (!n && z) { var col = /\b(BK|BLK|RB)\b/.test(up) ? 'Black' : /\b(BR|BRW|BRN|TBR)\b/.test(up) ? 'Brown' : /\b(GR|GRY|RG)\b/.test(up) ? 'Grey' : ''; if (col) n = woNetOf(z[1] + 'x' + z[2], col); }
    var rest = (z ? up.replace(z[0], ' ') : up).replace(/[A-Z]+-\S+/g, ' '), nums = rest.match(/\d+/g) || [];
    return { line: line, net: n, qty: nums.length ? parseInt(nums[nums.length - 1], 10) : 0 };
  }
  function woLines(text) { return String(text || '').split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean).map(woLine); }
  function woDueDefault() { var d = new Date(Date.now() + 2 * 864e5); d.setMinutes(0, 0, 0); return woLocalInput(d.toISOString()); }
  function woLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); return d.getFullYear() + '-' + woPad(d.getMonth() + 1, 2) + '-' + woPad(d.getDate(), 2) + 'T' + woPad(d.getHours(), 2) + ':' + woPad(d.getMinutes(), 2); }
  function woDueText(o) { return o.due ? woWhen(o.due) : 'no due time'; }
  function woMake(lines, due, msg, done) { // the sheet gives each order the next number, so making orders needs the internet (scans do not)
    var key = JSON.stringify([lines.map(function (l) { return [l.net.id, l.qty]; }), due]);
    if (!S.woReq || S.woReq.key !== key) S.woReq = { key: key, req: 'RQ-' + newId() }; // the same orders sent again never make them twice
    var orders = lines.map(function (l) { return { net: l.net.id, netName: netLabel(l.net), qty: l.qty, due: due || '' }; });
    function take(list) {
      list.forEach(function (o) { var x = { id: o.id, net: o.net, qty: o.qty, created: o.created, by: o.by, due: o.due || '', state: 'open', finished: '', racked: 0, rejected: 0, note: '', nets: {} };
        for (var k = 1; k <= o.qty; k++) x.nets[k] = { no: k, step: 0, st: 'wait', by: '', at: '', box: '', label: 1, rw: 0, db: ['', '', '', '', ''], note: '' };
        woState().orders[o.id] = x; });
      S.woReq = null; save(); done(list.map(function (o) { return S.wo.orders[o.id]; }));
    }
    if (!sheetOn()) { // not connected (test or demo): number them on this device
      var no = Object.keys(woState().orders).reduce(function (a, k) { return Math.max(a, parseInt(k.slice(5), 10) || 0); }, 0);
      take(orders.map(function (o) { return Object.assign({ id: 'WOMQD' + woPad(++no, 3), created: now(), by: wname(sess.emp) }, o); })); return;
    }
    msg.textContent = 'Making the orders…';
    sheetCall({ action: 'wocreate', req: S.woReq.req, station: S.settings.station || '', orders: orders }).then(function (d) {
      if (!d.ok) { msg.textContent = d.auth ? 'Please sign in again.' : (d.error || 'Not saved.'); return; }
      take(d.orders);
    }).catch(function () { msg.textContent = 'No internet: orders were not made. Making an order needs the internet, because each order gets the next number. Scanning nets works without it. Try again when you are online.'; });
  }
  var woView = { filter: 'open', open: null, all: false, tick: {} };
  function woProgress(o) { // where the nets are: "12 at Stitch base · 8 on the rack"
    if (!o.nets) return o.racked + ' on the rack' + (o.rejected ? ' · ' + o.rejected + ' rejected' : '');
    var c = {}; woNetList(o).forEach(function (x) { var k = x.st === 'racked' ? 'on the rack' : x.st === 'rejected' ? 'rejected' : (x.st === 'recv' ? 'at ' : 'waiting for ') + WO_STEPS[x.step]; c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).map(function (k) { return c[k] + ' ' + k; }).join(' · ');
  }
  function viewOrders() {
    var sizes = woSizes(), mgr = can('Manager'), all = Object.keys(woState().orders).map(function (k) { return S.wo.orders[k]; }).sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    var list = all.filter(function (o) { return woView.filter === 'all' || (woView.filter === 'open' ? o.state !== 'done' : o.state === 'done'); });
    var people = S.workers.filter(function (w) { return w.active !== false; }), rights = (S.wo.rights && S.wo.rights.ids) || [], delOk = woDelOn();
    h('<h2>Work orders</h2>' + (sheetOn() && !woOn() ? '<div class="note">' + esc(OLD_SHEET) + 'work orders cannot be made yet.</div>' : '') +
      '<div class="grid2"><div class="card"><h3>New work order</h3><form id="woNew" class="wo-form">' +
      '<label class="f">Size<input id="woSize" list="woSizes" placeholder="e.g. 210x150" autocomplete="off" required></label><datalist id="woSizes">' + sizes.map(function (s) { return '<option value="' + s + '">'; }).join('') + '</datalist>' +
      '<label class="f">Colour<select id="woCol">' + COLORS.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Nets<input id="woQty" type="number" min="1" max="' + WO_MAX + '" inputmode="numeric" required></label>' +
      '<label class="f">Due<input id="woDue" type="datetime-local" value="' + woDueDefault() + '"></label>' +
      '<button class="btn primary">Make order and print labels</button></form><div class="small" id="woMsg"></div></div>' +
      '<div class="card"><h3>Paste a list</h3><div class="small muted">One order per line (or comma): size, colour, number of nets. Example: <b>210x150 Black 25, 210x105 Grey 16</b>.</div>' +
      '<textarea id="woPaste" rows="4" placeholder="210x150 Black 25&#10;210x105 Grey 16"></textarea>' +
      '<div class="row" style="align-items:flex-end"><label class="f">Due for all<input id="woPDue" type="datetime-local" value="' + woDueDefault() + '"></label><button class="btn" id="woCheck" type="button">Check the list</button></div><div id="woPrev"></div></div></div>' +
      (mgr ? '<div class="card"><h3>Label printing today</h3><div class="small muted">Give someone the right to make orders and print labels for today only. It ends at midnight.</div>' +
        '<div class="row" style="align-items:flex-end"><label class="f">Person<select id="woRP">' + people.filter(function (w) { return rights.indexOf(w.id) < 0; }).map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + ' (' + esc(w.id) + ')</option>'; }).join('') + '</select></label><button class="btn" id="woRGive" type="button">Give for today</button></div>' +
        '<div class="small">' + (rights.length ? 'Today: ' + rights.map(function (id) { return '<b>' + esc(wname(id)) + '</b> <button type="button" class="linkbtn" data-wo-rtake="' + esc(id) + '">take away</button>'; }).join(' · ') : 'Nobody else today.') + '</div></div>' : '') +
      '<div class="card" id="woDetail" hidden></div><div id="woDel"></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h3>Orders</h3><div class="row">' + [['open', 'Open'], ['done', 'Finished'], ['all', 'All']].map(function (f) { return '<button type="button" class="btn' + (woView.filter === f[0] ? ' primary' : '') + '" data-wo-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
      (delOk ? '<div class="row wo-delbar"><button type="button" class="btn" id="woDelSel">Delete ticked</button><button type="button" class="btn" id="woDelAll">Clear all work orders</button><span class="small muted">Managers and the owner. You see what is in them before anything is deleted.</span></div>' : '') +
      '<div class="tablewrap"><table><thead><tr>' + (delOk ? '<th><input type="checkbox" id="woTickAll" aria-label="Tick all"></th>' : '') + '<th>Order</th><th>Net</th><th>Nets</th><th>Where the nets are</th><th>Due</th><th>Made</th><th></th></tr></thead><tbody>' +
      (list.map(function (o) { var n = BY_ID[o.net]; return '<tr>' + (delOk ? '<td><input type="checkbox" data-wo-tick="' + esc(o.id) + '"' + (woView.tick[o.id] ? ' checked' : '') + ' aria-label="Tick ' + esc(o.id) + '"></td>' : '') + '<td><code>' + esc(o.id) + '</code></td><td>' + (n ? '<span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) : esc(o.net)) + '</td><td>' + o.qty + '</td><td class="small">' + esc(woProgress(o)) + '</td><td>' + esc(woDueText(o)) + (woLate(o) ? ' <span class="pill p-bad">Late</span>' : '') + (o.state === 'done' && o.due && o.finished > o.due ? ' <span class="pill p-warn">Was late</span>' : '') + '</td><td class="muted small">' + esc(woWhen(o.created)) + ' · ' + esc(o.by || '') + '</td><td><button class="btn" data-wo-open="' + esc(o.id) + '">Open</button></td></tr>'; }).join('') ||
        '<tr><td colspan="' + (delOk ? 8 : 7) + '" class="muted">No ' + (woView.filter === 'open' ? 'open ' : woView.filter === 'done' ? 'finished ' : '') + 'work orders.</td></tr>') + '</tbody></table></div></div>' +
      (Object.keys(S.batches || {}).length ? '<div class="small muted">Older batch labels (WO-0001 ...) are on the <a href="#batches">old batches page</a>.</div>' : ''));
    var msg = document.getElementById('woMsg');
    function printed(os) { os.forEach(function (o) { woView.open = o.id; }); viewOrders(); var m = document.getElementById('woMsg'); if (m) m.innerHTML = 'Made <b>' + os.map(function (o) { return esc(o.id); }).join(', ') + '</b>: ' + os.reduce(function (a, o) { return a + o.qty; }, 0) + ' labels.'; woPrintMany(os); }
    document.getElementById('woNew').onsubmit = function (e) {
      e.preventDefault();
      var n = woNetOf(document.getElementById('woSize').value.trim(), document.getElementById('woCol').value), q = parseInt(document.getElementById('woQty').value, 10), due = document.getElementById('woDue').value;
      if (!n) { msg.textContent = 'No door net in that size. Pick a size from the list (e.g. 210x150).'; return; }
      if (!(q >= 1 && q <= WO_MAX)) { msg.textContent = 'An order has 1 to ' + WO_MAX + ' nets.'; return; }
      woMake([{ net: n, qty: q }], due ? new Date(due).toISOString() : '', msg, printed);
    };
    document.getElementById('woCheck').onclick = function () {
      var ls = woLines(document.getElementById('woPaste').value), bad = ls.filter(function (l) { return !l.net || !(l.qty >= 1 && l.qty <= WO_MAX); }), ok = ls.filter(function (l) { return bad.indexOf(l) < 0; }), pv = document.getElementById('woPrev');
      if (!ls.length) { pv.innerHTML = '<div class="small">Paste or type at least one line.</div>'; return; }
      pv.innerHTML = '<div class="tablewrap"><table><thead><tr><th>Line</th><th>Net</th><th>Nets</th></tr></thead><tbody>' + ls.map(function (l) { var b = bad.indexOf(l) >= 0; return '<tr' + (b ? ' class="bad-row"' : '') + '><td class="small">' + esc(l.line) + '</td><td>' + (l.net ? '<span class="sw sw-' + l.net.color + '"></span>' + esc(netLabel(l.net)) : '<b>size or colour not found</b>') + '</td><td>' + (l.qty >= 1 && l.qty <= WO_MAX ? l.qty : '<b>1 to ' + WO_MAX + '</b>') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (bad.length ? '<div class="small"><b>' + bad.length + ' line' + (bad.length > 1 ? 's' : '') + ' cannot be read</b> and will be left out. Fix them and check again.</div>' : '') +
        (ok.length ? '<button class="btn primary" type="button" id="woGo">Make ' + ok.length + ' order' + (ok.length > 1 ? 's' : '') + ' and print ' + ok.reduce(function (a, l) { return a + l.qty; }, 0) + ' labels</button>' : '') + '<div class="small" id="woPMsg"></div>';
      var go = document.getElementById('woGo'); if (go) go.onclick = function () { var due = document.getElementById('woPDue').value; go.disabled = true; woMake(ok, due ? new Date(due).toISOString() : '', document.getElementById('woPMsg'), function (os) { document.getElementById('woPaste').value = ''; printed(os); }); };
    };
    var give = document.getElementById('woRGive'); if (give) give.onclick = function () { var id = document.getElementById('woRP').value; if (!id) return; woRight(id, true); };
    app.querySelectorAll('[data-wo-rtake]').forEach(function (b) { b.onclick = function () { woRight(b.dataset.woRtake, false); }; });
    app.querySelectorAll('[data-wo-f]').forEach(function (b) { b.onclick = function () { woView.filter = b.dataset.woF; viewOrders(); }; });
    app.querySelectorAll('[data-wo-open]').forEach(function (b) { b.onclick = function () { woView.open = b.dataset.woOpen; woView.all = false; woDetail(true); }; });
    app.querySelectorAll('[data-wo-tick]').forEach(function (b) { b.onchange = function () { if (b.checked) woView.tick[b.dataset.woTick] = 1; else delete woView.tick[b.dataset.woTick]; }; });
    var ta = document.getElementById('woTickAll'); if (ta) ta.onchange = function () { app.querySelectorAll('[data-wo-tick]').forEach(function (b) { b.checked = ta.checked; if (ta.checked) woView.tick[b.dataset.woTick] = 1; else delete woView.tick[b.dataset.woTick]; }); };
    var ds = document.getElementById('woDelSel'); if (ds) ds.onclick = function () { var ids = Object.keys(woView.tick).filter(function (id) { return S.wo.orders[id]; }); if (!ids.length) { toast('Tick the orders to delete first.'); return; } woDelForm(ids, false); };
    var da = document.getElementById('woDelAll'); if (da) da.onclick = function () { var ids = Object.keys(S.wo.orders); if (!ids.length) { toast('There are no work orders.'); return; } woDelForm(ids, true); };
    if (woView.open) woDetail(false);
  }
  // ---- delete work orders (owner 23 Nov 2026, Code.gs version 13): managers and the owner. First see what is in them. ----
  function woDelOn() { return can('Manager') && (!sheetOn() || (S.sheetV || 0) >= WODEL_V); }
  function woDelSum(ids) { // what is in these orders: nets per step, nets on the rack (and in which box)
    var c = {}, nets = 0, racked = {}, nr = 0, made = 0, unknown = 0;
    ids.forEach(function (id) {
      var o = S.wo.orders[id]; if (!o) return;
      if (!o.nets) { nets += o.qty; nr += o.racked || 0; unknown += o.racked || 0; c['on the rack'] = (c['on the rack'] || 0) + (o.racked || 0); c.rejected = (c.rejected || 0) + (o.rejected || 0); made += (o.racked || 0) + (o.rejected || 0); return; }
      woNetList(o).forEach(function (x) {
        nets++;
        var k = x.st === 'racked' ? 'on the rack' : x.st === 'rejected' ? 'rejected' : x.step === 0 && x.st === 'wait' ? 'not started' : (x.st === 'recv' ? 'at ' : 'waiting for ') + WO_STEPS[x.step];
        c[k] = (c[k] || 0) + 1;
        if (x.st === 'racked') { nr++; var b = o.net + '|' + (x.box || FLOOR2); racked[b] = (racked[b] || 0) + 1; }
        if (x.step > 0 || x.st !== 'wait') made++;
      });
    });
    return { counts: c, nets: nets, racked: racked, nRacked: nr, started: made, unknown: unknown };
  }
  function woDelForm(ids, all) {
    var el = document.getElementById('woDel'); if (!el) return;
    var m = woDelSum(ids), order = ['not started'].concat(WO_STEPS.map(function (s) { return 'waiting for ' + s; }).reduce(function (a, k, i) { return a.concat([k, 'at ' + WO_STEPS[i]]); }, []), ['on the rack', 'rejected']);
    var lines = order.filter(function (k) { return m.counts[k]; }).map(function (k) { return '<li><b>' + m.counts[k] + '</b> ' + esc(k) + '</li>'; }).join('');
    var rk = Object.keys(m.racked).map(function (k) { var p = k.split('|'), n = BY_ID[p[0]]; return esc(n ? netLabel(n) : p[0]) + ': ' + m.racked[k] + ' in ' + esc(p[1] === FLOOR2 ? 'TOP (top of the racks)' : p[1]); }).join('<br>');
    el.innerHTML = '<div class="card wo-delc"><h3>' + (all ? 'Clear all work orders' : 'Delete ' + ids.length + ' work order' + (ids.length > 1 ? 's' : '')) + '</h3>' +
      '<div class="small">' + (ids.length > 8 ? esc(ids.slice().sort().slice(0, 3).join(', ')) + ' … ' + esc(ids.slice().sort().slice(-1)[0]) : esc(ids.slice().sort().join(', '))) + ' · <b>' + m.nets + ' nets</b></div>' +
      '<div class="small">Where the nets are now:</div><ul class="small wo-dellist">' + lines + '</ul>' +
      (m.started ? '<div class="note"><b>' + m.started + (m.started > 1 ? ' nets were' : ' net was') + ' already worked on.</b> Deleting removes them from the app: their labels stop working.</div>' : '<div class="small muted">No net has been worked on yet.</div>') +
      (m.nRacked ? '<label class="chk"><input type="checkbox" id="woDelStock" checked> Take the <b>' + m.nRacked + ' racked net' + (m.nRacked > 1 ? 's' : '') + '</b> off stock and off the box again' + (rk ? '<br><span class="small">' + rk + '</span>' : '') + '</label>' : '') +
      '<label class="chk"><input type="checkbox" id="woDelHist" checked> Also remove the step history and the people\'s numbers for ' + (ids.length > 1 ? 'these orders' : 'this order') + '</label>' +
      (all ? '<label class="chk"><input type="checkbox" id="woDelNo" checked> Start order numbers again at WOMQD001 (throw away all old labels first)</label>' : '') +
      '<label class="f">Why<select id="woDelWhy"><option value="">Pick a reason</option><option>Test orders</option><option>Made by mistake</option><option>Wrong size, colour or number</option><option>Order cancelled</option><option>Other</option></select></label>' +
      '<label class="f" id="woDelOtherL" hidden>Say why<input id="woDelOther" maxlength="100"></label>' +
      (all ? '<label class="f">Type DELETE to confirm<input id="woDelType" autocomplete="off" autocapitalize="characters"></label>' : '') +
      '<div class="row"><button type="button" class="btn danger" id="woDelGo">Yes, delete</button><button type="button" class="btn" id="woDelNoGo">Back</button></div><div class="small" id="woDelMsg"></div></div>';
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var why = document.getElementById('woDelWhy'), other = document.getElementById('woDelOtherL');
    why.onchange = function () { other.hidden = why.value !== 'Other'; };
    document.getElementById('woDelNoGo').onclick = function () { el.innerHTML = ''; };
    document.getElementById('woDelGo').onclick = function () {
      var msg = document.getElementById('woDelMsg'), r = why.value === 'Other' ? 'Other: ' + document.getElementById('woDelOther').value.trim() : why.value;
      if (!why.value || r === 'Other: ') { msg.textContent = 'Pick why first.'; return; }
      if (all && document.getElementById('woDelType').value.trim().toUpperCase() !== 'DELETE') { msg.textContent = 'Type DELETE to confirm.'; return; }
      var so = document.getElementById('woDelStock'), stockOff = !!(so && so.checked), hist = document.getElementById('woDelHist').checked, rs = document.getElementById('woDelNo');
      woDelete(ids, all, r, stockOff, hist, !!(rs && rs.checked), m);
      el.innerHTML = '';
    };
  }
  function woDelete(ids, all, reason, stockOff, hist, restart, m) {
    if (stockOff) Object.keys(m.racked).forEach(function (k) { var p = k.split('|'), q = Math.min(m.racked[k], onHand(p[0])); S.stock[p[0]] = onHand(p[0]) - q; shelfAdd(p[1], p[0], -m.racked[k], true); });
    ids.forEach(function (id) { delete S.wo.orders[id]; delete woView.tick[id]; });
    if (ids.indexOf(woView.open) >= 0) woView.open = null;
    var ev = { type: 'WODELETE', who: sess.emp, reason: reason, stockOff: stockOff, history: hist, note: 'Deleted ' + ids.length + ' work order(s), ' + m.nets + ' nets' + (m.nRacked ? (stockOff ? ', ' + m.nRacked + ' racked taken off stock' : ', racked kept in stock') : '') + ' · reason: ' + reason };
    if (all) { ev.all = true; ev.restart = restart; } else ev.orders = ids;
    addLog(ev); save();
    toast(ids.length + ' work order' + (ids.length > 1 ? 's' : '') + ' deleted.');
    viewOrders();
  }
  function woPrintMany(os) { var nodes = []; os.forEach(function (o) { woNetList(o).forEach(function (x) { nodes.push(woLabel(o, x)); }); }); if (nodes.length) printLabels(nodes, '50x25'); }
  function woRight(id, on) {
    var r = woState().rights; r.ids = (r.ids || []).filter(function (x) { return x !== id; }); if (on) r.ids.push(id);
    addLog({ type: 'WORIGHT', who: sess.emp, badge: id, on: on, note: (on ? 'Label printing today given to ' : 'Label printing today taken from ') + wname(id) }); save();
    toast(on ? wname(id) + ' can make orders and print labels today.' : wname(id) + ' can no longer print labels today.'); viewOrders();
  }
  function woDetail(scroll) {
    var el = document.getElementById('woDetail'), o = woState().orders[woView.open]; if (!el) return;
    if (!o) { el.hidden = true; return; }
    var n = BY_ID[o.net], mgr = can('Manager'), list = woNetList(o), people = S.workers.filter(function (w) { return w.active !== false; });
    var wait = [0, 0, 0, 0, 0, 0], recv = [0, 0, 0, 0, 0], passed = [0, 0, 0, 0, 0, 0];
    list.forEach(function (x) { if (x.st === 'wait' && x.step <= WO_RACK) wait[x.step]++; if (x.st === 'recv') recv[x.step]++; for (var k = 0; k < Math.min(x.step, 6); k++) passed[k]++; });
    var shown = woView.all ? list : list.slice(0, 100), old = Date.now() - 864e5;
    el.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center"><h3>' + esc(o.id) + ' · ' + esc(n ? netLabel(n) : o.net) + ' · ' + o.qty + ' nets</h3><div class="row"><button class="btn" id="woPrAll">Print all labels</button>' + (woDelOn() ? '<button class="btn" id="woDel1">Delete order</button>' : '') + '<button class="btn" id="woClose">Close</button></div></div>' +
      '<div class="small">Made ' + esc(woWhen(o.created)) + ' by ' + esc(o.by || '') + ' · due <b>' + esc(woDueText(o)) + '</b>' + (woLate(o) ? ' <span class="pill p-bad">Late</span>' : '') + (o.state === 'done' ? ' · finished ' + esc(woWhen(o.finished)) : '') + ' · ' + o.racked + ' on the rack' + (o.rejected ? ', ' + o.rejected + ' rejected' : '') + '</div>' +
      (mgr ? '<div class="row" style="align-items:flex-end"><label class="f">Due<input id="woDueE" type="datetime-local" value="' + woLocalInput(o.due) + '"></label><button class="btn" id="woDueS" type="button">Save due time</button></div>' : '') +
      (o.nets ? '<div class="tablewrap"><table class="wo-steps"><thead><tr><th>Step</th><th>Waiting</th><th>Received</th><th>Passed</th>' + (mgr ? '<th>Whole order at once</th>' : '') + '</tr></thead><tbody>' +
        WO_STEPS.map(function (s, k) {
          var b = mgr && k < WO_RACK ? (wait[k] ? '<button type="button" class="btn" data-wo-bulk="RECV" data-k="' + k + '">All ' + wait[k] + ' received</button> ' : '') + (recv[k] ? '<button type="button" class="btn" data-wo-bulk="DONE" data-k="' + k + '">All ' + recv[k] + ' done</button>' : '') : k === WO_RACK && mgr ? '<span class="small muted">each net with its box</span>' : '';
          return '<tr><td>' + esc(s) + '</td><td>' + (wait[k] || '') + '</td><td>' + (k < WO_RACK ? recv[k] || '' : '') + '</td><td>' + (passed[k] || '') + '</td>' + (mgr ? '<td>' + b + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (mgr ? '<div class="row" style="align-items:flex-end"><label class="f">Whole order done by<select id="woFor"><option value="">me (' + esc(wname(sess.emp)) + ')</option>' + people.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>'; }).join('') + '</select></label><span class="small muted">The nets count for this person.</span></div>' : '') +
        '<div class="tablewrap"><table class="wo-nets"><thead><tr><th>Net</th><th>Where it is now</th><th>Cut</th><th>Base</th><th>Sides</th><th>Finish</th><th>Pack</th><th></th></tr></thead><tbody>' +
        shown.map(function (x) {
          var stuck = (x.st === 'wait' || x.st === 'recv') && x.at && new Date(x.at).getTime() < old;
          return '<tr' + (x.st === 'rejected' ? ' class="bad-row"' : '') + '><td><code>' + esc(woCode(o, x)) + '</code>' + (x.rw ? ' <span class="pill p-warn">rework ' + x.rw + '</span>' : '') + '</td><td class="small">' + esc(woWhere(x)) + (stuck ? ' <span class="pill p-warn">over a day</span>' : '') + '</td>' +
            [0, 1, 2, 3, 4].map(function (k) { return '<td class="small">' + esc(x.db[k] ? wname(x.db[k]) : '') + '</td>'; }).join('') +
            '<td class="wo-act">' + (x.st !== 'racked' ? '<button type="button" class="linkbtn" data-wo-rp="' + x.no + '">Reprint</button>' : '') + (mgr && x.st !== 'racked' ? ' <button type="button" class="linkbtn" data-wo-fix="' + x.no + '">Change</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (list.length > shown.length ? '<button class="btn" id="woAll" type="button">Show all ' + list.length + ' nets</button>' : '') +
        '<div class="small muted">Reprint makes a new label (it ends in -R2, -R3 ...): the old label stops working. A net on the rack is stock now: fix it with Undo or OUT.</div>'
        : '<div class="small muted">Finished more than 3 days ago: the nets are in the Google Sheet (WO nets done, Production).</div>') + '<div id="woFix"></div>';
    el.hidden = false;
    if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('woClose').onclick = function () { woView.open = null; el.hidden = true; };
    var d1 = document.getElementById('woDel1'); if (d1) d1.onclick = function () { woDelForm([o.id], false); };
    document.getElementById('woPrAll').onclick = function () { if (!list.length) { toast('The nets of this order are no longer on this device.'); return; } woPrint(o, list.filter(function (x) { return x.st !== 'racked'; }).length ? list.filter(function (x) { return x.st !== 'racked'; }) : list); };
    var all = document.getElementById('woAll'); if (all) all.onclick = function () { woView.all = true; woDetail(false); };
    var ds = document.getElementById('woDueS'); if (ds) ds.onclick = function () { var v = document.getElementById('woDueE').value; o.due = v ? new Date(v).toISOString() : ''; addLog({ type: 'WODUE', who: sess.emp, order: o.id, due: o.due, net: o.net, note: 'Due ' + (o.due ? woWhen(o.due) : 'none') + ' · ' + o.id }); save(); toast('Due time saved.'); viewOrders(); };
    el.querySelectorAll('[data-wo-bulk]').forEach(function (b) { b.onclick = function () {
      var k = +b.dataset.k, act = b.dataset.woBulk, who = document.getElementById('woFor').value || sess.emp, hit = list.filter(function (x) { return x.step === k && x.st === (act === 'RECV' ? 'wait' : 'recv'); });
      if (!hit.length) return;
      hit.forEach(function (x) { woLocal(x, act, who, {}); }); woCount(o);
      addLog({ type: 'WOBULK', who: sess.emp, 'for': who, order: o.id, act: act, step: k, nos: hit.map(function (x) { return x.no; }), net: o.net, qty: hit.length, note: WO_STEPS[k] + ': ' + (act === 'RECV' ? 'received' : 'done') + ', ' + hit.length + ' nets of ' + o.id + ' for ' + wname(who) }); save();
      toast(WO_STEPS[k] + ': ' + hit.length + ' nets ' + (act === 'RECV' ? 'received' : 'done') + ' for ' + wname(who) + '.'); woDetail(false);
    }; });
    el.querySelectorAll('[data-wo-rp]').forEach(function (b) { b.onclick = function () {
      var x = o.nets[+b.dataset.woRp]; if (!x) return;
      x.label = (x.label || 1) + 1; addLog({ type: 'WOREPRINT', who: sess.emp, code: woBase(o, x.no), label: x.label, order: o.id, net: o.net, note: 'Label printed again: ' + woCode(o, x) }); save();
      woPrint(o, [x]); woDetail(false);
    }; });
    el.querySelectorAll('[data-wo-fix]').forEach(function (b) { b.onclick = function () { woFixForm(o, o.nets[+b.dataset.woFix]); }; });
  }
  function woFixForm(o, x) { // manager: put a net at any step (move back, fix a wrong scan, bring back a rejected net)
    var el = document.getElementById('woFix'); if (!el || !x) return;
    var opts = []; WO_STEPS.forEach(function (s, k) { opts.push([k + '|wait', 'Waiting for ' + s]); if (k < WO_RACK) opts.push([k + '|recv', 'Received at ' + s]); }); opts.push(['0|rejected', 'Rejected']);
    el.innerHTML = '<div class="card wo-fixc"><b>Change ' + esc(woCode(o, x)) + '</b> · now: ' + esc(woWhere(x)) + '<div class="row" style="align-items:flex-end"><label class="f">Put it at<select id="woFixTo">' + opts.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === x.step + '|' + x.st ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f" style="flex:1">Why<input id="woFixWhy" maxlength="80" placeholder="e.g. scanned the wrong net"></label><button class="btn primary" type="button" id="woFixGo">Save</button><button class="btn" type="button" id="woFixNo">Cancel</button></div></div>';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('woFixNo').onclick = function () { el.innerHTML = ''; };
    document.getElementById('woFixGo').onclick = function () {
      var v = document.getElementById('woFixTo').value.split('|'), why = document.getElementById('woFixWhy').value.trim(), k = +v[0], st = v[1];
      if (!why) { toast('Type why.'); return; }
      if (st !== 'rejected') { for (var i = k; i < 5; i++) x.db[i] = ''; x.step = k; } else x.note = why;
      x.st = st; x.by = sess.emp; x.at = now(); woCount(o);
      addLog({ type: 'WOSET', who: sess.emp, codes: [woBase(o, x.no)], step: k, status: st, reason: why, order: o.id, net: o.net, note: 'Changed ' + woBase(o, x.no) + ': ' + woWhere(x) + ' · reason: ' + why }); save();
      toast('Saved.'); woDetail(false);
    };
  }

  // ---- production numbers (managers and the owner): who did what, per step, per day; where nets pile up; orders on time ----
  function woDay(d) { return d.getFullYear() + '-' + woPad(d.getMonth() + 1, 2) + '-' + woPad(d.getDate(), 2); }
  function woDaysAgo(k) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - k); return woDay(d); }
  function woPile() { // nets waiting and received at each step, in the open orders
    var w = [0, 0, 0, 0, 0, 0], r = [0, 0, 0, 0, 0];
    woOpen().forEach(function (o) { woNetList(o).forEach(function (x) { if (x.st === 'wait' && x.step <= WO_RACK) w[x.step]++; if (x.st === 'recv') r[x.step]++; }); });
    return { w: w, r: r };
  }
  function woBoard() { // dashboard: where the nets are right now, and where they pile up
    var p = woPile(), tot = p.w.reduce(function (a, b) { return a + b; }, 0) + p.r.reduce(function (a, b) { return a + b; }, 0), max = Math.max.apply(null, WO_STEPS.map(function (s, k) { return p.w[k] + (p.r[k] || 0); }));
    return '<div class="card"><h3><a href="#production">Production now</a></h3>' + (tot ? '<div class="wo-board">' + WO_STEPS.map(function (s, k) {
      var q = p.w[k] + (p.r[k] || 0);
      return '<div class="wo-col' + (q && q === max ? ' pile' : '') + '"><div class="wo-cn">' + q + '</div><div class="wo-cs">' + esc(s) + '</div><div class="small">' + p.w[k] + ' waiting' + (k < WO_RACK ? ' · ' + p.r[k] + ' in work' : '') + '</div></div>';
    }).join('') + '</div><div class="small muted">The step with the most nets (marked) is where work piles up.</div>' : '<div class="small muted">No nets in production. Make a work order on the <a href="#orders">Work orders</a> page.</div>') + '</div>';
  }
  var prodView = { from: 0, to: 0 };
  function viewProduction() {
    var D = (woState().daily || []), periods = [['Today', 0, 0], ['Yesterday', 1, 1], ['Last 7 days', 6, 0], ['Last 30 days', 29, 0]];
    var from = woDaysAgo(prodView.from), to = woDaysAgo(prodView.to), rows = D.filter(function (r) { return r.day >= from && r.day <= to; });
    var ppl = {}, steps = WO_STEPS;
    rows.forEach(function (r) {
      var p = ppl[r.who] = ppl[r.who] || { name: r.name || wname(r.who), s: {}, rej: 0, rw: 0, days: {} };
      var s = p.s[r.step] = p.s[r.step] || { done: 0, min: 0, timed: 0 }; s.done += r.done; s.min += r.min; s.timed += r.timed; p.rej += r.rej; p.rw += r.rework;
      if (r.first && r.last) { var d = p.days[r.day] = p.days[r.day] || { a: r.first, b: r.last }; if (r.first < d.a) d.a = r.first; if (r.last > d.b) d.b = r.last; }
    });
    var pRows = Object.keys(ppl).sort(function (a, b) { return ppl[a].name < ppl[b].name ? -1 : 1; }).map(function (id) {
      var p = ppl[id], days = Object.keys(p.days), hrs = days.reduce(function (a, d) { return a + (new Date(p.days[d].b) - new Date(p.days[d].a)) / 36e5; }, 0);
      return '<tr><td>' + esc(p.name) + '</td>' + steps.map(function (s) { var x = p.s[s]; return '<td>' + (x && x.done ? '<b>' + x.done + '</b>' + (x.timed ? '<span class="small muted"> · ' + Math.round(x.min / x.timed) + ' min</span>' : '') : '') + '</td>'; }).join('') +
        '<td>' + (p.rej || '') + '</td><td>' + (p.rw || '') + '</td><td>' + days.length + '</td><td>' + hrs.toFixed(1) + '</td></tr>';
    }).join('');
    var perDay = {}; D.forEach(function (r) { if (r.day < woDaysAgo(13)) return; var d = perDay[r.day] = perDay[r.day] || {}; d[r.step] = (d[r.step] || 0) + r.done; });
    var dRows = Object.keys(perDay).sort().reverse().map(function (d) { return '<tr><td>' + esc(new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })) + '</td>' + steps.map(function (s) { return '<td>' + (perDay[d][s] || '') + '</td>'; }).join('') + '</tr>'; }).join('');
    var wk = function (a, b) { var t = 0; D.forEach(function (r) { if (r.day >= woDaysAgo(a) && r.day <= woDaysAgo(b) && r.step === 'Rack-in') t += r.done; }); return t; };
    var orders = Object.keys(woState().orders).map(function (k) { return S.wo.orders[k]; }), fin = orders.filter(function (o) { return o.state === 'done' && o.finished && Date.now() - new Date(o.finished) < 30 * 864e5; });
    var dueFin = fin.filter(function (o) { return o.due; }), onTime = dueFin.filter(function (o) { return o.finished <= o.due; }).length, lead = fin.length ? fin.reduce(function (a, o) { return a + (new Date(o.finished) - new Date(o.created)) / 36e5; }, 0) / fin.length : 0;
    var late = orders.filter(woLate), bySize = {};
    orders.forEach(function (o) { var n = BY_ID[o.net]; if (n && o.racked) bySize[n.size] = (bySize[n.size] || 0) + o.racked; });
    var p = woPile();
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Production</h2><div class="row" style="align-items:flex-end"><label class="f">Month<input id="prMonth" type="month" value="' + woDaysAgo(0).slice(0, 7) + '"></label><button class="btn" id="prDl" type="button">Download month (.xlsx)</button></div></div><div class="small" id="prMsg"></div>' +
      (sheetOn() && !woOn() ? '<div class="note">' + esc(OLD_SHEET) + 'there are no production numbers yet.</div>' : '') +
      '<div class="grid">' + kpi(woOpen().length, 'Open work orders', '') + kpi(late.length, 'Late orders', late.length ? 'bad' : 'ok') + kpi(dueFin.length ? Math.round(100 * onTime / dueFin.length) + '%' : '—', 'On time (finished, last 30 days)', '') +
      kpi(fin.length ? (lead < 48 ? lead.toFixed(1) + ' h' : (lead / 24).toFixed(1) + ' days') : '—', 'Label to rack, average', '') + kpi(wk(6, 0), 'On the rack, last 7 days', '') + kpi(wk(13, 7), 'On the rack, the 7 days before', '') + '</div>' +
      woBoard() +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h3>Who did what</h3><div class="row">' + periods.map(function (x) { return '<button type="button" class="btn' + (prodView.from === x[1] && prodView.to === x[2] ? ' primary' : '') + '" data-pr="' + x[1] + '|' + x[2] + '">' + x[0] + '</button>'; }).join('') + '</div></div>' +
      '<div class="small muted">Nets done at each step, with the average minutes from Received to Done. Rejects and rework: nets of this person that were rejected or sent back later. Hours: first to last scan of each day. Every size counts the same.</div>' +
      '<div class="tablewrap"><table><thead><tr><th>Name</th>' + steps.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '<th>Rejects</th><th>Rework</th><th>Days</th><th>Hours</th></tr></thead><tbody>' + (pRows || '<tr><td colspan="' + (steps.length + 5) + '" class="muted">No scans in this time.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="grid2"><div class="card"><h3>Nets done per day</h3><div class="tablewrap"><table><thead><tr><th>Day</th>' + steps.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr></thead><tbody>' + (dRows || '<tr><td colspan="7" class="muted">Nothing yet.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="card"><h3>Orders</h3>' + (late.length ? '<div class="small"><b>Late:</b> ' + late.map(function (o) { return '<a href="#orders" data-pr-o="' + esc(o.id) + '">' + esc(o.id) + '</a> (' + esc(BY_ID[o.net] ? netLabel(BY_ID[o.net]) : o.net) + ', due ' + esc(woWhen(o.due)) + ')'; }).join(', ') + '</div>' : '<div class="small">No late orders.</div>') +
      '<h3>On the rack by size</h3><div class="small">' + (Object.keys(bySize).sort().map(function (s) { return esc(s) + ': <b>' + bySize[s] + '</b>'; }).join(' · ') || 'Nothing yet.') + '</div>' +
      '<div class="small muted">From open orders and orders finished in the last 30 days.</div></div></div>');
    app.querySelectorAll('[data-pr]').forEach(function (b) { b.onclick = function () { var v = b.dataset.pr.split('|'); prodView.from = +v[0]; prodView.to = +v[1]; viewProduction(); }; });
    app.querySelectorAll('[data-pr-o]').forEach(function (a) { a.onclick = function () { woView.open = a.dataset.prO; woView.filter = 'open'; }; });
    document.getElementById('prDl').onclick = function () {
      var m = document.getElementById('prMonth').value, msg = document.getElementById('prMsg');
      if (!/^\d{4}-\d{2}$/.test(m)) { msg.textContent = 'Pick a month.'; return; }
      var go = function (daily) {
        var rows = [['Day', 'Employee', 'Name', 'Step', 'Received', 'Done', 'Average minutes', 'Rejects caused', 'Rework caused', 'First scan', 'Last scan']].concat(daily.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.name < b.name ? -1 : 1; }).map(function (r) {
          return [r.day, r.who, r.name, r.step, r.recv, r.done, r.timed ? Math.round(10 * r.min / r.timed) / 10 : '', r.rej, r.rework, r.first ? new Date(r.first).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '', r.last ? new Date(r.last).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''];
        }));
        var a = document.createElement('a'); a.href = URL.createObjectURL(xlsx(rows)); a.download = 'ArmorX-production-' + m + '.xlsx'; a.click(); msg.textContent = daily.length ? 'Downloaded ' + daily.length + ' rows.' : 'No production in ' + m + '.';
      };
      if (!sheetOn()) { go(D.filter(function (r) { return r.day.indexOf(m) === 0; })); return; }
      msg.textContent = 'Loading ' + m + '…';
      fetch(sheetUrl() + '?t=' + encodeURIComponent(S.auth.t) + '&prod=' + encodeURIComponent(m)).then(function (r) { return r.json(); }).then(function (d) { if (!d.ok) { msg.textContent = d.error || 'Could not load it.'; return; } go(d.daily || []); }).catch(function () { msg.textContent = 'No internet: try again when you are online.'; });
    };
  }

  // ---------- setup labels ----------
  function viewPrint() {
    var sides = window.SIDES || [];
    h('<h2>Setup labels</h2><div class="note">Print these once. Shelf labels (size and color big, box code small: one on the shelf edge, one on the front of the box) and badges are 50 × 25 mm. Batch labels and box tags (also 50 × 25 mm) print from <a href="#batches">Batches</a>. All barcodes are Code 128, which every USB scanner reads.</div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Cheat sheet</h3><button class="btn primary" id="pH">Print cheat sheet</button></div><div class="small muted">What every screen, button and number means, on one A4 page. More answers on the <a href="#help">Help</a> page.</div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Worker badges</h3><button class="btn primary" id="pW">Print all badges</button></div><details class="pv"><summary>Show preview</summary><div class="labels-preview" id="prevW"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Command sheet</h3><button class="btn primary" id="pC">Print commands</button></div><div class="small muted">Includes the TOP label (extra stock on top of the racks).</div><details class="pv"><summary>Show preview</summary><div class="labels-preview" id="prevC"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Side signs</h3><div class="row" style="align-items:flex-end"><label class="f">Which side<select id="sSide"><option value="">All ' + sides.length + ' sides</option>' + sides.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary" id="pSB">Big: 1 per A4 landscape</button><button class="btn" id="pS">Small: 3 per A4</button></div></div><div class="small muted">One sign at the end of each rack side: the side code and its size range. Big prints one sign on a whole A4 page, landscape. Small prints 3 per A4 page, portrait: cut along the borders. Laminate.</div><details class="pv"><summary>Show preview</summary><div class="signs-preview" id="prevS"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Rack layout sheet</h3><div class="row" style="align-items:flex-end"><label class="f">Which side<select id="rSide"><option value="">All ' + sides.length + ' sides</option>' + sides.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary" id="pR">Print layout</button></div></div><div class="small muted">A picture of each rack side with the size and color of every box, one A4 landscape page per side. Give it to whoever puts the boxes on the racks.</div><details class="pv"><summary>Show preview</summary><div class="rsheet-preview" id="prevR"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Shelf labels</h3><div class="row" style="align-items:flex-end"><label class="f">Side<select id="pSide">' + sides.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary" id="pL">Print this side</button></div></div><div class="small muted" id="cntL"></div><details class="pv"><summary>Show preview</summary><div class="labels-preview" id="prevL"></div></details></div>');
    S.workers.forEach(function (w) { document.getElementById('prevW').appendChild(badgeLabel(w)); });
    COMMANDS.forEach(function (c) { document.getElementById('prevC').appendChild(cmdLabel(c)); });
    document.getElementById('prevC').appendChild(floorLabel());
    sides.slice(0, 2).forEach(function (sd) { document.getElementById('prevS').appendChild(sideSign(sd)); });
    function pickSides(id) { var v = document.getElementById(id).value; return v ? [v] : sides; }
    document.getElementById('pS').onclick = function () { printLabels(pickSides('sSide').map(function (sd) { return sideSign(sd); }), 'A4P'); };
    document.getElementById('pSB').onclick = function () { printLabels(pickSides('sSide').map(function (sd) { return sideSign(sd, true); }), 'A4'); };
    function drawR() { var el = document.getElementById('prevR'); el.innerHTML = ''; el.appendChild(rackSheet(pickSides('rSide')[0])); }
    document.getElementById('rSide').onchange = drawR; drawR();
    document.getElementById('pR').onclick = function () { printLabels(pickSides('rSide').map(rackSheet), 'A4'); };
    function codesFor(side) { return Object.keys(BOXES).filter(function (k) { return k.indexOf(side + '-') === 0; }).sort(sideOrder); }
    function drawL() { var side = document.getElementById('pSide').value, codes = codesFor(side), el = document.getElementById('prevL'); el.innerHTML = ''; codes.slice(0, 12).forEach(function (c) { el.appendChild(boxLabel(c)); }); document.getElementById('cntL').textContent = codes.length + ' labels on side ' + side + (codes.length > 12 ? ' (showing the first 12)' : '') + '.'; }
    document.getElementById('pSide').onchange = drawL; drawL();
    document.getElementById('pH').onclick = function () { printLabels([cheatSheet()], 'A4P'); };
    document.getElementById('pW').onclick = function () { printLabels(S.workers.map(badgeLabel), '50x25'); };
    document.getElementById('pC').onclick = function () { printLabels(COMMANDS.map(cmdLabel).concat([floorLabel()]), '50x25'); };
    document.getElementById('pL').onclick = function () { printLabels(codesFor(document.getElementById('pSide').value).map(boxLabel), '50x25'); };
  }

  // ---------- help: type a question, matching answers show (built-in answers in data/help.js, no AI, nothing sent anywhere) ----------
  var HELP_STOP = ' a an the is are am do does did i me my we to of on for and or it this that what whats how why where when which can should who mean means meaning show shows tell about there here be with please ';
  var HELP_SYN = { take: 'out', remove: 'out', minus: 'out', put: 'in', add: 'in', store: 'in', mistake: 'undo', wrong: 'undo', delete: 'undo', capacity: 'room holds', space: 'room holds', full: 'room holds full', extra: 'top', above: 'top', colour: 'color', colours: 'colors', login: 'sign', password: 'pin', backup: 'backup snapshot', excel: 'excel xlsx', address: 'code', location: 'code', label: 'label print' };
  function helpWords(t) {
    return String(t || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/×/g, 'x').replace(/[^a-z0-9\-+ ]+/g, ' ').split(/\s+/).filter(function (w) { return w && HELP_STOP.indexOf(' ' + w + ' ') < 0; });
  }
  function helpSearch(text) {
    var qs = helpWords(text), all = [];
    qs.forEach(function (w) { all.push(w); if (HELP_SYN[w]) HELP_SYN[w].split(' ').forEach(function (x) { all.push(x); }); });
    if (!all.length) return [];
    return (window.HELP_QA || []).map(function (e) {
      var title = helpWords(e.q), head = helpWords(e.k + ' ' + e.t), body = helpWords(e.a), sc = 0, phrase = qs.join(' ');
      all.forEach(function (w) {
        var near = function (x) { return x === w || (w.length >= 3 && x.indexOf(w) === 0); };
        if (title.some(near)) sc += 4; else if (head.some(near)) sc += 2; else if (body.some(near)) sc += 1;
      });
      if (qs.length > 1 && title.join(' ').indexOf(phrase) >= 0) sc += 10; // the whole question matches this title
      return { e: e, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; }).slice(0, 8).map(function (x) { return x.e; });
  }
  function helpLive(text) { // answers made from the live data: a box code or a size typed in the search
    var out = [], t = String(text || '').toUpperCase().replace(/×/g, 'X');
    var m = /\b([A-N])\s*([LR])\s*-?\s*C\s*(\d)\s*-?\s*R\s*(\d)\b/.exec(t);
    if (m) {
      var code = m[1] + m[2] + '-C' + m[3] + '-R' + m[4], bx = BOXES[code];
      out.push({ q: 'Box ' + code, a: esc(locHint(code)) + '.<br>' + (bx ? netsAt(code).map(function (n) {
        return '<b>' + esc(netLabel(n)) + '</b> · ' + (bx.role === 'backup' ? 'BACKUP' : 'PICK') + ' box · in this box ' + (S.shelf[countKey(code, n.id)] ? counted(code, n.id) : '—') + ' · box holds ' + boxCap(code, n.id) + ' · on top of racks ' + counted(FLOOR2, n.id) + ' · total ' + onHand(n.id);
      }).join('<br>') : 'This box is not in use.') });
    }
    var z = /\b(\d{3})\s*[X*\s]\s*(\d{2,3})\b/.exec(t);
    if (z) {
      var size = z[1] + 'x' + z[2], col = /BLACK/.test(t) ? 'Black' : /BROWN/.test(t) ? 'Brown' : /GREY|GRAY/.test(t) ? 'Grey' : '';
      var nets = NETS.filter(function (n) { return n.size === size && (!col || n.color === col); });
      out.push({ q: 'Size ' + size + (col ? ' ' + col : ''), a: nets.length ? nets.map(function (n) {
        var hs = homeOf(n);
        return '<b>' + esc(netLabel(n)) + '</b> · box ' + hs.map(function (c) { return '<b>' + esc(c) + '</b> (' + counted(c, n.id) + ')'; }).join(', ') + ' · on top ' + counted(FLOOR2, n.id) + ' · total ' + onHand(n.id) + '<br><span class="small muted">' + esc(locHint(n.pick)) + '</span>';
      }).join('<br>') : 'No door net size ' + esc(size) + '. Check the size on the net.' });
    }
    return out;
  }
  function cheatSheet() { // printable cheat sheet, one A4 page, solid black
    var el = document.createElement('div'); el.className = 'cheat';
    el.innerHTML = '<h1>ArmorX Inventory · cheat sheet</h1><div class="ch-sub">Question not here? Open <b>Help</b> in the app and type it, or type a box code (AL-C5-R3) or a size (210 90).</div><div class="ch-cols">' +
      (window.HELP_SHEET || []).map(function (sec) { return '<section><h2>' + esc(sec.h) + '</h2><table>' + sec.rows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table></section>'; }).join('') + '</div>';
    return el;
  }
  function viewHelp() {
    var start = decodeURIComponent(((location.hash || '').split('?q=')[1] || '').replace(/\+/g, ' '));
    var topics = window.HELP_TOPICS || [];
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Help</h2><button class="btn" id="hPrint">Print cheat sheet</button></div>' +
      '<label class="f help-q">Type your question, a box code or a size<input id="hq" type="search" autocomplete="off" placeholder="e.g. room for 20, undo, AL-C5-R3, 210 90"></label>' +
      '<div class="help-chips">' + topics.map(function (t) { return '<button type="button" class="btn" data-ht="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
      '<div id="hOut"></div>');
    var inp = document.getElementById('hq'), outEl = document.getElementById('hOut');
    function item(e, open) { return '<details class="card help-a"' + (open ? ' open' : '') + '><summary>' + esc(e.q) + '</summary><div>' + e.a + '</div></details>'; }
    function draw(topic) {
      var v = inp.value.trim(), live = helpLive(v), hits = v ? helpSearch(v) : [];
      if (topic) { outEl.innerHTML = '<h3>' + esc(topic) + '</h3>' + (window.HELP_QA || []).filter(function (e) { return e.t === topic; }).map(function (e) { return item(e, false); }).join(''); return; }
      if (!v) { outEl.innerHTML = '<div class="small muted">Tap a topic above, or type a few words. Example: <b>not in a box</b>, <b>box full</b>, <b>undo</b>.</div>' + topics.map(function (t) { return '<h3>' + esc(t) + '</h3>' + (window.HELP_QA || []).filter(function (e) { return e.t === t; }).map(function (e) { return item(e, false); }).join(''); }).join(''); return; }
      outEl.innerHTML = live.map(function (e) { return item(e, true); }).join('') + hits.map(function (e, i) { return item(e, i < 2 && !live.length); }).join('') +
        (live.length || hits.length ? '' : '<div class="card small">No answer found for "' + esc(v) + '". Try fewer or other words, or tap a topic above. Still stuck? Ask your manager.</div>');
    }
    inp.oninput = function () { draw(); };
    app.querySelectorAll('[data-ht]').forEach(function (b) { b.onclick = function () { inp.value = ''; draw(b.dataset.ht); }; });
    document.getElementById('hPrint').onclick = function () { printLabels([cheatSheet()], 'A4P'); };
    inp.value = start; draw(); if (!TOUCH) inp.focus();
  }

  // ---------- log ----------
  function viewLog() {
    h('<div class="row" style="justify-content:space-between;align-items:center"><h2>Scan log</h2><button class="btn" id="csv">Export CSV</button></div><div class="tablewrap"><table><thead><tr><th>When</th><th>Type</th><th>Who</th><th>What</th><th>Qty</th><th>Box</th><th>Note</th></tr></thead><tbody>' + S.log.slice(0, 400).map(logRow).join('') + '</tbody></table></div>');
    document.getElementById('csv').onclick = function () {
      var rows = [['time', 'type', 'worker', 'batch', 'net', 'qty', 'box', 'note']].concat(S.log.map(function (e) { var n = BY_ID[e.net]; return [e.t, e.type, wname(e.who), e.wo || '', n ? netLabel(n) : (e.net || ''), e.qty, e.loc || '', e.note || '']; }));
      var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'armorx-scan-log.csv'; a.click();
      toast('If nothing downloads, open the app from your computer instead of the preview.');
    };
  }

  // ---------- settings (admin) ----------
  function viewSettings() {
    h('<h2>Settings</h2>' +
      '<div class="card"><h3>Google Sheet (shared data)</h3><div class="small muted">Every scan is saved in the ArmorX Google Sheet. People, levels and PINs are on the <a href="#people">People</a> page. Setup steps are in <code>google-sheet/SETUP.md</code>.</div>' +
      '<form id="gsForm" class="row" style="align-items:flex-end"><label class="f" style="flex:1 1 360px">Web app link (ends with /exec)<input id="gsUrl" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(S.settings.sheetUrl || ARMORX_SHEET.url) + '"></label>' +
      '<label class="f">This device<input id="gsStation" placeholder="e.g. Stitching PC" value="' + esc(S.settings.station || '') + '"></label>' +
      '<button class="btn primary">Save</button></form><div class="small" id="gsMsg">' + esc(syncText()) + '</div></div>' +
      '<div class="card"><h3>Data on this device</h3><div class="small muted">The Google Sheet is the master copy. A backup file is a copy of what this device has.</div><div class="row"><button class="btn" id="bk">Download backup</button></div></div>' +
      (can('Owner') ? '<div class="card" id="resetCard"><h3>Reset inventory to zero <span class="small muted">(owner only)</span></h3><div class="small">Sets every net to 0 and clears box records (empty / has nets), box recounts waiting for Apply and box numbers. ' +
        'A snapshot of all of it is saved first (Snapshots tab of the Google Sheet). The scan log and production batches are kept, with a "Reset" line, so history is never lost. ' +
        'Scans made before the reset on a phone that was offline are not saved, and older scans cannot be undone.</div>' +
        '<div class="row" style="align-items:flex-end"><label class="f">Why (optional)<input id="rsWhy" maxlength="60" placeholder="e.g. testing, opening count"></label><label class="f">Type RESET to confirm<input id="rsTxt" autocomplete="off" autocapitalize="characters"></label>' +
        '<button class="btn danger" id="rsGo">Reset to zero</button></div><div class="small" id="rsMsg"></div></div>' : '') +
      (can('Admin') && sheetOn() ? '<div class="card" id="snapCard"><h3>Snapshots and restore <span class="small muted">(admin)</span></h3><div class="small">The Google Sheet saves a copy of the inventory (stock, box numbers, box records, waiting counts) every evening, kept for ' + 30 + ' days, and before every reset or restore. ' +
        'Restore puts the inventory back to a copy. A copy of how it is now is saved first, and the scan log is kept.</div>' +
        ((S.snaps || []).length ? '<div class="row" style="align-items:flex-end"><label class="f">Copy<select id="snSel">' + S.snaps.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.id) + ' · ' + esc(fmtT(x.t)) + ' · ' + x.rows + ' rows</option>'; }).join('') + '</select></label><button class="btn" id="snPrev">Preview</button></div>'
          : '<div class="small muted">No copies yet' + ((S.sheetV || 0) < BOXQTY_V ? ' (needs the Google Sheet script version ' + BOXQTY_V + ')' : '') + '.</div>') + '<div class="small" id="snMsg"></div><div id="snOut"></div></div>' : ''));
    document.getElementById('gsForm').onsubmit = function (e) {
      e.preventDefault();
      var u = document.getElementById('gsUrl').value.trim();
      S.settings.station = document.getElementById('gsStation').value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) { document.getElementById('gsMsg').textContent = 'The link should start with https://script.google.com/macros/s/ and end with /exec.'; return; }
      S.settings.sheetUrl = u; save(); document.getElementById('gsMsg').textContent = 'Saved. Checking the sheet…';
      pull().then(function () { var m = document.getElementById('gsMsg'); if (m) m.textContent = syncText(); });
    };
    var sp = document.getElementById('snPrev'); if (sp) sp.onclick = function () { snapPreview(document.getElementById('snSel').value); };
    var rs = document.getElementById('rsGo'); if (rs) rs.onclick = function () { resetAll(document.getElementById('rsTxt').value, document.getElementById('rsWhy').value.trim(), document.getElementById('rsMsg')); };
    document.getElementById('bk').onclick = function () { var a = document.createElement('a'); var c = clone(S); delete c.auth; a.href = URL.createObjectURL(new Blob([JSON.stringify(c, null, 1)], { type: 'application/json' })); a.download = 'armorx-inventory-backup.json'; a.click(); };
  }

  // Owner only (Code.gs checks it too): every net to 0, box records, waiting counts and put aways cleared. Snapshot first (in the sheet).
  var RESET_V = 7;
  function resetAll(typed, why, msg) {
    if (!can('Owner')) { msg.textContent = 'Only the owner can reset the inventory.'; return; }
    if (String(typed).trim().toUpperCase() !== 'RESET') { msg.textContent = 'Type RESET in the box to confirm.'; return; }
    if (sheetOn() && (S.sheetV || 0) < RESET_V) { msg.textContent = 'The Google Sheet script is older than version ' + RESET_V + '. Paste the new google-sheet/Code.gs and deploy a new version first.'; return; }
    var total = NETS.reduce(function (a, n) { return a + onHand(n.id); }, 0);
    S.stock = {}; S.boxes = {}; S.counts = {}; S.shelf = {}; S.undo = null; S.lastUpload = null;
    var ev = addLog({ type: 'RESET', who: sess.emp || S.auth.id, reason: why, note: 'Inventory reset to zero (was ' + total + ' nets)' + (why ? ' · reason: ' + why : '') });
    S.resetAt = ev.t; save();
    msg.textContent = 'Done. Every net is 0 now (it was ' + total + ' nets in total). A snapshot is saved in the Snapshots tab.';
    document.getElementById('rsTxt').value = '';
    toast('Inventory reset to zero.');
  }

  // Restore (admin): preview what a copy holds, then put the inventory back to it. Code.gs saves a copy of now first.
  function snapPreview(id) {
    var msg = document.getElementById('snMsg'), out = document.getElementById('snOut'); msg.textContent = 'Loading ' + id + '…'; out.innerHTML = '';
    fetch(sheetUrl() + '?t=' + encodeURIComponent(S.auth.t) + '&snap=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { msg.textContent = d.error || 'Could not load the copy.'; return; }
      var diff = NETS.filter(function (n) { return (d.stock[n.id] || 0) !== onHand(n.id); });
      var tNow = NETS.reduce(function (a, n) { return a + onHand(n.id); }, 0), tThen = NETS.reduce(function (a, n) { return a + (d.stock[n.id] || 0); }, 0);
      msg.innerHTML = '<b>' + esc(id) + '</b>: ' + tThen + ' nets in total (now ' + tNow + '), ' + diff.length + ' nets with a different total, ' + d.shelf.length + ' box numbers, ' + d.boxes + ' box records, ' + d.counts + ' waiting counts.';
      out.innerHTML = (diff.length ? '<div class="tablewrap"><table><thead><tr><th>Net</th><th>Now</th><th>In the copy</th></tr></thead><tbody>' + diff.slice(0, 80).map(function (n) { return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td>' + onHand(n.id) + '</td><td><b>' + (d.stock[n.id] || 0) + '</b></td></tr>'; }).join('') + '</tbody></table></div>' + (diff.length > 80 ? '<div class="small muted">and ' + (diff.length - 80) + ' more</div>' : '') : '') +
        '<div class="row" style="align-items:flex-end"><label class="f">Type RESTORE to confirm<input id="snTxt" autocomplete="off" autocapitalize="characters"></label><button class="btn danger" id="snGo">Restore this copy</button></div>';
      document.getElementById('snGo').onclick = function () {
        if (document.getElementById('snTxt').value.trim().toUpperCase() !== 'RESTORE') { msg.textContent = 'Type RESTORE in the box to confirm.'; return; }
        S.stock = clone(d.stock); S.shelf = {}; d.shelf.forEach(function (c) { S.shelf[countKey(c.box, c.net)] = { box: c.box, net: c.net, qty: c.qty }; }); S.undo = null; S.lastUpload = null;
        var ev = addLog({ type: 'RESTORE', who: sess.emp || S.auth.id, snap: id, note: 'Inventory restored from ' + id + ' (was ' + tNow + ' nets, now ' + tThen + ')' });
        S.resetAt = ev.t; save(); out.innerHTML = ''; msg.textContent = 'Restored from ' + id + '. Box records and counts come back with the next sync.';
        toast('Inventory restored from ' + id + '.');
      };
    }).catch(function () { msg.textContent = 'Could not reach the Google Sheet.'; });
  }

  // ---------- people (admin): who can sign in, their level, PIN ----------
  var LEVEL_HELP = { Worker: 'IN, OUT, pick, undo own scan', Manager: '+ box recount, dashboard, stock, counts, pick list Final, batches, labels, scan log', Admin: '+ people, PINs, settings', Owner: '+ reset inventory to zero; only the owner can give or change the Owner level' };
  function viewPeople() {
    h('<h2>People</h2><div class="card"><div class="small muted">Everyone signs in with their employee number and their own 4-digit PIN. ' +
      'Levels: <b>Worker</b> ' + esc(LEVEL_HELP.Worker) + '. <b>Manager</b> ' + esc(LEVEL_HELP.Manager) + '. <b>Admin</b> ' + esc(LEVEL_HELP.Admin) + '. <b>Owner</b> ' + esc(LEVEL_HELP.Owner) + '. ' +
      'Someone left? Untick <b>Active</b>: they are signed out on every phone at once. A new PIN also signs that person out everywhere. ' +
      'You can do the same in the Workers tab of the Google Sheet (type the PIN in the New PIN column).</div>' +
      '<div class="tablewrap"><table><thead><tr><th>Badge</th><th>Name</th><th>Main step</th><th>Level</th><th>Active</th><th>PIN</th><th>Last sign-in</th></tr></thead><tbody id="pt"></tbody></table></div><div class="small" id="pMsg"></div></div>' +
      '<div class="card"><h3>Add a person</h3><form id="pAdd" class="row" style="align-items:flex-end"><label class="f">Employee number<input id="paId" placeholder="EMP-79" required></label><label class="f">Name<input id="paName" required></label>' +
      '<label class="f">Main step<input id="paRole" placeholder="e.g. Stitching"></label><label class="f">Level<select id="paLvl"><option>Worker</option><option>Manager</option><option>Admin</option></select></label>' +
      '<label class="f">PIN (4 digits)<input id="paPin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required></label><button class="btn primary">Add</button></form></div>');
    var msg = document.getElementById('pMsg');
    function draw() {
      var list = S.workers.slice().sort(function (a, b) { return (parseInt(String(a.id).slice(4), 10) || 0) - (parseInt(String(b.id).slice(4), 10) || 0); });
      document.getElementById('pt').innerHTML = list.map(function (w) {
        var id = esc(w.id);
        return '<tr' + (w.active === false ? ' class="muted"' : '') + '><td><code>' + id + '</code></td>' +
          '<td><input class="pin-in" data-id="' + id + '" data-f="name" value="' + esc(w.name) + '"></td>' +
          '<td><input class="pin-in" data-id="' + id + '" data-f="role" value="' + esc(w.role || '') + '"></td>' +
          '<td><select data-id="' + id + '" data-f="level">' + (can('Owner') || w.level === 'Owner' ? ['Worker', 'Manager', 'Admin', 'Owner'] : ['Worker', 'Manager', 'Admin']).map(function (l) { return '<option' + (w.level === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></td>' +
          '<td><input type="checkbox" data-id="' + id + '" data-f="active"' + (w.active === false ? '' : ' checked') + ' aria-label="Active"></td>' +
          '<td>' + (w.locked ? '<b>Locked</b> <button class="btn" data-unlock="' + id + '">Unlock</button> ' : '') + (w.pin ? 'set' : '<b>not set</b>') + ' <button class="btn" data-pin="' + id + '">New PIN</button></td>' +
          '<td class="muted small">' + (w.last ? fmtT(w.last) : 'never') + '</td></tr>';
      }).join('');
      app.querySelectorAll('#pt [data-f]').forEach(function (x) { x.onchange = function () {
        var o = { id: x.dataset.id }; o[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.value.trim(); send(o);
      }; });
      app.querySelectorAll('[data-unlock]').forEach(function (x) { x.onclick = function () { send({ id: x.dataset.unlock, unlock: true }); }; });
      app.querySelectorAll('[data-pin]').forEach(function (x) { x.onclick = function () {
        var td = x.parentNode; td.innerHTML = '<input class="pin-in" inputmode="numeric" maxlength="4" placeholder="4 digits" style="width:6em"> <button class="btn primary">Save</button>';
        var inp = td.querySelector('input'); inp.focus();
        td.querySelector('button').onclick = function () { if (!/^\d{4}$/.test(inp.value)) { toast('PIN must be 4 digits.'); return; } send({ id: x.dataset.pin, pin: inp.value }); };
      }; });
    }
    function send(person, done) {
      msg.textContent = 'Saving…';
      sheetCall({ action: 'admin', person: person }).then(function (d) {
        if (!d.ok) { msg.textContent = d.error || 'Not saved.'; toast(d.error || 'Not saved.'); pull().then(draw); return; }
        msg.textContent = 'Saved.'; toast('Saved.'); if (done) done(); pull().then(draw);
      }).catch(function () { msg.textContent = 'No internet: not saved. Try again.'; });
    }
    draw();
    if (sheetOn()) pull().then(function (c) { if (c && location.hash === '#people' && !userBusy()) draw(); }); // never wipe a PIN or name being typed
    document.getElementById('pAdd').onsubmit = function (e) {
      e.preventDefault();
      var pin = document.getElementById('paPin').value;
      if (!/^\d{4}$/.test(pin)) { toast('PIN must be 4 digits.'); return; }
      send({ id: document.getElementById('paId').value.trim(), name: document.getElementById('paName').value.trim(), role: document.getElementById('paRole').value.trim(), level: document.getElementById('paLvl').value, pin: pin },
        function () { document.getElementById('pAdd').reset(); });
    };
  }

  // ---------- sign-in ----------
  function signedIn() { return !!(S.auth && S.auth.t && Number(S.auth.exp) > Date.now()); }
  var RANK = { Worker: 0, Manager: 1, Admin: 2, Owner: 3 }; // Owner = everything an admin can do, plus reset to zero
  function can(need) { return signedIn() && (RANK[S.auth.level] || 0) >= (RANK[need] || 0); }
  function sheetUrl() { return (S.settings && S.settings.sheetUrl) || ARMORX_SHEET.url; }
  function sheetCall(body) {
    body.t = S.auth ? S.auth.t : '';
    return fetch(sheetUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function login(badge, pin) { // resolves with { ok, error } and signs this device in on success
    return fetch(sheetUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', badge: badge, pin: pin }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return { ok: false, error: /access key/i.test(d.error || '') ? 'The Google Sheet script is an older version. Ask the admin to paste the new google-sheet/Code.gs and deploy a new version.' : (d.error || 'Could not sign in.') };
        var url = sheetUrl();
        if (S.demo || !sheetOn()) { var keep = S.settings || {}, q = S.queue; S = blank(); S.workers = []; S.settings = keep; S.queue = q || []; }
        S.settings.sheetUrl = url; delete S.settings.sheetKey; S.demo = false;
        if (!S.settings.station) S.settings.station = TOUCH ? 'Phone' : 'Computer';
        S.auth = { t: d.token, exp: d.exp, id: d.me.id, name: d.me.name, level: d.me.level };
        if (!worker(d.me.id)) S.workers.push({ id: d.me.id, name: d.me.name, role: '' });
        S.settings.me = d.me.id; sess.emp = d.me.id; sess.mode = null; sess.await = null; S.undo = null;
        save();
        return pull().then(function () { return { ok: true }; });
      })
      .catch(function () { return { ok: false, error: 'No internet. Connect to Wi-Fi or mobile data and try again.' }; });
  }
  function signOut(why) {
    if (window.ArmorXCam) window.ArmorXCam.close();
    S.auth = null; S.settings.me = null; sess.emp = null; sess.mode = null; sess.await = null; S.undo = null; save();
    if (location.hash !== '#signin') history.replaceState(null, '', location.pathname + location.search + '#signin');
    route(); if (why) setTimeout(function () { var m = document.getElementById('siMsg'); if (m) m.textContent = why; }, 0);
  }
  function viewSignIn() {
    h('<div class="signin card"><h2>Sign in</h2><div class="small muted">ArmorX Inventory is for MB Ventures staff only.</div>' +
      '<form id="siForm" class="signin-f"><label class="f">Employee number<input id="siId" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="EMP-78 or 78" required></label>' +
      '<button type="button" class="btn" id="siCam">Scan my badge</button>' +
      '<label class="f">PIN<input id="siPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="4" pattern="\\d{4}" placeholder="4 digits" required></label>' +
      '<button class="btn primary" id="siGo">Sign in</button><div class="small" id="siMsg" role="status"></div></form>' +
      '<div class="small muted">This phone stays signed in for 30 days. No PIN yet, or locked out? Ask your manager.</div></div>');
    var id = document.getElementById('siId'), pin = document.getElementById('siPin'), m = document.getElementById('siMsg');
    if (S.settings && S.settings.lastBadge) { id.value = S.settings.lastBadge; pin.focus(); } else id.focus();
    id.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pin.focus(); } }); // USB scanner types the badge and presses Enter
    document.getElementById('siCam').onclick = function () { if (window.ArmorXCam) window.ArmorXCam.open(function (code) { if (/^EMP-\d+$/.test(code)) { id.value = code; window.ArmorXCam.close(); pin.focus(); } }); };
    document.getElementById('siForm').onsubmit = function (e) {
      e.preventDefault();
      if (!/^\d{4}$/.test(pin.value)) { m.textContent = 'The PIN is 4 digits.'; return; }
      var go = document.getElementById('siGo'); go.disabled = true; m.textContent = 'Checking…';
      login(id.value.trim(), pin.value).then(function (r) {
        go.disabled = false; pin.value = '';
        if (!r.ok) { m.textContent = r.error; pin.focus(); return; }
        S.settings.lastBadge = S.auth.id; save();
        toast('Hello ' + S.auth.name + '.');
        location.hash = TOUCH || !can('Manager') ? '#scan' : '#dashboard'; route();
      });
    };
  }
  function askSwitch(w) { // shared phone: another person scans their badge and types their own PIN
    var adj = document.getElementById('adjust'); if (!adj) return;
    if (!sheetOn()) { fb('Sign out first, then sign in as ' + esc(w.name) + '.', 'bad'); return; }
    if (window.ArmorXCam) window.ArmorXCam.close();
    fb('<b>' + esc(w.name) + '</b>, type your PIN to scan as you.', 'warn');
    adj.innerHTML = '<div class="qtyrow"><input id="swPin" type="password" inputmode="numeric" maxlength="4" placeholder="PIN" class="pin-in" style="width:7em;font-size:1.2rem"><button type="button" class="btn primary" id="swOk">Switch</button><button type="button" class="btn" id="swNo">Cancel</button></div>';
    var p = document.getElementById('swPin'); p.focus();
    function go(e) {
      if (e) e.stopPropagation();
      if (!/^\d{4}$/.test(p.value)) { toast('The PIN is 4 digits.'); return; }
      fb('Checking…', 'ok');
      login(w.id, p.value).then(function (r) { adj.innerHTML = ''; if (!r.ok) { fb(esc(r.error), 'bad'); return; } route(); fb('Hello ' + esc(S.auth.name) + '.', 'ok'); });
    }
    document.getElementById('swOk').onclick = go; p.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    p.onclick = function (e) { e.stopPropagation(); };
    document.getElementById('swNo').onclick = function (e) { e.stopPropagation(); adj.innerHTML = ''; fb('Still scanning as ' + esc(wname(sess.emp)) + '.', 'ok'); };
  }

  // ---------- Google Sheet sync ----------
  var syncState = { at: null, err: null, busy: false };
  function sheetOn() { return !!(S && S.settings && S.settings.sheetUrl); }
  function syncText() {
    if (!sheetOn()) return 'Not connected. Data stays in this browser.';
    var waiting = (S.queue || []).length;
    if (syncState.err) return 'Sheet not reachable (' + syncState.err + '). ' + waiting + ' scans waiting, they will be sent automatically.';
    return 'Connected. ' + (waiting ? waiting + ' scans waiting to send. ' : 'All scans saved. ') + (syncState.at ? 'Last update ' + new Date(syncState.at).toLocaleTimeString() + '.' : '');
  }
  function paintSync() {
    var pill = document.getElementById('demoPill'); if (!pill) return;
    if (!signedIn()) { pill.hidden = true; return; }
    if (sheetOn()) { pill.hidden = false; var w = (S.queue || []).length; pill.textContent = syncState.err ? 'SHEET OFFLINE · ' + w + ' waiting' : (w ? 'SAVING · ' + w + ' waiting' : 'SHEET · synced'); pill.style.background = syncState.err ? 'var(--bad)' : ''; pill.style.color = syncState.err ? '#fff' : ''; }
    else { pill.hidden = !S.demo; pill.textContent = 'DEMO · data stays in this browser'; pill.style.background = ''; pill.style.color = ''; }
  }
  function flush() {
    if (!sheetOn() || !signedIn() || syncState.busy || !(S.queue || []).length) { paintSync(); return Promise.resolve(); }
    syncState.busy = true;
    // Scans go with the sign-in of the person who made them; one group per call.
    var tok = S.queue[0]._t || (S.auth ? S.auth.t : '');
    var batch = S.queue.filter(function (ev) { return (ev._t || tok) === tok; }).slice(0, 50).map(function (ev) { var c = Object.assign({}, ev); delete c._t; return c; });
    // text/plain keeps this a "simple" request, so Google Apps Script accepts it without a proxy.
    return fetch(S.settings.sheetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ t: tok, station: S.settings.station || '', events: batch }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok && d.auth) {
          if (S.auth && tok !== S.auth.t) { // that person's sign-in ended: send their scans with the current sign-in, keeping their name in the note
            S.queue.forEach(function (ev) { if (ev._t === tok) { ev._t = S.auth.t; ev.note = (ev.note || '') + ' · scanned by ' + wname(ev.who); } }); save(); throw new Error('retry');
          }
          signOut('Your sign-in has ended. Please sign in again.'); throw new Error('signed out');
        }
        if (!d.ok) throw new Error(d.error || 'save failed');
        var ok = {}; (d.saved || []).forEach(function (id) { ok[id] = 1; });
        S.queue = S.queue.filter(function (ev) { return !ok[ev.id]; }); syncState.err = null; save();
        if ((d.refused || []).length) toast('Not saved: ' + d.refused.map(function (x) { return x.why; }).join(' '));
      })
      .catch(function (err) { syncState.err = err.message === 'retry' ? null : (err.message || 'offline'); })
      .then(function () { syncState.busy = false; paintSync(); if ((S.queue || []).length && !syncState.err && signedIn()) return flush(); });
  }
  function applyRemote(d) {
    S.stock = d.stock || {};
    S.batches = {};
    (d.batches || []).forEach(function (b) {
      var hist = [{ stage: 0, by: b.by || 'Manager', qty: b.qty, rej: 0, t: b.created }];
      (b.steps || []).forEach(function (st, i) { if (st.at) hist.push({ stage: i + 1, by: st.by, qty: b.good, rej: 0, t: st.at, loc: i === 5 ? b.loc : undefined }); });
      S.batches[b.id] = { id: b.id, net: b.net, qty: b.qty, good: b.good, stage: b.stage, created: b.created, by: b.by, history: hist, loc: b.loc };
    });
    var maxSeq = Object.keys(S.batches).reduce(function (a, k) { return Math.max(a, parseInt(k.slice(3), 10) || 0); }, 0);
    S.seq = Math.max(S.seq || 0, maxSeq);
    if ((d.workers || []).length) S.workers = d.workers;
    if (d.rates) Object.keys(d.rates).forEach(function (id) { if (BY_ID[id]) BY_ID[id].perDay = Number(d.rates[id]) || 0; });
    S.log = d.log || [];
    if (d.boxes && typeof d.boxes === 'object') { S.boxes = d.boxes; S.layout = window.LAYOUT_VERSION; }
    if (Array.isArray(d.shelf)) { S.shelf = {}; d.shelf.forEach(function (c) { if (c.box && c.net) S.shelf[countKey(c.box, c.net)] = { box: c.box, net: c.net, qty: Number(c.qty) || 0, at: c.at, by: c.by, parts: c.parts || undefined }; }); }
    S.resetAt = d.resetAt || S.resetAt || '';
    if (Array.isArray(d.snaps)) S.snaps = d.snaps;
    if (Array.isArray(d.picks)) { S.picks = {}; d.picks.forEach(function (x) { if (x.state === 'undone') return; var p = S.picks[x.list] = S.picks[x.list] || { id: x.list, no: Number(x.no) || 0, created: x.created, by: x.by, state: x.state, off: !x.keep, boxed: !!x.boxed, doneBy: x.doneBy || '', doneAt: x.doneAt || '', lines: {} }; p.lines[x.net] = { qty: Number(x.qty) || 0, picked: Number(x.picked) || 0, note: x.note || '', from: x.from || [] }; if (x.state !== 'done') p.state = 'open'; }); }
    S.outToday = d.outToday && typeof d.outToday === 'object' ? d.outToday : null; S.outAt = d.at || now();
    if (Array.isArray(d.counts)) { S.counts = {}; d.counts.forEach(function (c) { if (c.box && c.net) S.counts[countKey(c.box, c.net)] = { box: c.box, net: c.net, qty: Number(c.qty) || 0, at: c.at, by: c.by, parts: c.parts || undefined }; }); }
    if (d.wo) S.wo = woFromRemote(d.wo);
    S.sheetV = Number(d.v) || 0;
    if (d.me && S.auth && d.me.id === S.auth.id) { S.auth.name = d.me.name; S.auth.level = d.me.level; } // a level change by the admin shows at once
    syncState.at = d.at || now(); syncState.err = null;
  }
  function pull() {
    if (!sheetOn() || !signedIn() || syncState.busy) return Promise.resolve(false);
    return flush().then(function () {
      if ((S.queue || []).length || !signedIn()) return false; // never overwrite scans that are not saved yet
      return fetch(S.settings.sheetUrl + '?t=' + encodeURIComponent(S.auth.t))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok && d.auth) { signOut('Your sign-in has ended. Please sign in again.'); return false; }
          if (!d.ok) throw new Error(/access key/i.test(d.error || '') ? 'sheet script is older than version 5' : (d.error || 'read failed'));
          var lv = S.auth.level, lr = canOrders(); applyRemote(d); save(); if (S.auth.level !== lv || canOrders() !== lr) paintNav(); return true;
        })
        .catch(function (err) { syncState.err = err.message || 'offline'; return false; });
    }).then(function (changed) { paintSync(); return changed; });
  }
  // Is the person in the middle of something on this page? Then a background refresh must not redraw it:
  // a typed number, an open form, a preview or an open box would be lost (owner, 12 Nov 2026).
  function userBusy() {
    var a = document.activeElement;
    if (a && app.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.id !== 'scanIn') return true;
    var typed = Array.prototype.some.call(app.querySelectorAll('input, textarea'), function (i) {
      return i.type !== 'file' && i.type !== 'checkbox' && i.id !== 'scanIn' && i.id !== 'q' && i.id !== 'rq' && i.value !== i.defaultValue;
    });
    var picked = Array.prototype.some.call(app.querySelectorAll('select'), function (sel) { var o = sel.options[sel.selectedIndex]; return o && !o.defaultSelected && sel.selectedIndex !== 0; });
    return typed || picked || !!app.querySelector('#cntBar:not([hidden]), #bcApply, #xlPrev table, #snOut table, #boxInfo:not([hidden]), #pFinal button, [data-pin] + input, td > .pin-in');
  }
  // Pages that only show numbers are redrawn when new data comes in; the scan station and forms are never redrawn by it.
  var LIVE_PAGES = ['dashboard', 'stock', 'racks', 'refill', 'log', 'pick', 'production'];
  function refreshPage() {
    var k = (location.hash || '#dashboard').slice(1);
    if (LIVE_PAGES.indexOf(k) >= 0 && !userBusy()) route();
  }
  setInterval(function () { pull().then(function (changed) { if (changed) refreshPage(); }); }, 20000);

  // ---------- router ----------
  var VIEWS = { dashboard: viewDashboard, scan: viewScan, orders: viewOrders, production: viewProduction, batches: viewBatches, stock: viewStock, racks: viewRacks, refill: viewRefill, pick: viewPick, print: viewPrint, help: viewHelp, log: viewLog, people: viewPeople, settings: viewSettings };
  // Who sees which page. Floor work (scan, pick, refill, rack map) is open to everyone: staff rotate.
  var NEED = { dashboard: 'Manager', production: 'Manager', batches: 'Manager', stock: 'Manager', print: 'Manager', log: 'Manager', people: 'Admin', settings: 'Admin' };
  function paintNav() {
    var on = signedIn();
    document.getElementById('tabs').hidden = !on;
    document.querySelectorAll('#tabs a').forEach(function (a) { var k = a.getAttribute('href').slice(1); a.hidden = k === 'orders' ? !canOrders() : !can(NEED[k] || 'Worker'); }); // Work orders: managers, or label printing today
    var me = document.getElementById('meChip');
    if (me) { me.hidden = !on; if (on) { me.querySelector('.n').textContent = S.auth.name + (S.auth.level !== 'Worker' ? ' · ' + S.auth.level : ''); } }
  }
  function route() {
    document.removeEventListener('click', refocus); document.body.classList.remove('pop-on');
    paintNav();
    if (!signedIn()) { document.querySelectorAll('#tabs a').forEach(function (a) { a.classList.remove('on'); }); viewSignIn(); paintSync(); return; }
    var k = (location.hash || '').slice(1).split('?')[0]; // #help?q=words opens Help with a search
    if (!VIEWS[k] || !can(NEED[k] || 'Worker') || (k === 'orders' && !canOrders())) { k = can('Manager') && !TOUCH ? 'dashboard' : 'scan'; history.replaceState(null, '', location.pathname + location.search + '#' + k); }
    document.querySelectorAll('#tabs a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + k); });
    VIEWS[k]();
    paintSync();
  }
  window.addEventListener('hashchange', route);
  load();
  if (/^#setup=/.test(location.hash || '')) history.replaceState(null, '', location.pathname + location.search); // old setup links: the PIN sign-in replaces them
  if (S.settings && S.settings.sheetKey) { delete S.settings.sheetKey; save(); }
  document.getElementById('soBtn').onclick = function () { signOut(); };
  if (signedIn()) { sess.emp = S.auth.id; S.settings.me = S.auth.id; if (!worker(S.auth.id)) S.workers.push({ id: S.auth.id, name: S.auth.name, role: '' }); }
  if (!location.hash && TOUCH) history.replaceState(null, '', location.pathname + location.search + '#scan');
  route(); if (sheetOn() && signedIn()) pull().then(function (c) { if (c) refreshPage(); });
  window.ArmorX = { handle: handle, state: function () { return S; } };
})();
