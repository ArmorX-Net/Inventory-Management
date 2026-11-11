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
  // 11 Nov 2026 (owner): no R6 boxes for now. Extra stock sits on top of the racks (TOP) with no fixed places, so a pick box
  // without a backup refills straight from TOP. The 210x100 backups on R1-R5 (AR C1-C3) stay. data/doornets.js keeps the
  // planned R6 boxes; set USE_R6 to true to use them again.
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
  function boxLabel(code) {
    var bx = BOXES[code], list = netsAt(code), n = list[0], el = document.createElement('div'), bin = bx && bx.kind === 'bin', bk = bx && bx.role === 'backup';
    el.className = 'lbl lbl-loc' + (bk ? ' backup' : '');
    el.innerHTML = '<div class="stripe ' + esc(bin ? 'bins' : (n ? n.color : '')) + '"></div><div class="code">' + esc(code) + '</div>' +
      '<div class="sub"><span><b>' + esc(n ? n.size.replace('x', '×') : 'free') + '</b> ' + esc(bin ? 'BLACK | BROWN | GREY' : (n ? n.color.toUpperCase() : '')) + '</span><span class="role">' + (bk ? 'BACKUP' : 'PICK') + ' ' + (bx ? bx.cap : '') + '</span></div><svg class="bc"></svg>';
    barcode(el.querySelector('.bc'), code, null, '10mm');
    return el;
  }
  function floorLabel() {
    var el = document.createElement('div'); el.className = 'lbl lbl-cmd';
    el.innerHTML = '<div class="mono" style="font-size:6.5pt">ARMORX · LOCATION</div><div class="nm">TOP · extra stock on top of racks</div><svg class="bc"></svg><div class="mono" style="font-size:6.5pt;text-align:center">TOP</div>';
    barcode(el.querySelector('.bc'), FLOOR2, null, '10mm');
    return el;
  }
  function sideSign(side) { // rack side sign: big side code + size range, 3 per A4 page, cut and laminate
    var rg = (window.SIDE_RANGES || {})[side] || ['', ''], el = document.createElement('div'); el.className = 'sign';
    el.innerHTML = '<div class="sg-side' + (/R$/.test(side) ? ' r' : '') + '">' + esc(side) + '</div><div class="sg-body"><div class="sg-rng"><div>' + esc(rg[0].replace('x', '×')) + ' <span>to</span></div><div>' + esc(rg[1].replace('x', '×')) + '</div></div>' +
      (side === 'AR' ? '<div class="sg-star">★ 210×100: C1–C3, pick R3</div>' : '') + '</div>';
    return el;
  }
  function badgeLabel(w) {
    var el = document.createElement('div'); el.className = 'lbl lbl-badge';
    el.innerHTML = '<div class="sub mono" style="font-size:6.5pt">ARMORX · WORKER</div><div class="nm">' + esc(w.name) + '</div><div class="mono" style="font-size:6.5pt">' + esc(w.id) + ' · ' + esc(w.role) + '</div><svg class="bc"></svg>';
    barcode(el.querySelector('.bc'), w.id, null, '10mm');
    return el;
  }
  var COMMANDS = [['CMD-OUT', 'OUT · order pick'], ['CMD-FBA', 'OUT · FBA shipment'], ['CMD-RETURN', 'RETURN · back to stock'], ['CMD-DAMAGED', 'RETURN · damaged'], ['CMD-COUNT', 'COUNT · correct total'], ['CMD-SWAP', 'SWAP · backup down'], ['CMD-REFILL', 'REFILL · from 2F'], ['CMD-EMPTY', 'EMPTY · box ran out'], ['CMD-CANCEL', 'CANCEL · clear'], ['CMD-UNDO', 'UNDO · my last scan'], ['CMD-BOXCOUNT', 'BOX COUNT · count shelves'], ['QTY-1', 'Qty 1'], ['QTY-5', 'Qty 5'], ['QTY-10', 'Qty 10'], ['QTY-20', 'Qty 20'], ['QTY-25', 'Qty 25']];
  function cmdLabel(c) {
    var el = document.createElement('div'); el.className = 'lbl lbl-cmd';
    el.innerHTML = '<div class="mono" style="font-size:6.5pt">ARMORX · COMMAND</div><div class="nm">' + esc(c[1]) + '</div><svg class="bc"></svg><div class="mono" style="font-size:6.5pt;text-align:center">' + esc(c[0]) + '</div>';
    barcode(el.querySelector('.bc'), c[0], null, '10mm');
    return el;
  }
  function printLabels(nodes, size) {
    var area = document.getElementById('print-area'); area.innerHTML = '';
    nodes.forEach(function (n) { area.appendChild(n); });
    var st = document.getElementById('page-size');
    if (!st) { st = document.createElement('style'); st.id = 'page-size'; document.head.appendChild(st); }
    var dim = size === '50x25' ? '50.3mm 25.1mm' : size === 'A4' ? 'A4 landscape' : size === 'A4P' ? 'A4 portrait' : '100mm 50mm';
    st.textContent = '@page{size:' + dim + ';margin:' + (/^A4/.test(size) ? '10mm' : '0.25mm 0.25mm 0 0.25mm') + '}'; // 50x25: same page and margins as the ArmorX Word label template (2850 x 1425 twips)
    toast(/^A4/.test(size) ? 'Opening print dialog: normal printer, ' + dim + '.' : 'Opening print dialog: pick the thermal printer and paper ' + dim.replace(/ /, ' × ') + ', margins none.');
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
      (waiting ? (keys.length ? '<br>' : '') + '<b>' + waiting + '</b> box counts are waiting: they change stock only after <a href="#stock">Stock → Box count → Review and apply</a>.' : '') + '</div></div>';
  }
  function viewDashboard() {
    var total = 0, out = 0, low = 0;
    NETS.forEach(function (n) { var q = onHand(n.id); total += q; if (q <= 0) out++; else if (q <= n.refillAt) low++; });
    var open = Object.values(S.batches).filter(function (b) { return b.stage < 6; });
    var inProd = open.reduce(function (a, b) { return a + b.good; }, 0);
    var outToday = 0, inToday = 0;
    S.log.forEach(function (e) { if (!isToday(e.t) || isUndone(e)) return; if (e.type === 'OUT' || e.type === 'FBA') outToday += e.qty; if (e.type === 'IN' || e.type === 'RETURN') inToday += e.qty; });
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
    var perWorker = {};
    S.log.forEach(function (e) { if (!isToday(e.t) || e.type !== 'STAGE' || isUndone(e)) return; perWorker[e.who] = (perWorker[e.who] || 0) + e.qty; });
    var wRows = S.workers.map(function (w) { return '<tr><td>' + esc(w.name) + '</td><td class="muted">' + esc(w.role) + '</td><td>' + (perWorker[w.id] || 0) + '</td></tr>'; }).join('');
    h('<div class="row" style="justify-content:space-between;align-items:center"><h2>Today at a glance</h2><div class="row"><a class="btn primary" href="#batches">New batch label</a><a class="btn dark" href="#scan">Open scan station</a></div></div>' +
      '<div class="grid">' +
      kpi(total.toLocaleString(), 'Doornets on racks', '') + kpi(out, 'Nets out of stock', out ? 'bad' : 'ok') + kpi(low, 'Below refill level', low ? 'warn' : 'ok') +
      kpi(open.length + ' · ' + inProd, 'Batches · nets in production', '') + kpi(inToday, 'In today (rack-in + returns)', '') + kpi(outToday, 'Out today (orders + FBA)', '') + '</div>' +
      countCard() +
      '<div class="card"><h3>Production board</h3><div class="tablewrap" style="border:none"><div class="board">' + cols + '</div></div><div class="small muted">Each card is one batch label. It moves one column each time someone scans it.</div></div>' +
      '<div class="grid2"><div class="card"><h3>Needs attention</h3><div class="tablewrap"><table><thead><tr><th>Net</th><th>Rack</th><th>On hand</th><th>Sells/day</th><th></th><th></th></tr></thead><tbody>' + (lowRows || '<tr><td colspan="6" class="muted">Everything is above its refill level.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="card"><h3>Nets finished per person today</h3><div class="tablewrap"><table><thead><tr><th>Name</th><th>Step</th><th>Nets</th></tr></thead><tbody>' + wRows + '</tbody></table></div>' +
      '<h3>Last scans</h3><div class="tablewrap"><table><tbody>' + S.log.slice(0, 8).map(logRow).join('') + '</tbody></table></div></div></div>');
    app.querySelectorAll('[data-make]').forEach(function (b) { b.onclick = function () { location.hash = '#batches'; setTimeout(function () { prefill(b.dataset.make, b.dataset.qty); }, 30); }; });
    app.querySelectorAll('[data-wo]').forEach(function (d) { d.onclick = function () { showBatch(d.dataset.wo); }; });
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
      '<label class="f">Quantity<input id="fQty" type="number" min="1" max="500" value="100" style="width:110px"></label>' +
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
    h('<h2>Scan station</h2><div class="station"><div class="scanbox">' +
      '<div class="who">Scanning as <span class="name" id="who">—</span><span class="muted small" id="whoRole"></span></div>' +
      '<div class="small" style="color:#cfd6db">Not you? <a href="#" id="soLink" style="color:#fff">Sign out</a>, or scan your own badge and type your PIN.</div>' +
      '<div class="acts" id="acts"></div>' +
      '<button type="button" class="btn camBtn" id="camBtn">Scan with camera</button>' +
      '<div class="prompt" id="prompt"></div>' +
      '<input id="scanIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan here…" aria-label="Scan input">' +
      '<div class="feedback" id="fb" role="status">Ready.</div>' +
      '<div id="adjust"></div><div id="qbar"></div><div id="undoBar"></div>' +
      '<div class="small" style="color:#cfd6db">' + (TOUCH ? 'Tap <b>Scan with camera</b> and point at the label. You can also type a code and press Enter.' : 'Keep this box selected. The scanner types the code and presses Enter. You can also type a code and press Enter.') + '</div></div>' +
      '<details class="card"' + (TOUCH ? '' : ' open') + '><summary><h3 style="display:inline">Test without a scanner</h3></summary><div class="small muted">Tap a code to send it as if it were scanned.</div>' +
      '<div class="small"><b>1 · Worker badge</b></div><div class="sim" id="simW"></div>' +
      '<div class="small"><b>2 · Batch label</b></div><div class="sim" id="simB"></div>' +
      '<div class="small"><b>3 · Box label</b> (for rack-in and picking)</div><div class="sim" id="simL"></div>' +
      '<div class="small"><b>Commands</b></div><div class="sim" id="simC"></div>' +
      '<h3 style="margin-top:6px">How a batch moves</h3><ol class="small" style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px">' +
      '<li>You are signed in, so your name goes on every scan. Sharing a phone? Scan your <b>badge</b> and type your PIN.</li>' +
      '<li>Scan the <b>batch label</b>. The batch moves to the next step: Cut → Base → Sides → Finish → Pack, and your name is saved on that step.</li>' +
      '<li>If some nets were rejected, type the good count and press Enter (within the next scan).</li>' +
      '<li>After Pack, scan the batch, then <b>TOP</b> (top of racks) or an <b>empty</b> box on the rack. Stock goes up.</li>' +
      '<li>To pick: scan <b>OUT</b>, then the <b>pick box</b> (3-bin box: tap the color), then the quantity.</li>' +
      '<li>Pick box empty: scan <b>EMPTY</b>, then the box. It goes on the refill list. (210×100 only: scan <b>SWAP</b> and the backup box you bring over.)</li>' +
      '<li>Every 3–4 days: open <a href="#refill">Refill list</a>, fill each empty box from the oldest batch on top of the racks, scan <b>REFILL</b> and the box.</li>' +
      '<li>Made a mistake? Tap <b>Undo my last scan</b> (or scan <b>UNDO</b>) within ' + UNDO_MIN + ' minutes and pick why.</li>' +
      '<li>Putting nets on the racks (opening count): tap <b>Put away nets</b>, type the size (e.g. 210 90), tap the color. The app shows the box in big letters. Put the nets in and tap how many. It adds up, so come back with more any time.</li>' +
      '<li>Opening count or day 14 count: tap <b>Count boxes</b>, scan each shelf label and type how many are in that box (3-bin box: one number per color). Scan <b>TOP</b> for the top of the racks. The manager applies the counts from <a href="#stock">Stock</a>.</li></ol></details></div>');
    var inp = document.getElementById('scanIn');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = inp.value; inp.value = ''; handle(v); } });
    if (!TOUCH) document.addEventListener('click', refocus);
    document.getElementById('soLink').onclick = function (e) { e.preventDefault(); e.stopPropagation(); signOut(); };
    document.getElementById('camBtn').onclick = function () { if (window.ArmorXCam) window.ArmorXCam.open(handle); };
    document.getElementById('acts').onclick = function (e) { var b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation(); var a = b.dataset.act;
      if (a === 'CANCEL' || a === sess.mode) handle('CMD-CANCEL'); else handle('CMD-' + a); if (!TOUCH) refocus(); };
    document.getElementById('qbar').onclick = function (e) { var b = e.target.closest('[data-q]'); if (!b) return; e.stopPropagation(); handle(b.dataset.q); if (!TOUCH) refocus(); };
    document.getElementById('undoBar').onclick = function (e) { var b = e.target.closest('[data-undo]'); if (!b) return; e.stopPropagation(); handle('CMD-UNDO'); if (!TOUCH) refocus(); };
    function sim(id, codes) { var el = document.getElementById(id); el.innerHTML = codes.map(function (c) { return '<button type="button" data-c="' + esc(c[0]) + '" title="' + esc(c[1] || '') + '">' + esc(c[0]) + (c[1] ? ' · ' + esc(c[1]) : '') + '</button>'; }).join(''); }
    sim('simW', S.workers.map(function (w) { return [w.id, w.name.replace(' (sample)', '')]; }));
    sim('simB', Object.values(S.batches).filter(function (b) { return b.stage < 6; }).slice(-6).map(function (b) { return [b.id, SHORT[b.stage + 1] + ' next']; }));
    var picks = ['DN-210x100-BK', 'DN-210x100-GR', 'DN-200x100-BK', 'DN-250x150-GR', 'DN-210x95-BR', 'DN-205x90-GR', 'DN-210x100-BR'].map(function (id) { return [BY_ID[id].pick, BY_ID[id].size + ' ' + BY_ID[id].color]; }).concat([[FLOOR2, 'top of racks']]);
    sim('simL', picks);
    sim('simC', [['CMD-OUT'], ['CMD-FBA'], ['CMD-SWAP'], ['CMD-REFILL'], ['CMD-EMPTY'], ['CMD-RETURN']].concat(can('Manager') ? [['CMD-COUNT']] : []).concat([['CMD-BOXCOUNT'], ['CMD-UNDO'], ['CMD-CANCEL'], ['QTY-1'], ['QTY-5'], ['QTY-20']]));
    app.querySelectorAll('.sim button').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); handle(b.dataset.c); if (!TOUCH) refocus(); }; });
    paint(); if (!TOUCH) inp.focus();
  }
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
      else if (sess.await === 'pasize') p = 'Put away: what net is in your hand?';
      else if (sess.await === 'paqty') p = 'Put the nets in the box below, then tap how many';
      else if (sess.await === 'bcqty' && sess.bc) p = 'How many ' + esc(netLabel(sess.net)) + ' ' + esc(sess.bc.loc === FLOOR2 ? 'on top of the racks' : 'in ' + sess.bc.loc) + '? <span class="small">' + (sess.bc.nets.length > 1 ? 'Count only the ' + esc(sess.net.color) + ' bin · ' : '') + 'type the number (0 if none)</span>';
      else if (sess.await === 'qty') p = esc({ OUT: 'How many going out?', FBA: 'How many for FBA?', RETURN: 'How many returned?', DAMAGED: 'How many damaged?', COUNT: 'How many in total, racks plus top of racks?' }[sess.mode]) + ' <span class="small">' + esc(netLabel(sess.net)) + ' · type a number or scan QTY</span>';
      else if (sess.mode) p = esc(sess.mode + ' mode · ' + MODE_HELP[sess.mode]);
      else p = 'Scan a box label or a batch label';
    }
    document.getElementById('prompt').innerHTML = p;
    var acts = document.getElementById('acts');
    if (acts) acts.innerHTML = sess.emp ? '<div class="acts-h">' + (sess.mode ? 'Doing: <b>' + esc(ACTS[sess.mode]) + '</b> · tap again to stop' : 'What are you doing? Tap one, or just scan a box and the app will ask') + '</div><div class="acts-g">' +
      actList().map(function (a) { return '<button type="button" class="act' + (sess.mode === a ? ' on' : '') + '" data-act="' + a + '">' + esc(ACTS[a]) + '</button>'; }).join('') + '</div>' : '';
    var qb = document.getElementById('qbar');
    if (qb) qb.innerHTML = sess.await === 'qty' ? '<div class="qbtns">' + [1, 2, 3, 4, 5, 10, 20].map(function (q) { return '<button type="button" class="act" data-q="' + q + '">' + q + '</button>'; }).join('') + '<button type="button" class="act ghost" data-q="CMD-CANCEL">Cancel</button></div><div class="small" style="color:#cfd6db">Other number: type it in the box above and press Enter.</div>'
      : sess.await === 'bcqty' ? '<div class="qbtns">' + boxQtyButtons().map(function (q) { return '<button type="button" class="act" data-q="' + q[0] + '">' + esc(q[1]) + '</button>'; }).join('') + '<button type="button" class="act ghost" data-q="CMD-CANCEL">Cancel</button></div><div class="small" style="color:#cfd6db">Other number: type it in the box above and press Enter.</div>' : '';
    var ub = document.getElementById('undoBar'), u = undoState();
    if (ub) ub.innerHTML = u && !/reason$/.test(sess.await || '') ? '<button type="button" class="act ghost undo" data-undo="1">Undo my last scan: ' + esc(u.what) + '</button>' : '';
  }
  function boxQtyButtons() { // box count: 0 = empty, the box's full number, and a few common numbers
    var bc = sess.bc, bx = BOXES[bc.loc], n = sess.net, full = bx ? (bx.mix ? bx.mix[n.id] : bx.cap) : 0;
    var list = [[0, '0 · empty']];
    [1, 2, 3, 5, 10].forEach(function (q) { if (q !== full) list.push([q, String(q)]); });
    if (full) list.push([full, full + ' · full']);
    return list;
  }
  var ACTS = { OUT: 'Pick for order', FBA: 'FBA shipment', SWAP: 'Swap backup down', REFILL: 'Refill box', EMPTY: 'Box is empty', RETURN: 'Customer return', DAMAGED: 'Return, damaged', COUNT: 'Count', BOXCOUNT: 'Count boxes', PUTAWAY: 'Put away nets' };
  var ACT_ORDER = ['OUT', 'SWAP', 'REFILL', 'EMPTY', 'FBA', 'RETURN', 'DAMAGED', 'COUNT', 'PUTAWAY', 'BOXCOUNT'];
  function actList() { return ACT_ORDER.filter(function (a) { return a !== 'COUNT' || can('Manager'); }); } // COUNT sets stock: managers only
  function boxActions(code, box, list) { // scan first, choose after: the actions that make sense for this box
    if (code === FLOOR2 || !box) return ['OUT', 'FBA', 'RETURN', 'COUNT'];
    var empty = isEmpty(code), n = list[0];
    if (box.role === 'backup') return empty ? ['REFILL', 'COUNT'] : ['SWAP', 'EMPTY', 'FBA', 'COUNT'];
    if (box.kind === 'bin') return ['OUT', 'REFILL', 'EMPTY', 'FBA', 'RETURN', 'DAMAGED', 'COUNT'];
    if (empty) return [(n.backups || []).length ? 'SWAP' : 'REFILL', (n.backups || []).length ? 'REFILL' : null, 'RETURN', 'COUNT'].filter(Boolean);
    return ['OUT', 'EMPTY', (n.backups || []).length ? 'SWAP' : 'REFILL', 'FBA', 'RETURN', 'DAMAGED', 'COUNT'];
  }
  function askAction(code, box, list, r) {
    var adj = document.getElementById('adjust'); if (!adj) return;
    if (window.ArmorXCam) window.ArmorXCam.close();
    var info = list.length > 1 ? list[0].size + ' (3 bins)' : netLabel(list[0]);
    fb('<code>' + esc(code) + '</code> · ' + (box.role === 'pick' ? 'PICK box' : 'BACKUP box') + ' · ' + esc(info) + (list.length === 1 ? ' · ' + onHand(list[0].id) + ' in total' : '') + (r ? ' · ' + (r.state === 'empty' ? '<b>marked empty</b>' : 'made ' + esc(fmtD(r.made))) : '') + '. <b>What are you doing?</b>', 'ok');
    adj.innerHTML = '<div class="acts-g">' + boxActions(code, box, list).filter(function (a) { return actList().indexOf(a) >= 0; }).map(function (a, i) { return '<button type="button" class="act' + (i === 0 ? ' on' : '') + '" data-do="' + a + '">' + esc(ACTS[a]) + '</button>'; }).join('') + '</div>';
    adj.querySelectorAll('[data-do]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); adj.innerHTML = ''; handle('CMD-' + b.dataset.do); scanBox(code); if (!TOUCH) refocus(); }; });
  }
  function handle(raw) {
    var code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    var adj = document.getElementById('adjust'); if (adj && !/^\d+$/.test(code)) adj.innerHTML = '';
    if (code === '2F') code = FLOOR2; // labels printed before 11 Nov 2026
    if (/^EMP-\d+$/.test(code)) {
      var w = worker(code); if (!w) { fb('Unknown badge <b>' + esc(code) + '</b>. Ask the admin to add it on the People page.', 'bad'); return; }
      if (code === sess.emp) { sess.mode = null; sess.await = null; fb('Hello ' + esc(w.name) + '.', 'ok'); paint(); return; }
      askSwitch(w); return; // someone else's badge: they type their own PIN, so nobody can scan in another person's name
    }
    if (code === 'CMD-CANCEL') { sess.mode = null; sess.await = null; sess.wo = null; sess.net = null; sess.bc = null; fb('Cleared.', 'ok'); paint(); return; }
    if (!sess.emp) { fb('Scan your worker badge first, so the system knows who did this.', 'bad'); return; }
    if (code === 'CMD-UNDO') { startUndo(); return; }
    var m = /^CMD-(OUT|FBA|RETURN|DAMAGED|COUNT|SWAP|REFILL|EMPTY|BOXCOUNT|PUTAWAY)$/.exec(code);
    if (m && m[1] === 'COUNT' && !can('Manager')) { fb('Only a manager can change a count. To count boxes, tap <b>Count boxes</b>.', 'bad'); return; }
    if (m && m[1] === 'PUTAWAY' && sheetOn() && (S.sheetV || 0) < PA_V) { fb(OLD_SHEET + 'use Count boxes.', 'bad'); return; }
    if (m && m[1] === 'PUTAWAY') { sess.mode = 'PUTAWAY'; sess.wo = null; sess.bc = null; fb('<b>Put away.</b> Type the size of the net in your hand, tap the color, and the app shows the box.', 'ok'); paStart(); return; }
    if (m && m[1] === 'BOXCOUNT' && !sheetNew()) { fb(OLD_SHEET + 'use the count sheet on the Stock page.', 'bad'); return; }
    if (m) { sess.mode = m[1]; sess.await = null; sess.wo = null; sess.bc = null; fb(esc(m[1] === 'BOXCOUNT' ? 'BOX COUNT' : m[1]) + ' mode on. ' + esc(MODE_HELP[m[1]]) + (m[1] === 'BOXCOUNT' ? ' ' + countProgressText() : ''), 'ok'); paint(); return; }
    if (/reason$/.test(sess.await || '')) { fb('Tap a reason first, or scan CANCEL.', 'bad'); return; }
    var q = /^QTY-(\d+)$/.exec(code) || (/^\d+$/.test(code) ? [code, code] : null);
    if (q) { applyQty(parseInt(q[1], 10)); return; }
    if (/^WO-\d+$/.test(code)) { scanBatch(code); return; }
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
  var MODE_HELP = { OUT: 'scan the PICK box', FBA: 'scan a box label or TOP', RETURN: 'scan the PICK box', DAMAGED: 'scan the PICK box', COUNT: 'scan any box of the net', BOXCOUNT: 'scan a shelf label (or TOP), then type how many nets are in that box.', PUTAWAY: 'type the size of the net in your hand, tap the color, put the nets where the app says.',
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
    if (sess.mode === 'PUTAWAY') { paScan(code, box, list); return; }
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
    if (sess.mode === 'PUTAWAY') { if (sess.await === 'paqty') paAdd(q, false); else { fb('First type the size of the net in your hand, in the size box below.', 'warn'); paDraw(); } return; }
    if (sess.await !== 'qty' || !sess.net) {
      var adjG = document.getElementById('adjGood');
      if (adjG) { adjG.value = q; document.getElementById('adjSave').click(); return; }
      fb('A quantity needs a box first. Scan OUT, FBA, RETURN or COUNT, then a box label.', 'bad'); return;
    }
    var n = sess.net, before = onHand(n.id), mode = sess.mode;
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

  // ---------- undo my last scan, reasons for count changes ----------
  var UNDO_MIN = 15; // a worker can undo their own last scan on this device for 15 minutes
  var UNDO_REASONS = ['Wrong box', 'Wrong number', 'Wrong net or color', 'Scanned twice', 'Other'];
  var COUNT_REASONS = ['Opening count', 'Full count (day 14)', 'Picked without scanning', 'Found extra nets', 'Damaged, thrown out', 'Counted wrong before', 'Other'];
  var SHEET_V = 4; // Code.gs version that understands UNDO and box counts
  var OLD_SHEET = 'The Google Sheet script is an older version. Ask the manager to paste the new google-sheet/Code.gs and deploy a new version. Until then, ';
  function sheetNew() { return !sheetOn() || (S.sheetV || 0) >= SHEET_V; }
  function clone(o) { return o == null ? null : JSON.parse(JSON.stringify(o)); }
  function snapBoxes(codes) { var o = {}; codes.forEach(function (c) { o[c] = clone(S.boxes[c] || null); }); return o; }
  function boxSig(r) { return r ? (r.state || 'full') + '|' + (r.made || '') : 'none'; }
  function undoWhat(ev) {
    var n = BY_ID[ev.net];
    return [ev.type === 'STAGE' ? ev.note : ev.type === 'BOXCOUNT' ? 'Box count' : ev.type === 'BOXADD' ? 'Put away +' + ev.qty : ev.type === 'BOXQTY' ? 'Box change ' + ev.was + ' → ' + ev.qty : ev.type, ev.qty != null && ev.type !== 'STAGE' && ev.type !== 'BOXADD' && ev.type !== 'BOXQTY' ? ev.qty : '', n ? netLabel(n) : '', ev.wo || '', ev.loc ? (ev.loc === FLOOR2 ? 'top of racks' : ev.loc) : ''].filter(function (x) { return x !== ''; }).join(' · ');
  }
  // r = what to put back: { stock: { net: change }, batch: { wo, prev }, boxes: { code: record before }, counts: { key: record before } }
  function remember(ev, r) {
    var u = { id: ev.id, type: ev.type, t: ev.t, who: ev.who, what: undoWhat(ev), stock: r.stock || {}, batch: null, boxes: {}, counts: {}, countAdd: r.countAdd || {}, putAdd: r.putAdd || {} };
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
  function resumeMode() { // after an undo or a cancelled undo, put away carries on where it was
    if (sess.mode !== 'PUTAWAY') return;
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
    S.log.forEach(function (e) { if (e.id === u.id && !isUndone(e)) { e.undone = true; e.note = (e.note || '') + ' · UNDONE'; } });
    S.undo = null; addLog(ev); save();
    var n = ev.net && BY_ID[ev.net];
    fb('<b>Undone:</b> ' + esc(u.what) + '. Reason saved: ' + esc(reason) + '.' + (n ? ' ' + esc(netLabel(n)) + ' is ' + onHand(n.id) + ' in total.' : ''), 'ok');
    paint(); resumeMode();
  }

  // ---------- box count (opening count, day 14 full count): scan the shelf, type the number ----------
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
    var a = Math.max(-Number(r.qty), d); r.qty = Number(r.qty) + a; r.at = now(); r.by = sess.emp;
    return { key: k, add: a, drop: false };
  }
  function sheetV8() { return !sheetOn() || (S.sheetV || 0) >= BOXQTY_V; }
  function boxTotal(c) { return (BOXES[c] ? BOXES[c].nets : []).reduce(function (a, id) { return a + counted(c, id); }, 0); }
  function boxKnown(c) { return (BOXES[c] ? BOXES[c].nets : []).some(function (id) { return !!S.shelf[countKey(c, id)]; }); }
  function inBoxes(id) { var n = BY_ID[id]; return homeOf(n).reduce(function (a, c) { return a + counted(c, id); }, 0); }
  // A manager sets the number in one box (or TOP): stock moves by the difference. Also used row by row by the Excel upload.
  var BOXQTY_V = 8;
  function setBoxQty(loc, id, q, reason, upload) {
    var n = BY_ID[id], k = countKey(loc, id), was = counted(loc, id), d = q - was, prev = !!S.shelf[k];
    var own = loc !== FLOOR2 && BOXES[loc] && BOXES[loc].kind === 'own', pbx = loc !== FLOOR2 ? snapBoxes([loc]) : {};
    S.shelf[k] = { box: loc, net: id, qty: q, at: now(), by: sess.emp };
    S.stock[id] = Math.max(0, onHand(id) + d);
    var state = '';
    if (loc !== FLOOR2) { var tot = boxTotal(loc); if (tot === 0 && !isEmpty(loc)) state = 'empty'; else if (tot > 0 && isEmpty(loc)) state = 'full'; }
    if (state) setBox(loc, state === 'empty' ? { state: 'empty' } : { state: 'full', net: own ? id : '', wo: '', made: null });
    var ev = addLog({ type: 'BOXQTY', who: sess.emp, net: id, qty: q, was: was, loc: loc, reason: reason, upload: upload || '', boxState: state, boxNet: own ? id : '',
      note: (upload ? 'Excel upload ' + upload + ': ' : 'Box change: ') + (loc === FLOOR2 ? 'top of racks' : loc) + ' ' + was + ' → ' + q + ' · reason: ' + reason });
    var st = {}; st[id] = -d; var pa = {}; pa[k] = { add: d, drop: !prev };
    if (!upload) remember(ev, { stock: st, putAdd: pa, boxes: state ? pbx : {} });
    return { ev: ev, d: d, was: was, n: n };
  }
  function paBox(n) { var hs = homeOf(n); for (var i = 0; i < hs.length; i++) if (counted(hs[i], n.id) < boxCap(hs[i], n.id)) return hs[i]; return n.pick; } // first box with room
  function locHint(c) {
    var m = /^([A-Z])([LR])-C(\d)-R(\d)$/.exec(c); if (!m) return '';
    return 'Rack ' + m[1] + ' · ' + (m[2] === 'L' ? 'left' : 'right') + ' side · column ' + m[3] + ' · row ' + m[4] + (m[4] === '1' ? ' (floor)' : m[4] === '5' ? ' (top row)' : '');
  }
  function paStart() { sess.pa = { net: null, box: null, size: null, last: (sess.pa || {}).last || null }; sess.await = 'pasize'; paDraw(); }
  function paDraw() {
    var adj = document.getElementById('adjust'); if (!adj || sess.mode !== 'PUTAWAY') return;
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
      var n = BY_ID[pa.net], c = pa.box, have = counted(c, n.id), cap = boxCap(c, n.id), top = counted(FLOOR2, n.id), bin = BOXES[c] && BOXES[c].kind === 'bin';
      var others = homeOf(n).filter(function (x) { return x !== c; });
      adj.innerHTML = '<div class="pa pa-card"><div class="pa-net"><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n).replace('x', ' × ')) + '</div>' +
        '<div class="pa-go">Put it in box</div><div class="pa-loc">' + esc(c) + '</div><div class="pa-hint">' + esc(locHint(c)) + (bin ? ' · <b>' + esc(n.color) + ' bin</b> of a 3-bin box' : '') + '</div>' +
        '<div class="pa-have">In this box now: <b>' + have + '</b>' + (cap ? ' · room for ' + cap : '') + (have >= cap && cap ? ' · <b>box is full</b>' : '') + (top ? ' · on top: ' + top : '') + '</div>' +
        '<div class="pa-step">How many did you put in?</div><div class="qbtns">' + [1, 2, 3, 4, 5, 10].map(function (q) { return '<button type="button" class="act pa-add" data-pa-add="' + q + '">+' + q + '</button>'; }).join('') + '</div>' +
        '<div class="qtyrow"><label class="f">Other number<input id="paQty" type="number" min="1" inputmode="numeric"></label><button type="button" class="btn primary" data-pa-other="1">Add</button></div>' +
        '<div class="pa-step">Box full? Put the rest on top of the rack:</div><div class="qbtns">' + [1, 2, 3, 5, 10].map(function (q) { return '<button type="button" class="act ghost" data-pa-top="' + q + '">Top +' + q + '</button>'; }).join('') + '</div>' +
        (others.length ? '<div class="small" style="color:#cfd6db">This net also has boxes: ' + others.map(function (x) { return '<button type="button" class="linkbtn" data-pa-box="' + x + '">' + esc(x) + '</button>'; }).join(' ') + '</div>' : '') +
        '<button type="button" class="act ghost" data-pa-back="1">Choose another net</button></div>';
    }
    var oq = document.getElementById('paQty');
    if (oq) oq.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); var v = parseInt(oq.value, 10); if (v > 0) paAdd(v, false); } };
    adj.onclick = function (e) {
      var b = e.target.closest('[data-pa-size],[data-pa-net],[data-pa-back],[data-pa-add],[data-pa-top],[data-pa-box],[data-pa-other]'); if (!b) return; e.stopPropagation();
      var d = b.dataset;
      if (d.paSize) { sess.pa.size = d.paSize; paDraw(); }
      else if (d.paNet) paChoose(BY_ID[d.paNet], null);
      else if (d.paBack) { sess.pa.net = null; sess.pa.size = null; sess.await = 'pasize'; paDraw(); }
      else if (d.paAdd) paAdd(+d.paAdd, false);
      else if (d.paTop) paAdd(+d.paTop, true);
      else if (d.paBox) { sess.pa.box = d.paBox; paDraw(); }
      else if (d.paOther) { var v = parseInt(document.getElementById('paQty').value, 10); if (v > 0) paAdd(v, false); else toast('Type how many you put in.'); }
      if (!TOUCH) refocus();
    };
  }
  function paChoose(n, box) {
    sess.pa.net = n.id; sess.pa.size = null; sess.pa.box = box || paBox(n); sess.await = 'paqty'; sess.net = n;
    fb('Put the ' + esc(netLabel(n)) + ' nets in <b>' + esc(sess.pa.box) + '</b>, then tap how many.', 'ok');
    paDraw(); showOnPhone('adjust');
  }
  function paScan(code, box, list) { // scanning the shelf is optional: it confirms the box, or picks the net from the shelf
    if (code === FLOOR2) { fb(sess.pa && sess.pa.net ? 'For the top of the rack, tap a <b>Top +</b> button.' : 'First type the size of the net in your hand.', 'warn'); paDraw(); return; }
    if (!box) { fb('That is not a shelf label.', 'bad'); paDraw(); return; }
    var n = sess.pa && sess.pa.net && BY_ID[sess.pa.net];
    if (n && homeOf(n).indexOf(code) >= 0) { sess.pa.box = code; fb('✓ Right box: <b>' + esc(code) + '</b>. Now tap how many you put in.', 'ok'); paDraw(); return; }
    if (n) { fb('<b>Wrong box.</b> ' + esc(code) + ' is for ' + esc(list.length > 1 ? list[0].size + ' (3 bins)' : netLabel(list[0])) + '. ' + esc(netLabel(n)) + ' goes in <b>' + esc(sess.pa.box) + '</b>.', 'bad'); paDraw(); return; }
    if (list.length === 1) { paChoose(list[0], code); return; }
    sess.pa.size = list[0].size; paDraw(); fb(esc(code) + ' is a 3-bin box for ' + esc(list[0].size) + '. Tap the color.', 'ok');
  }
  function paAdd(q, top) {
    var n = BY_ID[sess.pa.net]; if (!n || !(q > 0)) return;
    if (q > 200) { fb('<b>' + q + '</b> is too many for one go. Type the number again.', 'bad'); return; }
    var loc = top ? FLOOR2 : sess.pa.box, key = countKey(loc, n.id), prev = clone(S.shelf[key] || null), tot = (prev ? Number(prev.qty) : 0) + q;
    var own = !top && BOXES[loc] && BOXES[loc].kind === 'own', pbx = !top && isEmpty(loc) ? snapBoxes([loc]) : {}, st = {}; st[n.id] = -q;
    S.shelf[key] = { box: loc, net: n.id, qty: tot, at: now(), by: sess.emp };
    S.stock[n.id] = onHand(n.id) + q;
    if (!top && isEmpty(loc)) setBox(loc, { state: 'full', net: own ? n.id : '', wo: '', made: null });
    var ev = addLog({ type: 'BOXADD', who: sess.emp, net: n.id, qty: q, loc: loc, boxNet: own ? n.id : '', note: 'Put away +' + q + (top ? ' on top' : '') + ' (now ' + tot + ' there, ' + onHand(n.id) + ' in total)' });
    var pa = {}; pa[key] = { add: q, drop: !prev }; remember(ev, { stock: st, putAdd: pa, boxes: pbx }); save();
    var cap = top ? 0 : boxCap(loc, n.id), over = cap && tot > cap;
    fb('Added <b>' + q + '</b> ' + esc(netLabel(n)) + ' → <b>' + esc(top ? 'top of the rack' : loc) + '</b>. Now ' + tot + ' there, ' + onHand(n.id) + ' in stock.' + (over ? ' That is more than the box was planned for (' + cap + '). Next ones can go on top.' : '') + ' <b>Next net:</b> type its size.', over ? 'warn' : 'ok');
    sess.pa = { net: null, box: null, size: null, last: n.id }; sess.await = 'pasize'; sess.net = null;
    paDraw();
  }

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
    if (!box) { fb('In box count, scan a shelf label, or <b>TOP</b> for the top of the racks.', 'bad'); return; }
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
    fb('<b>Top of racks.</b> Pick the size and tap the color, then type how many of that net are on top of the racks in total.', 'ok');
    adj.querySelectorAll('[data-col]').forEach(function (b) { b.onclick = function (e) {
      e.stopPropagation(); var sz = document.getElementById('bcSize').value, n = NETS.filter(function (x) { return x.size === sz && x.color === b.dataset.col; })[0];
      if (!n) { toast('That size has no ' + b.dataset.col + ' net.'); return; }
      adj.innerHTML = ''; sess.bc = { loc: FLOOR2, nets: [n.id], i: 0 }; askBoxQty(''); if (!TOUCH) refocus();
    }; });
  }
  function askBoxQty(before) {
    var bc = sess.bc, n = BY_ID[bc.nets[bc.i]], prev = S.counts[countKey(bc.loc, n.id)], bx = BOXES[bc.loc];
    sess.net = n; sess.loc = bc.loc; sess.await = 'bcqty';
    fb(before + '<code>' + esc(bc.loc === FLOOR2 ? 'TOP' : bc.loc) + '</code> · ' + (bx ? (bx.role === 'pick' ? 'PICK' : 'BACKUP') + (bc.nets.length > 1 ? ' · 3-bin box, color ' + (bc.i + 1) + ' of ' + bc.nets.length : '') + ' · ' : 'top of racks · ') + '<b>' + esc(netLabel(n)) + '</b>. ' +
      (prev ? 'Already counted: <b>' + prev.qty + '</b> by ' + esc(wname(prev.by)) + '. A new number replaces it.' : 'Count the nets and type the number.'), 'ok');
    paint(); showOnPhone('qbar');
  }
  function recordBoxCount(q) {
    var bc = sess.bc, n = BY_ID[bc.nets[bc.i]], bx = BOXES[bc.loc];
    if (bx && q > bx.cap * 2 && bc.sure !== q) { bc.sure = q; fb('<b>' + q + '</b> is a lot for this box (it was planned for ' + bx.cap + '). If that is right, type ' + q + ' again.', 'warn'); return; } // typo guard, never a block
    var key = countKey(bc.loc, n.id), prev = clone(S.counts[key] || null), pc = {}; pc[key] = prev;
    S.counts[key] = { box: bc.loc, net: n.id, qty: q, at: now(), by: sess.emp };
    remember(addLog({ type: 'BOXCOUNT', who: sess.emp, net: n.id, qty: q, loc: bc.loc, note: 'Box count' + (prev ? ' (replaces ' + prev.qty + ')' : '') }), { counts: pc });
    save();
    var said = 'Saved <b>' + esc(n.color) + ' ' + q + '</b>. ';
    bc.i++;
    if (bc.i < bc.nets.length) { askBoxQty(said); return; }
    sess.bc = null; sess.await = null; sess.net = null;
    fb((bc.nets.length > 1 ? said : '') + '<b>' + esc(bc.loc === FLOOR2 ? netLabel(n) + ' on top of the racks' : bc.loc) + ': ' + q + '</b> counted. ' + countProgressText() + ' Scan the next ' + (bc.loc === FLOOR2 ? 'shelf label or TOP' : 'shelf label') + '.', 'ok');
    paint();
  }

  // ---------- stock ----------
  function walkSorted() { return NETS.slice().sort(function (a, b) { return sideOrder(a.pick, b.pick) || COLORS.indexOf(a.color) - COLORS.indexOf(b.color); }); }
  function viewStock() {
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Stock</h2><div class="row" style="align-items:flex-end"><label class="f">Search size, color or rack<input id="q" placeholder="e.g. 210x100, Grey, AR-C1"></label><button class="btn" id="cntPrint">Print count sheet</button><button class="btn primary" id="cntMode">Enter counts</button></div></div>' +
      '<div class="card" id="bcCard"></div>' +
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
    drawExcel();
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
    el.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center"><h3>Box count <span class="small muted">(opening count, day 14 count)</span></h3>' + (rows.length ? '<button class="btn" id="bcOpen">' + (open ? 'Hide' : 'Review and apply') + '</button>' : '') + '</div>' +
      '<div class="small">' + (rows.length ? '<b>' + p.done + ' of ' + p.total + '</b> boxes counted' + (p.floor ? ', ' + p.floor + ' nets on top of the racks' : '') + '. Counts change stock only when you press Apply.' : 'No box counts yet. On a phone: Scan station → <b>Count boxes</b>, scan each shelf label and type how many are in it. Scan <b>TOP</b> for the top of the racks.') + '</div>' +
      (open ? '<details class="small"' + (left.length && left.length <= 40 ? ' open' : '') + '><summary>' + left.length + ' boxes not counted yet</summary><div class="mono">' + (left.map(esc).join(' ') || 'none') + '</div></details>' +
        '<div class="tablewrap"><table><thead><tr><th>Net</th><th>In system</th><th>Boxes</th><th>On top</th><th>New total</th><th>Change</th></tr></thead><tbody>' +
        ready.map(function (x) { var d = x.total - onHand(x.n.id); return '<tr><td><span class="sw sw-' + x.n.color + '"></span>' + esc(netLabel(x.n)) + '</td><td>' + onHand(x.n.id) + '</td><td>' + x.racks + '</td><td>' + (x.fl ? x.floor : '<span class="muted">not counted = 0</span>') + '</td><td><b>' + x.total + '</b></td><td>' + (d ? '<b>' + (d > 0 ? '+' : '') + d + '</b>' : '<span class="muted">same</span>') + '</td></tr>'; }).join('') +
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
      addLog({ type: 'COUNT', who: who, net: n.id, qty: x.total, loc: n.pick, reason: d ? why : '', note: 'Box count: boxes ' + x.racks + ' + top ' + x.floor + ' (was ' + before + ')' + (d ? ' · reason: ' + why : ' · matches') });
      homeOf(n).forEach(function (c) { used.push(countKey(c, n.id)); boxes[c] = 1; });
      if (x.fl) used.push(countKey(FLOOR2, n.id));
    });
    Object.keys(boxes).sort(sideOrder).forEach(function (c) { // counted boxes: 0 = empty (refill list), more = has nets
      if (!boxCounted(c)) return;
      var sum = BOXES[c].nets.reduce(function (a, id) { return a + Number(S.counts[countKey(c, id)].qty); }, 0);
      if (sum === 0 && !isEmpty(c)) { S.boxes[c] = { state: 'empty', at: now(), by: who }; addLog({ type: 'EMPTY', who: who, loc: c, note: 'Box count: empty' }); }
      else if (sum > 0 && isEmpty(c)) { var own = BOXES[c].kind === 'own' ? BOXES[c].nets[0] : ''; S.boxes[c] = { state: 'full', net: own, wo: '', made: null, at: now(), by: who }; addLog({ type: 'BOXSET', who: who, net: own, loc: c, state: 'full', note: 'Box count: ' + sum + ' nets in box' }); }
    });
    used.forEach(function (k) { var c = S.counts[k]; if (c) S.shelf[k] = { box: c.box, net: c.net, qty: Number(c.qty) || 0, at: now(), by: who }; delete S.counts[k]; }); // the counted number is now the box's number
    addLog({ type: 'COUNTDONE', who: who, keys: used, note: 'Box count applied: ' + ready.length + ' nets' + (why ? ' · reason: ' + why : '') });
    S.undo = null; save(); toast(ready.length + ' counts applied.'); route();
  }

  // ---------- Excel: download the inventory (one row per net and box, plus top of racks), edit, upload ----------
  var XL_COLS = ['Net ID', 'Size', 'Color', 'Box', 'Box type', 'In box', 'Net total now', 'Not in a box'];
  function xlRows() {
    var rows = [];
    walkSorted().forEach(function (n) {
      var nb = Math.max(0, onHand(n.id) - inBoxes(n.id) - counted(FLOOR2, n.id));
      homeOf(n).concat([FLOOR2]).forEach(function (c) {
        rows.push([n.id, n.size, n.color, c, c === FLOOR2 ? 'top of racks' : (BOXES[c].role === 'pick' ? 'pick' : 'backup') + (BOXES[c].kind === 'bin' ? ' (3 bins)' : ''), counted(c, n.id), onHand(n.id), nb]);
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
      if (!/^\d+(\.0+)?$/.test(raw) || Number(raw) > 500) { bad.push([line, id + ' ' + box, '"' + raw + '" is not a whole number of nets (0 to 500)']); return; }
      var k = countKey(box, id); if (seen[k]) { bad.push([line, id + ' ' + box, 'this net and box is in the file twice']); return; } seen[k] = 1;
      var q = Math.round(Number(raw)), now = counted(box, id);
      if (q !== now) changes.push({ n: n, box: box, from: now, to: q });
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
      res.changes.map(function (c) { var d = c.to - c.from; return '<tr><td><span class="sw sw-' + c.n.color + '"></span>' + esc(netLabel(c.n)) + '</td><td><code>' + esc(c.box === FLOOR2 ? 'TOP' : c.box) + '</code></td><td>' + c.from + '</td><td><b>' + c.to + '</b></td><td><b>' + (d > 0 ? '+' : '') + d + '</b></td><td>' + Math.max(0, onHand(c.n.id) + nets[c.n.id]) + ' <span class="muted small">(now ' + onHand(c.n.id) + ')</span></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="small">No numbers are different from the app. Nothing to save.</div>') +
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
  function viewPick() {
    h('<h2>Pick list</h2><div class="note small">Paste today\'s self-ship orders (Easyship, Seller Flex, website): one line per order item, with the SKU (or size and color, e.g. "210x100 Black") and the quantity. Copying the SKU and Quantity columns from the Amazon order report works. The list comes back in walking order: AR → AL → BR → BL → CR → CL.</div>' +
      '<textarea id="pIn" rows="8" style="width:100%;font-family:var(--f-mono);padding:8px;border:1px solid var(--line);border-radius:2px;background:var(--surface);color:var(--ink)" placeholder="MQDR-210x100-BK\t2&#10;MQ-DR-205x90-GR\t1&#10;200x100 Brown 1"></textarea>' +
      '<div class="row"><button class="btn primary" id="pGo">Make pick list</button><button class="btn" id="pPrint" hidden>Print</button></div><div id="pOut"></div>');
    var lastNode = null;
    document.getElementById('pGo').onclick = function () {
      var lines = document.getElementById('pIn').value.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean), tot = {}, bad = [];
      lines.forEach(function (l) { var r = findNet(l); if (!r.net) { bad.push(l); return; } tot[r.net.id] = (tot[r.net.id] || 0) + r.qty; });
      var rows = Object.keys(tot).map(function (id) { return BY_ID[id]; }).sort(function (a, b) { return sideOrder(a.pick, b.pick) || COLORS.indexOf(a.color) - COLORS.indexOf(b.color); });
      var units = rows.reduce(function (a, n) { return a + tot[n.id]; }, 0);
      var html = '<div class="sheet"><h3>Pick list · ' + esc(new Date().toLocaleDateString()) + ' · ' + units + ' nets · picker ____________</h3><table><thead><tr><th>✓</th><th>Box</th><th>Net</th><th>Qty</th><th>In system</th></tr></thead><tbody>' +
        rows.map(function (n) { var short = onHand(n.id) < tot[n.id]; return '<tr><td>☐</td><td><b>' + esc(n.pick) + '</b></td><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + (n.kind === 'bin' ? ' (3-bin box)' : '') + '</td><td><b>' + tot[n.id] + '</b></td><td>' + onHand(n.id) + (short ? ' <b>SHORT</b>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' +
        '<p class="small">Scan <b>OUT</b> once, then for each line: the box label, then the quantity (QTY label or type it).</p></div>' +
        (bad.length ? '<div class="note small"><b>Not recognised (' + bad.length + '):</b><br>' + bad.map(esc).join('<br>') + '</div>' : '');
      document.getElementById('pOut').innerHTML = html; lastNode = document.querySelector('#pOut .sheet');
      document.getElementById('pPrint').hidden = !rows.length;
    };
    document.getElementById('pPrint').onclick = function () { if (lastNode) printLabels([lastNode.cloneNode(true)], 'A4P'); };
  }

  // ---------- rack map ----------
  function viewRacks() {
    var sides = window.SIDES || [], COLS = window.RACK_COLS || 6, RNG = window.SIDE_RANGES || {};
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Rack map</h2><label class="f">Find a size<input id="rq" placeholder="e.g. 205x90"></label></div>' +
      '<div class="note small">Sizes in number order. Popular sizes on R2–R4, slow sizes on R1/R5. Extra stock sits on top of the racks. 210×100 is in AR columns 1–3, picked from R3.</div>' +
      '<div class="legend"><span><i style="background:var(--soft-ok)"></i>Pick box, healthy</span><span><i style="background:var(--soft-warn)"></i>Low</span><span><i style="background:var(--soft-bad)"></i>Out / box empty</span><span><i style="border:1px dashed var(--ink)"></i>Backup</span></div>' +
      '<div class="card small" id="boxInfo">Tap a box to see what is in it.</div><div class="sides" id="sides"></div>');
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
    function info(code) {
      var bx = BOXES[code], el = document.getElementById('boxInfo');
      if (!bx) { el.innerHTML = '<b>' + esc(code) + '</b> is free.'; return; }
      var r = boxRec(code), list = netsAt(code), edit = can('Manager') && sheetV8();
      el.innerHTML = '<b>' + esc(code) + '</b> · ' + (bx.role === 'pick' ? 'PICK' : 'BACKUP') + (bx.kind === 'bin' ? ' · 3 bins' : '') + ' · ' + (r ? (r.state === 'empty' ? '<b>marked empty</b>' : (r.made ? 'made ' + esc(fmtD(r.made)) : 'has nets')) : 'not scanned yet') +
        '<div class="tablewrap"><table><thead><tr><th>Net</th><th>In this box</th><th>On top of racks</th><th>Not in a box</th><th>Total</th></tr></thead><tbody>' +
        list.map(function (n) { var nb = onHand(n.id) - inBoxes(n.id) - counted(FLOOR2, n.id);
          return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><b>' + (S.shelf[countKey(code, n.id)] ? counted(code, n.id) : '—') + '</b> <span class="muted small">room ' + (bx.mix ? bx.mix[n.id] : bx.cap) + '</span></td><td>' + counted(FLOOR2, n.id) + '</td><td>' + (nb > 0 ? nb : 0) + '</td><td><b>' + onHand(n.id) + '</b></td></tr>'; }).join('') + '</tbody></table></div>' +
        (edit ? '<div class="row" style="align-items:flex-end"><label class="f">Change<select id="bqWhere">' +
          list.map(function (n) { return '<option value="' + code + '|' + n.id + '">' + esc(code + ' · ' + netLabel(n)) + '</option><option value="' + FLOOR2 + '|' + n.id + '">' + esc('Top of racks · ' + netLabel(n)) + '</option>'; }).join('') + '</select></label>' +
          '<label class="f">New number<input id="bqQty" type="number" min="0" inputmode="numeric" style="width:6em"></label>' + reasonSelect('bqWhy') + '<button class="btn primary" id="bqSave">Save</button></div><div class="small" id="bqMsg"></div>'
          : (can('Manager') ? '<div class="small muted">Changing a box number needs the Google Sheet script version ' + BOXQTY_V + '.</div>' : ''));
      var sv = document.getElementById('bqSave'); if (!sv) return;
      sv.onclick = function () {
        var w = document.getElementById('bqWhere').value.split('|'), q = parseInt(document.getElementById('bqQty').value, 10), msg = document.getElementById('bqMsg'), why = readReason('bqWhy');
        if (!(q >= 0) || q > 500) { msg.textContent = 'Type the number of nets that are really there (0 or more).'; return; }
        if (q === counted(w[0], w[1]) && S.shelf[countKey(w[0], w[1])]) { msg.textContent = 'That is already the number.'; return; }
        if (why === null) { msg.textContent = 'Pick a reason first.'; return; }
        var x = setBoxQty(w[0], w[1], q, why); save();
        toast((w[0] === FLOOR2 ? 'Top of racks' : w[0]) + ' · ' + netLabel(x.n) + ': ' + x.was + ' → ' + q + '. Total now ' + onHand(w[1]) + '.');
        viewRacks(); setTimeout(function () { var b = app.querySelector('[data-b="' + code + '"]'); if (b) b.click(); }, 0);
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
    h('<h2>Refill list</h2><div class="note">Walk the racks in order (AR → AL → BR → BL → CR → CL). For each empty box, take the <b>oldest</b> batch from the top of the racks, fill the box, then scan <b>REFILL</b> and the box. Never pour new nets on top of old ones.</div>' +
      '<div class="card"><h3>Empty boxes to fill (' + empt.length + ')</h3><div class="tablewrap"><table><thead><tr><th>Box</th><th>Type</th><th>Net</th><th>Take from top of racks</th></tr></thead><tbody>' +
      (empt.map(function (c) { var bx = BOXES[c], list = netsAt(c); return '<tr><td><code>' + c + '</code></td><td>' + (bx.role === 'pick' ? 'Pick' : 'Backup') + (bx.kind === 'bin' ? ' · 3 bins' : '') + '</td><td>' + list.map(function (n) { return '<span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + (bx.mix ? ' ×' + bx.mix[n.id] : ' ×' + bx.cap); }).join('<br>') + '</td><td>' + list.map(function (n) { var o = oldest2F(n); return o ? '<code>' + o.id + '</code> made ' + esc(fmtD(o.created)) : '<span class="muted">no batch on 2F</span>'; }).join('<br>') + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="muted">No empty boxes. Pickers scan EMPTY when a box runs out, or SWAP when they bring a backup down.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><h3>Low in total, make more (' + low.length + ')</h3><div class="tablewrap"><table><thead><tr><th>Net</th><th>Pick box</th><th>In total</th><th>Refill at</th></tr></thead><tbody>' +
      low.map(function (n) { return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + n.pick + '</code></td><td>' + onHand(n.id) + '</td><td>' + n.refillAt + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      (untracked ? '<div class="small muted">' + untracked + ' boxes have not been scanned since the new layout. They count as full with an unknown date until the first REFILL, SWAP or rack-in.</div>' : ''));
  }

  // ---------- setup labels ----------
  function viewPrint() {
    var sides = window.SIDES || [];
    h('<h2>Setup labels</h2><div class="note">Print these once. Shelf labels (one per box slot, stuck on the shelf edge, never moved) and badges are 50 × 25 mm. Batch labels and box tags (also 50 × 25 mm) print from <a href="#batches">Batches</a>. All barcodes are Code 128, which every USB scanner reads.</div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Worker badges</h3><button class="btn primary" id="pW">Print all badges</button></div><details class="pv"><summary>Show preview</summary><div class="labels-preview" id="prevW"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Command sheet</h3><button class="btn primary" id="pC">Print commands</button></div><div class="small muted">Includes the TOP label (extra stock on top of the racks).</div><details class="pv"><summary>Show preview</summary><div class="labels-preview" id="prevC"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Side signs (3 per A4)</h3><button class="btn primary" id="pS">Print all 6 signs (2 pages)</button></div><div class="small muted">One sign at the end of each rack side: the side code and its size range. Prints 3 per A4 page, portrait. Cut along the borders and laminate.</div><details class="pv"><summary>Show preview</summary><div class="signs-preview" id="prevS"></div></details></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Shelf labels</h3><div class="row" style="align-items:flex-end"><label class="f">Side<select id="pSide">' + sides.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary" id="pL">Print this side</button></div></div><div class="small muted" id="cntL"></div><details class="pv"><summary>Show preview</summary><div class="labels-preview" id="prevL"></div></details></div>');
    S.workers.forEach(function (w) { document.getElementById('prevW').appendChild(badgeLabel(w)); });
    COMMANDS.forEach(function (c) { document.getElementById('prevC').appendChild(cmdLabel(c)); });
    document.getElementById('prevC').appendChild(floorLabel());
    sides.slice(0, 2).forEach(function (sd) { document.getElementById('prevS').appendChild(sideSign(sd)); });
    document.getElementById('pS').onclick = function () { printLabels(sides.map(sideSign), 'A4P'); };
    function codesFor(side) { return Object.keys(BOXES).filter(function (k) { return k.indexOf(side + '-') === 0; }).sort(sideOrder); }
    function drawL() { var side = document.getElementById('pSide').value, codes = codesFor(side), el = document.getElementById('prevL'); el.innerHTML = ''; codes.slice(0, 12).forEach(function (c) { el.appendChild(boxLabel(c)); }); document.getElementById('cntL').textContent = codes.length + ' labels on side ' + side + (codes.length > 12 ? ' (showing the first 12)' : '') + '.'; }
    document.getElementById('pSide').onchange = drawL; drawL();
    document.getElementById('pW').onclick = function () { printLabels(S.workers.map(badgeLabel), '50x25'); };
    document.getElementById('pC').onclick = function () { printLabels(COMMANDS.map(cmdLabel).concat([floorLabel()]), '50x25'); };
    document.getElementById('pL').onclick = function () { printLabels(codesFor(document.getElementById('pSide').value).map(boxLabel), '50x25'); };
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
      (can('Owner') ? '<div class="card" id="resetCard"><h3>Reset inventory to zero <span class="small muted">(owner only)</span></h3><div class="small">Sets every net to 0 and clears box records (empty / has nets), box counts waiting for Apply and put-away numbers. ' +
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
  var LEVEL_HELP = { Worker: 'scan, pick, refill, count boxes', Manager: '+ dashboard, stock, counts, batches, labels, scan log', Admin: '+ people, PINs, settings', Owner: '+ reset inventory to zero; only the owner can give or change the Owner level' };
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
    if (sheetOn()) pull().then(function (c) { if (c && location.hash === '#people') draw(); });
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
    if (Array.isArray(d.shelf)) { S.shelf = {}; d.shelf.forEach(function (c) { if (c.box && c.net) S.shelf[countKey(c.box, c.net)] = { box: c.box, net: c.net, qty: Number(c.qty) || 0, at: c.at, by: c.by }; }); }
    S.resetAt = d.resetAt || S.resetAt || '';
    if (Array.isArray(d.snaps)) S.snaps = d.snaps;
    if (Array.isArray(d.counts)) { S.counts = {}; d.counts.forEach(function (c) { if (c.box && c.net) S.counts[countKey(c.box, c.net)] = { box: c.box, net: c.net, qty: Number(c.qty) || 0, at: c.at, by: c.by }; }); }
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
          var lv = S.auth.level; applyRemote(d); save(); if (S.auth.level !== lv) paintNav(); return true;
        })
        .catch(function (err) { syncState.err = err.message || 'offline'; return false; });
    }).then(function (changed) { paintSync(); return changed; });
  }
  setInterval(function () {
    pull().then(function (changed) {
      var k = (location.hash || '#dashboard').slice(1);
      if (changed && ['dashboard', 'stock', 'racks', 'refill', 'log'].indexOf(k) >= 0) route();
    });
  }, 20000);

  // ---------- router ----------
  var VIEWS = { dashboard: viewDashboard, scan: viewScan, batches: viewBatches, stock: viewStock, racks: viewRacks, refill: viewRefill, pick: viewPick, print: viewPrint, log: viewLog, people: viewPeople, settings: viewSettings };
  // Who sees which page. Floor work (scan, pick, refill, rack map) is open to everyone: staff rotate.
  var NEED = { dashboard: 'Manager', batches: 'Manager', stock: 'Manager', print: 'Manager', log: 'Manager', people: 'Admin', settings: 'Admin' };
  function paintNav() {
    var on = signedIn();
    document.getElementById('tabs').hidden = !on;
    document.querySelectorAll('#tabs a').forEach(function (a) { a.hidden = !can(NEED[a.getAttribute('href').slice(1)] || 'Worker'); });
    var me = document.getElementById('meChip');
    if (me) { me.hidden = !on; if (on) { me.querySelector('.n').textContent = S.auth.name + (S.auth.level !== 'Worker' ? ' · ' + S.auth.level : ''); } }
  }
  function route() {
    document.removeEventListener('click', refocus);
    paintNav();
    if (!signedIn()) { document.querySelectorAll('#tabs a').forEach(function (a) { a.classList.remove('on'); }); viewSignIn(); paintSync(); return; }
    var k = (location.hash || '').slice(1);
    if (!VIEWS[k] || !can(NEED[k] || 'Worker')) { k = can('Manager') && !TOUCH ? 'dashboard' : 'scan'; history.replaceState(null, '', location.pathname + location.search + '#' + k); }
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
  route(); if (sheetOn() && signedIn()) pull().then(function (c) { if (c) route(); });
  window.ArmorX = { handle: handle, state: function () { return S; } };
})();
