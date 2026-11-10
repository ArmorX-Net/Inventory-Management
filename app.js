// ArmorX office sheet (mbventures.amazon@gmail.com). Settings fills these in; press Connect.
// The access key is NOT stored in the code. Phones get it once from the setup link: <app link>#setup=<key>
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
  var FLOOR2 = '2F'; // second-floor warehouse: bulk stock, refills the racks
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
    ], settings: { batchSize: '100x50' }, boxes: {}, demo: false };
  }
  var S;
  function load() {
    try { var raw = localStorage.getItem(KEY); S = raw ? JSON.parse(raw) : null; } catch (e) { S = null; }
    if (!S) { S = blank(); seedDemo(); }
    if (!S.boxes || S.layout !== window.LAYOUT_VERSION) { S.boxes = {}; S.layout = window.LAYOUT_VERSION; }
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
  function addLog(e) {
    e.t = e.t || now(); S.log.unshift(e); if (S.log.length > 5000) S.log.length = 5000;
    queue(Object.assign({}, e));
  }
  function queue(ev) {
    if (noSync || !sheetOn()) return;
    ev.id = ev.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    ev.t = ev.t || now();
    if (ev.net && BY_ID[ev.net]) ev.netName = netLabel(BY_ID[ev.net]);
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
  function barcode(svg, code, opts, cssH) {
    if (!svg) return;
    svg.style.width = '100%'; if (cssH) svg.style.height = cssH;
    try { window.JsBarcode(svg, code, Object.assign({ format: 'CODE128', displayValue: false, margin: 12, height: 40, width: 2 }, opts || {})); }
    catch (e) { svg.outerHTML = '<div class="mono small">' + esc(code) + ' (barcode library not loaded)</div>'; }
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
  function batchLabel(b) {
    var n = BY_ID[b.net], el = document.createElement('div');
    el.className = 'lbl lbl-batch';
    el.innerHTML = '<div class="t"><b>ARMORX · DOORNET BATCH</b><span>' + esc(new Date(b.created).toLocaleDateString()) + '</span></div>' +
      '<div class="stripe ' + esc(n.color) + '"></div>' +
      '<div class="main"><div><div class="size">' + esc(n.size.replace('x', ' × ')) + '</div><div class="color">' + esc(n.color) + '</div></div>' +
      '<div class="qty">' + b.qty + '<small>NETS</small></div></div>' +
      '<svg class="bc"></svg>' +
      '<div class="t"><b style="font-size:10pt">' + esc(b.id) + '</b><span class="made">MADE ' + esc(new Date(b.created).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()) + '</span></div>' +
      '<div class="t"><span class="home">PICK ' + esc(n.pick) + (n.backups && n.backups.length ? ' · BACKUP ' + esc(n.backups.length) : '') + '</span><span class="home">FIRST MADE, FIRST OUT</span></div>' +
      '<div class="ticks">' + SHORT.slice(1).map(function (s) { return '<span>' + s + '</span>'; }).join('') + '</div>';
    barcode(el.querySelector('.bc'), b.id, { height: 34, width: 2.2 }, '10mm');
    return el;
  }
  function boxLabel(code) {
    var bx = BOXES[code], list = netsAt(code), n = list[0], el = document.createElement('div'), bin = bx && bx.kind === 'bin', bk = bx && bx.role === 'backup';
    el.className = 'lbl lbl-loc' + (bk ? ' backup' : '');
    el.innerHTML = '<div class="stripe ' + esc(bin ? 'bins' : (n ? n.color : '')) + '"></div><div class="code">' + esc(code) + '</div>' +
      '<div class="sub"><span><b>' + esc(n ? n.size.replace('x', '×') : 'free') + '</b> ' + esc(bin ? 'BLACK | BROWN | GREY' : (n ? n.color.toUpperCase() : '')) + '</span><span class="role">' + (bk ? 'BACKUP' : 'PICK') + ' ' + (bx ? bx.cap : '') + '</span></div><svg class="bc"></svg>';
    barcode(el.querySelector('.bc'), code, { height: 30, width: 1.6 }, '8mm');
    return el;
  }
  function floorLabel() {
    var el = document.createElement('div'); el.className = 'lbl lbl-cmd';
    el.innerHTML = '<div class="mono" style="font-size:6.5pt">ARMORX · LOCATION</div><div class="nm">2F · Second floor</div><svg class="bc"></svg><div class="mono" style="font-size:6.5pt;text-align:center">2F</div>';
    barcode(el.querySelector('.bc'), FLOOR2, { height: 30, width: 2 }, '9mm');
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
    barcode(el.querySelector('.bc'), w.id, { height: 30, width: 2 }, '9mm');
    return el;
  }
  var COMMANDS = [['CMD-OUT', 'OUT · order pick'], ['CMD-FBA', 'OUT · FBA shipment'], ['CMD-RETURN', 'RETURN · back to stock'], ['CMD-DAMAGED', 'RETURN · damaged'], ['CMD-COUNT', 'COUNT · correct total'], ['CMD-SWAP', 'SWAP · backup down'], ['CMD-REFILL', 'REFILL · from 2F'], ['CMD-EMPTY', 'EMPTY · box ran out'], ['CMD-CANCEL', 'CANCEL · clear'], ['QTY-1', 'Qty 1'], ['QTY-5', 'Qty 5'], ['QTY-10', 'Qty 10'], ['QTY-20', 'Qty 20'], ['QTY-25', 'Qty 25']];
  function cmdLabel(c) {
    var el = document.createElement('div'); el.className = 'lbl lbl-cmd';
    el.innerHTML = '<div class="mono" style="font-size:6.5pt">ARMORX · COMMAND</div><div class="nm">' + esc(c[1]) + '</div><svg class="bc"></svg><div class="mono" style="font-size:6.5pt;text-align:center">' + esc(c[0]) + '</div>';
    barcode(el.querySelector('.bc'), c[0], { height: 30, width: 2 }, '9mm');
    return el;
  }
  function printLabels(nodes, size) {
    var area = document.getElementById('print-area'); area.innerHTML = '';
    nodes.forEach(function (n) { area.appendChild(n); });
    var st = document.getElementById('page-size');
    if (!st) { st = document.createElement('style'); st.id = 'page-size'; document.head.appendChild(st); }
    var dim = size === '50x25' ? '50mm 25mm' : size === 'A4' ? 'A4 landscape' : size === 'A4P' ? 'A4 portrait' : '100mm 50mm';
    st.textContent = '@page{size:' + dim + ';margin:' + (/^A4/.test(size) ? '10mm' : '0') + '}';
    toast(/^A4/.test(size) ? 'Opening print dialog: normal printer, ' + dim + '.' : 'Opening print dialog: pick the thermal printer and paper ' + dim.replace(/ /, ' × ') + ', margins none.');
    setTimeout(function () { try { window.print(); } catch (e) {} }, 150);
  }

  // ---------- views ----------
  var app = document.getElementById('app');
  function h(html) { app.innerHTML = '<div class="view">' + html + '</div>'; }

  function viewDashboard() {
    var total = 0, out = 0, low = 0;
    NETS.forEach(function (n) { var q = onHand(n.id); total += q; if (q <= 0) out++; else if (q <= n.refillAt) low++; });
    var open = Object.values(S.batches).filter(function (b) { return b.stage < 6; });
    var inProd = open.reduce(function (a, b) { return a + b.good; }, 0);
    var outToday = 0, inToday = 0;
    S.log.forEach(function (e) { if (!isToday(e.t)) return; if (e.type === 'OUT' || e.type === 'FBA') outToday += e.qty; if (e.type === 'IN' || e.type === 'RETURN') inToday += e.qty; });
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
    S.log.forEach(function (e) { if (!isToday(e.t) || e.type !== 'STAGE') return; perWorker[e.who] = (perWorker[e.who] || 0) + e.qty; });
    var wRows = S.workers.map(function (w) { return '<tr><td>' + esc(w.name) + '</td><td class="muted">' + esc(w.role) + '</td><td>' + (perWorker[w.id] || 0) + '</td></tr>'; }).join('');
    h('<div class="row" style="justify-content:space-between;align-items:center"><h2>Today at a glance</h2><div class="row"><a class="btn primary" href="#batches">New batch label</a><a class="btn dark" href="#scan">Open scan station</a></div></div>' +
      '<div class="grid">' +
      kpi(total.toLocaleString(), 'Doornets on racks', '') + kpi(out, 'Nets out of stock', out ? 'bad' : 'ok') + kpi(low, 'Below refill level', low ? 'warn' : 'ok') +
      kpi(open.length + ' · ' + inProd, 'Batches · nets in production', '') + kpi(inToday, 'In today (rack-in + returns)', '') + kpi(outToday, 'Out today (orders + FBA)', '') + '</div>' +
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
    var typ = { STAGE: 'p-mute', IN: 'p-ok', OUT: 'p-warn', FBA: 'p-warn', RETURN: 'p-ok', DAMAGED: 'p-bad', COUNT: 'p-mute', BATCH: 'p-mute' }[e.type] || 'p-mute';
    return '<tr><td class="muted">' + fmtT(e.t) + '</td><td><span class="pill ' + typ + '">' + esc(e.type) + '</span></td><td>' + esc(wname(e.who)) + '</td><td>' + (e.wo ? '<code>' + esc(e.wo) + '</code> ' : '') + esc(n ? netLabel(n) : (e.net || '')) + '</td><td>' + (e.qty != null ? e.qty : '') + '</td><td>' + (e.loc ? '<code>' + esc(e.loc) + '</code>' : '') + '</td><td class="muted">' + esc(e.note || '') + '</td></tr>';
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
    el.querySelector('#reprint').onclick = function () { printLabels([batchLabel(b)], '100x50'); };
    var tg = el.querySelector('#boxtags'); if (tg) tg.onclick = function () { var k = Math.max(1, Math.ceil(b.good / 20)), arr = []; for (var i = 0; i < k; i++) arr.push(batchLabel(b)); printLabels(arr, '100x50'); };
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
      printLabels([batchLabel(b)], '100x50');
    };
    app.querySelectorAll('[data-open]').forEach(function (x) { x.onclick = function () { renderBatchDetail(document.getElementById('batchDetail'), S.batches[x.dataset.open]); document.getElementById('batchDetail').scrollIntoView({ behavior: 'smooth' }); }; });
  }

  // ---------- scan station ----------
  var sess = { emp: null, mode: null, await: null, net: null, wo: null, loc: null, last: null };
  function viewScan() {
    h('<h2>Scan station</h2><div class="station"><div class="scanbox">' +
      '<div class="who">Scanning as <span class="name" id="who">—</span><span class="muted small" id="whoRole"></span></div>' +
      '<label class="me">I am <select id="meSel"><option value="">— pick your name —</option>' + S.workers.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === sess.emp ? ' selected' : '') + '>' + esc(w.name.replace(' (sample)', '')) + ' · ' + esc(w.role) + '</option>'; }).join('') + '</select></label>' +
      '<div class="acts" id="acts"></div>' +
      '<button type="button" class="btn camBtn" id="camBtn">Scan with camera</button>' +
      '<div class="prompt" id="prompt"></div>' +
      '<input id="scanIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan here…" aria-label="Scan input">' +
      '<div class="feedback" id="fb" role="status">Ready.</div>' +
      '<div id="adjust"></div><div id="qbar"></div>' +
      '<div class="small" style="color:#cfd6db">' + (TOUCH ? 'Tap <b>Scan with camera</b> and point at the label. You can also type a code and press Enter.' : 'Keep this box selected. The scanner types the code and presses Enter. You can also type a code and press Enter.') + '</div></div>' +
      '<details class="card"' + (TOUCH ? '' : ' open') + '><summary><h3 style="display:inline">Test without a scanner</h3></summary><div class="small muted">Tap a code to send it as if it were scanned.</div>' +
      '<div class="small"><b>1 · Worker badge</b></div><div class="sim" id="simW"></div>' +
      '<div class="small"><b>2 · Batch label</b></div><div class="sim" id="simB"></div>' +
      '<div class="small"><b>3 · Box label</b> (for rack-in and picking)</div><div class="sim" id="simL"></div>' +
      '<div class="small"><b>Commands</b></div><div class="sim" id="simC"></div>' +
      '<h3 style="margin-top:6px">How a batch moves</h3><ol class="small" style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px">' +
      '<li>Scan your <b>badge</b> once. It stays until someone else scans theirs.</li>' +
      '<li>Scan the <b>batch label</b>. The batch moves to the next step: Cut → Base → Sides → Finish → Pack, and your name is saved on that step.</li>' +
      '<li>If some nets were rejected, type the good count and press Enter (within the next scan).</li>' +
      '<li>After Pack, scan the batch, then <b>2F</b> (second floor) or an <b>empty</b> box on the rack. Stock goes up.</li>' +
      '<li>To pick: scan <b>OUT</b>, then the <b>pick box</b> (3-bin box: tap the color), then the quantity.</li>' +
      '<li>Pick box empty: scan <b>SWAP</b>, then the backup box you bring down. No backup: scan <b>EMPTY</b>, then the box.</li>' +
      '<li>Every 3–4 days: open <a href="#refill">Refill list</a>, fill each empty box from the oldest second-floor batch, scan <b>REFILL</b> and the box.</li></ol></details></div>');
    var inp = document.getElementById('scanIn');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = inp.value; inp.value = ''; handle(v); } });
    if (!TOUCH) document.addEventListener('click', refocus);
    document.getElementById('meSel').onchange = function () { var v = this.value || null; sess.emp = v; S.settings.me = v; sess.mode = null; sess.await = null; save(); if (v) fb('Hello ' + esc(wname(v)) + '.', 'ok'); paint(); };
    document.getElementById('camBtn').onclick = function () { if (window.ArmorXCam) window.ArmorXCam.open(handle); };
    document.getElementById('acts').onclick = function (e) { var b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation(); var a = b.dataset.act;
      if (a === 'CANCEL' || a === sess.mode) handle('CMD-CANCEL'); else handle('CMD-' + a); if (!TOUCH) refocus(); };
    document.getElementById('qbar').onclick = function (e) { var b = e.target.closest('[data-q]'); if (!b) return; e.stopPropagation(); handle(b.dataset.q); if (!TOUCH) refocus(); };
    function sim(id, codes) { var el = document.getElementById(id); el.innerHTML = codes.map(function (c) { return '<button type="button" data-c="' + esc(c[0]) + '" title="' + esc(c[1] || '') + '">' + esc(c[0]) + (c[1] ? ' · ' + esc(c[1]) : '') + '</button>'; }).join(''); }
    sim('simW', S.workers.map(function (w) { return [w.id, w.name.replace(' (sample)', '')]; }));
    sim('simB', Object.values(S.batches).filter(function (b) { return b.stage < 6; }).slice(-6).map(function (b) { return [b.id, SHORT[b.stage + 1] + ' next']; }));
    var picks = ['DN-210x100-BK', 'DN-210x100-GR', 'DN-200x100-BK', 'DN-250x150-GR', 'DN-210x95-BR', 'DN-205x90-GR', 'DN-210x100-BR'].map(function (id) { return [BY_ID[id].pick, BY_ID[id].size + ' ' + BY_ID[id].color]; }).concat([[FLOOR2, 'second floor']]);
    sim('simL', picks);
    sim('simC', [['CMD-OUT'], ['CMD-FBA'], ['CMD-SWAP'], ['CMD-REFILL'], ['CMD-EMPTY'], ['CMD-RETURN'], ['CMD-COUNT'], ['CMD-CANCEL'], ['QTY-1'], ['QTY-5'], ['QTY-20']]);
    app.querySelectorAll('.sim button').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); handle(b.dataset.c); if (!TOUCH) refocus(); }; });
    paint(); if (!TOUCH) inp.focus();
  }
  function refocus() { var i = document.getElementById('scanIn'); if (i && document.activeElement !== i && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.id !== 'scanIn')) i.focus(); }
  function fb(msg, kind) { var el = document.getElementById('fb'); if (el) { el.className = 'feedback ' + (kind || ''); el.innerHTML = msg; } beep(kind !== 'bad'); }
  function paint() {
    var w = worker(sess.emp);
    var who = document.getElementById('who'); if (!who) return;
    var ms = document.getElementById('meSel'); if (ms) ms.value = sess.emp || '';
    who.textContent = w ? w.name : 'nobody yet'; document.getElementById('whoRole').textContent = w ? '· ' + w.role : '';
    var p = 'Scan your worker badge';
    if (sess.emp) {
      if (sess.await === 'loc' && sess.wo) p = 'Now scan the box label for ' + esc(netLabel(BY_ID[S.batches[sess.wo].net])) + ' <span class="small">(home ' + esc(BY_ID[S.batches[sess.wo].net].home) + ')</span>';
      else if (sess.await === 'color') p = 'Which color? Tap Black, Brown or Grey below';
      else if (sess.await === 'qty') p = esc({ OUT: 'How many going out?', FBA: 'How many for FBA?', RETURN: 'How many returned?', DAMAGED: 'How many damaged?', COUNT: 'How many in total, racks plus second floor?' }[sess.mode]) + ' <span class="small">' + esc(netLabel(sess.net)) + ' · type a number or scan QTY</span>';
      else if (sess.mode) p = esc(sess.mode + ' mode · ' + MODE_HELP[sess.mode]);
      else p = 'Scan a box label or a batch label';
    }
    document.getElementById('prompt').innerHTML = p;
    var acts = document.getElementById('acts');
    if (acts) acts.innerHTML = sess.emp ? '<div class="acts-h">' + (sess.mode ? 'Doing: <b>' + esc(ACTS[sess.mode]) + '</b> · tap again to stop' : 'What are you doing? Tap one, or just scan a box and the app will ask') + '</div><div class="acts-g">' +
      ACT_ORDER.map(function (a) { return '<button type="button" class="act' + (sess.mode === a ? ' on' : '') + '" data-act="' + a + '">' + esc(ACTS[a]) + '</button>'; }).join('') + '</div>' : '';
    var qb = document.getElementById('qbar');
    if (qb) qb.innerHTML = sess.await === 'qty' ? '<div class="qbtns">' + [1, 2, 3, 4, 5, 10, 20].map(function (q) { return '<button type="button" class="act" data-q="' + q + '">' + q + '</button>'; }).join('') + '<button type="button" class="act ghost" data-q="CMD-CANCEL">Cancel</button></div><div class="small" style="color:#cfd6db">Other number: type it in the box above and press Enter.</div>' : '';
  }
  var ACTS = { OUT: 'Pick for order', FBA: 'FBA shipment', SWAP: 'Swap backup down', REFILL: 'Refill box', EMPTY: 'Box is empty', RETURN: 'Customer return', DAMAGED: 'Return, damaged', COUNT: 'Count' };
  var ACT_ORDER = ['OUT', 'SWAP', 'REFILL', 'EMPTY', 'FBA', 'RETURN', 'DAMAGED', 'COUNT'];
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
    adj.innerHTML = '<div class="acts-g">' + boxActions(code, box, list).map(function (a, i) { return '<button type="button" class="act' + (i === 0 ? ' on' : '') + '" data-do="' + a + '">' + esc(ACTS[a]) + '</button>'; }).join('') + '</div>';
    adj.querySelectorAll('[data-do]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); adj.innerHTML = ''; handle('CMD-' + b.dataset.do); scanBox(code); if (!TOUCH) refocus(); }; });
  }
  function handle(raw) {
    var code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    var adj = document.getElementById('adjust'); if (adj && !/^\d+$/.test(code)) adj.innerHTML = '';
    if (/^EMP-\d+$/.test(code)) {
      var w = worker(code); if (!w) { fb('Unknown badge <b>' + esc(code) + '</b>. ' + (sheetOn() ? 'Add it to the Workers tab of the Google Sheet.' : 'Add it in Settings.'), 'bad'); return; }
      sess.emp = code; S.settings.me = code; save(); sess.mode = null; sess.await = null; fb('Hello ' + esc(w.name) + '.', 'ok'); paint(); return;
    }
    if (code === 'CMD-CANCEL') { sess.mode = null; sess.await = null; sess.wo = null; sess.net = null; fb('Cleared.', 'ok'); paint(); return; }
    if (!sess.emp) { fb('Scan your worker badge first, so the system knows who did this.', 'bad'); return; }
    var m = /^CMD-(OUT|FBA|RETURN|DAMAGED|COUNT|SWAP|REFILL|EMPTY)$/.exec(code);
    if (m) { sess.mode = m[1]; sess.await = null; sess.wo = null; fb(esc(m[1]) + ' mode on. ' + esc(MODE_HELP[m[1]]), 'ok'); paint(); return; }
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
    var next = b.stage + 1;
    b.stage = next; b.history.push({ stage: next, by: sess.emp, qty: b.good, rej: 0, t: now() });
    addLog({ type: 'STAGE', stage: next, who: sess.emp, wo: wo, net: b.net, qty: b.good, note: STAGES[next] });
    save(); sess.last = wo;
    fb('<b>' + esc(STAGES[next]) + '</b> done for ' + esc(wo) + ' · ' + esc(netLabel(n)) + ' · ' + b.good + ' nets · by ' + esc(wname(sess.emp)), 'ok');
    var adj = document.getElementById('adjust');
    adj.innerHTML = '<div class="qtyrow"><label class="f">Good nets<input id="adjGood" type="number" min="0" value="' + b.good + '"></label><button class="btn primary" id="adjSave">Save count</button><span class="small" style="color:#cfd6db">Only if some were rejected.</span></div>';
    document.getElementById('adjSave').onclick = function (e) {
      e.stopPropagation(); var g = parseInt(document.getElementById('adjGood').value, 10); var last = b.history[b.history.length - 1];
      if (!(g >= 0) || g > last.qty + last.rej) { toast('Enter a number up to ' + (last.qty + last.rej) + '.'); return; }
      var prev = last.qty + last.rej; last.rej = prev - g; last.qty = g; b.good = g; S.log[0].qty = g; S.log[0].note = STAGES[next] + (last.rej ? ' · ' + last.rej + ' rejected' : ''); queue({ type: 'ADJUST', who: sess.emp, wo: b.id, net: b.net, qty: g, rej: prev - g, note: 'Good count corrected at ' + STAGES[next] });
      save(); adj.innerHTML = ''; fb('Saved: ' + g + ' good' + (last.rej ? ', ' + last.rej + ' rejected' : '') + '.', 'ok'); refocus();
    };
    paint();
  }
  var MODE_HELP = { OUT: 'scan the PICK box', FBA: 'scan a box label or 2F', RETURN: 'scan the PICK box', DAMAGED: 'scan the PICK box', COUNT: 'scan any box of the net',
    SWAP: 'scan the backup box you are bringing down', REFILL: 'scan the empty box you are filling from the second floor', EMPTY: 'scan the box that just went empty' };
  function fmtD(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : 'date unknown'; }
  function boxRec(code) { return S.boxes[code] || null; } // null = not tracked yet (treated as full, date unknown)
  function isEmpty(code) { var r = boxRec(code); return !!(r && r.state === 'empty'); }
  function setBox(code, rec, why) { rec.at = now(); rec.by = sess.emp; S.boxes[code] = rec; }
  function oldest2F(n) { // oldest batch that went to the second floor: refills take this first
    return Object.values(S.batches).filter(function (b) { return b.net === n.id && b.stage >= 6 && b.loc === FLOOR2; }).sort(function (a, b) { return a.created < b.created ? -1 : 1; })[0] || null;
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
    // ---- rack-in after Pack: batch goes to an EMPTY home box or to the second floor ----
    if (sess.await === 'loc' && sess.wo) {
      var b = S.batches[sess.wo], n = BY_ID[b.net];
      if (code !== FLOOR2) {
        if (!box || box.nets.indexOf(n.id) < 0) { fb('Wrong box. <code>' + esc(code) + '</code> is not a home of ' + esc(netLabel(n)) + '. Use <code>' + esc(homeOf(n).join(', ')) + '</code> or the second floor (scan <b>2F</b>).', 'bad'); return; }
        if (box.kind === 'own' && !isEmpty(code)) {
          var empt = homeOf(n).filter(isEmpty);
          fb('First made, first shipped: <code>' + esc(code) + '</code> still has older nets (' + esc(fmtD((boxRec(code) || {}).made)) + '). New nets never go on top. ' + (empt.length ? 'Use the empty box <code>' + esc(empt.join(', ')) + '</code>' : 'Put them on the second floor (scan <b>2F</b>)') + '.', 'bad'); return;
        }
      }
      b.stage = 6; b.loc = code; S.stock[n.id] = onHand(n.id) + b.good;
      if (code !== FLOOR2 && box.kind === 'own') setBox(code, { state: 'full', net: n.id, wo: b.id, made: b.created });
      b.history.push({ stage: 6, by: sess.emp, qty: b.good, rej: 0, t: now(), loc: code });
      addLog({ type: 'IN', who: sess.emp, wo: b.id, net: n.id, qty: b.good, loc: code, made: b.created, note: code === FLOOR2 ? 'Rack-in · second floor' : 'Rack-in' });
      save(); fb('<b>' + b.good + ' nets in</b> at <code>' + esc(code === FLOOR2 ? 'second floor' : code) + '</code>. ' + esc(netLabel(n)) + ' now ' + onHand(n.id) + ' in total.', 'ok');
      sess.wo = null; sess.await = null; paint(); return;
    }
    if (code === FLOOR2) {
      if (sess.mode === 'FBA') { fb('Second floor. Now scan the product or a box label of the net going to FBA.', 'warn'); return; }
      fb('<b>2F</b> is the second floor. Use it at rack-in (after Pack) for bulk stock.', 'warn'); return;
    }
    var mode = sess.mode;
    if (mode === 'SWAP') { doSwap(code, list); return; }
    if (mode === 'REFILL') { doRefill(code, list); return; }
    if (mode === 'EMPTY') {
      setBox(code, { state: 'empty' }); addLog({ type: 'EMPTY', who: sess.emp, net: list.length === 1 ? list[0].id : '', loc: code, note: 'Box empty' }); save();
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
      if (!(n.backups || []).length) { fb(esc(list.length > 1 ? n.size : netLabel(n)) + ' has no backup box. Fill it from the second floor: scan REFILL, then this box.', 'warn'); return; }
      fb(fb1.length ? 'Bring down <code>' + esc(fb1[0]) + '</code>' + ((boxRec(fb1[0]) || {}).made ? ' (made ' + esc(fmtD(boxRec(fb1[0]).made)) + ', the oldest)' : '') + ' and scan it.' : 'All backups are empty. Use REFILL from the second floor.', 'warn'); return;
    }
    var pick = n.pick, fb2 = fullBackups(n);
    if (isEmpty(code)) { fb('<code>' + esc(code) + '</code> is marked empty.' + (fb2.length ? ' Use <code>' + esc(fb2[0]) + '</code>.' : ' Fill it with REFILL.'), 'bad'); return; }
    if (fb2.length && fb2[0] !== code && (boxRec(fb2[0]) || {}).made && (boxRec(code) || {}).made && boxRec(fb2[0]).made < boxRec(code).made) {
      fb('First made, first shipped: <code>' + esc(fb2[0]) + '</code> is older (' + esc(fmtD(boxRec(fb2[0]).made)) + '). Bring that one down first.', 'bad'); return;
    }
    var rec = boxRec(code) || { state: 'full', net: n.id, made: null };
    setBox(pick, Object.assign({}, rec, { state: 'full' })); setBox(code, { state: 'empty' });
    addLog({ type: 'SWAP', who: sess.emp, net: list.length === 1 ? n.id : '', loc: code, to: pick, made: rec.made || '', note: 'Swap ' + code + ' → ' + pick });
    save(); fb('<b>Swap:</b> full box from <code>' + esc(code) + '</code> goes into <code>' + esc(pick) + '</code>. Put the empty box up in <code>' + esc(code) + '</code>. It is now on the refill list.', 'ok'); paint();
  }
  function doRefill(code, list) {
    var box = BOXES[code]; if (!box) { fb('Scan a box label.', 'bad'); return; }
    if (box.kind === 'own' && !isEmpty(code) && boxRec(code)) { fb('First made, first shipped: <code>' + esc(code) + '</code> is not empty. Never pour new nets on top. Refill it only when it is empty.', 'bad'); return; }
    var srcs = list.map(function (n) { return [n, oldest2F(n)]; });
    var made = srcs.map(function (x) { return x[1] ? x[1].created : ''; }).filter(Boolean).sort()[0] || null;
    setBox(code, { state: 'full', net: box.kind === 'own' ? list[0].id : '', wo: srcs[0][1] ? srcs[0][1].id : '', made: made });
    addLog({ type: 'REFILL', who: sess.emp, net: list.length === 1 ? list[0].id : '', loc: code, wo: srcs[0][1] ? srcs[0][1].id : '', made: made || '', note: 'Refill from second floor' + (box.kind === 'bin' ? ' · 3 bins, new nets to the back' : '') });
    save();
    fb('<b>Refill</b> <code>' + esc(code) + '</code> from the second floor' + (box.kind === 'bin' ? ': top up each color bin, new nets at the back. ' : '. ') + srcs.map(function (x) { return x[1] ? esc(x[0].color) + ': take batch <b>' + esc(x[1].id) + '</b> (made ' + esc(fmtD(x[1].created)) + ', the oldest)' : ''; }).filter(Boolean).join(' · '), 'ok'); paint();
  }
  function applyQty(q) {
    if (sess.await !== 'qty' || !sess.net) {
      var adjG = document.getElementById('adjGood');
      if (adjG) { adjG.value = q; document.getElementById('adjSave').click(); return; }
      fb('A quantity needs a box first. Scan OUT, FBA, RETURN or COUNT, then a box label.', 'bad'); return;
    }
    var n = sess.net, before = onHand(n.id), mode = sess.mode;
    if ((mode === 'OUT' || mode === 'FBA') && q > before) { fb('Only ' + before + ' on hand for ' + esc(netLabel(n)) + '. Check the box, or scan COUNT to correct it.', 'bad'); return; }
    if (mode === 'OUT' || mode === 'FBA') S.stock[n.id] = before - q;
    else if (mode === 'RETURN') S.stock[n.id] = before + q;
    else if (mode === 'COUNT') S.stock[n.id] = q;
    addLog({ type: mode, who: sess.emp, net: n.id, qty: q, loc: sess.loc, note: mode === 'COUNT' ? 'Counted (was ' + before + ')' : ({ OUT: 'Order pick', FBA: 'FBA shipment', RETURN: 'Customer return · good', DAMAGED: 'Customer return · damaged, not restocked' }[mode]) });
    save();
    var after = onHand(n.id), warn = after <= n.refillAt && (mode === 'OUT' || mode === 'FBA');
    fb('<b>' + esc(mode) + ' ' + q + '</b> · ' + esc(netLabel(n)) + ' · now ' + after + ' in total.' + (warn ? ' <b>Below refill level.</b>' : ''), warn ? 'warn' : 'ok');
    sess.await = null; sess.net = null; paint();
  }

  // ---------- stock ----------
  function walkSorted() { return NETS.slice().sort(function (a, b) { return sideOrder(a.pick, b.pick) || COLORS.indexOf(a.color) - COLORS.indexOf(b.color); }); }
  function viewStock() {
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Stock</h2><div class="row" style="align-items:flex-end"><label class="f">Search size, color or rack<input id="q" placeholder="e.g. 210x100, Grey, AR-C1"></label><button class="btn" id="cntPrint">Print count sheet</button><button class="btn primary" id="cntMode">Enter counts</button></div></div>' +
      '<div class="note small" id="cntHelp" hidden>Count mode. Type what you counted on the racks and on the second floor (2F). Only rows you fill in are saved, as COUNT scans with your name. Leave a row empty to keep it as it is.</div>' +
      '<div class="tablewrap"><table><thead id="th"></thead><tbody id="tb"></tbody></table></div><div class="row" id="cntBar" hidden style="justify-content:flex-end;margin-top:8px"><span class="small muted" id="cntMsg"></span><button class="btn" id="cntCancel">Cancel</button><button class="btn primary" id="cntSave">Save counts</button></div>');
    var counting = false;
    function draw() {
      var q = document.getElementById('q').value.trim().toLowerCase();
      var list = walkSorted().filter(function (n) { return !q || (n.size + ' ' + n.color + ' ' + n.home + ' ' + n.skus).toLowerCase().indexOf(q) >= 0; });
      document.getElementById('th').innerHTML = counting ? '<tr><th>Pick box</th><th>Net</th><th>In system</th><th>Counted on racks</th><th>Counted on 2F</th><th>New total</th></tr>'
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
      var who = sess.emp || S.settings.me || 'MANAGER', k = 0;
      app.querySelectorAll('#tb tr').forEach(function (tr) {
        var r = tr.querySelector('[data-k=r]').value, f = tr.querySelector('[data-k=f]').value;
        if (r === '' && f === '') return;
        var n = BY_ID[tr.dataset.id], before = onHand(n.id), tot = Number(r || 0) + Number(f || 0);
        S.stock[n.id] = tot; k++;
        addLog({ type: 'COUNT', who: who, net: n.id, qty: tot, loc: n.pick, note: 'Count sheet: racks ' + Number(r || 0) + ' + 2F ' + Number(f || 0) + ' (was ' + before + ')' });
      });
      save(); toast(k ? k + ' counts saved.' : 'Nothing filled in.'); setMode(false);
    };
    document.getElementById('cntPrint').onclick = function () {
      var t = document.createElement('div'); t.className = 'sheet';
      t.innerHTML = '<h3>ArmorX doornet count sheet · ' + esc(new Date().toLocaleDateString()) + ' · counted by ____________</h3><table><thead><tr><th>Pick box</th><th>Net</th><th>Backups</th><th>Racks</th><th>2F</th><th>Total</th></tr></thead><tbody>' +
        walkSorted().map(function (n) { return '<tr><td>' + esc(n.pick) + '</td><td>' + esc(netLabel(n)) + (n.kind === 'bin' ? ' (bin)' : '') + '</td><td>' + esc((n.backups || []).join(' ')) + '</td><td></td><td></td><td></td></tr>'; }).join('') + '</tbody></table>';
      printLabels([t], 'A4P');
    };
    document.getElementById('q').oninput = draw; draw();
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
      '<div class="note small">Sizes in number order. Popular sizes on R2–R4, slow sizes on R1/R5, R6 is backup only. 210×100 is in AR columns 1–3, picked from R3.</div>' +
      '<div class="legend"><span><i style="background:var(--soft-ok)"></i>Pick box, healthy</span><span><i style="background:var(--soft-warn)"></i>Low</span><span><i style="background:var(--soft-bad)"></i>Out / box empty</span><span><i style="border:1px dashed var(--ink)"></i>Backup</span></div>' +
      '<div class="card small" id="boxInfo">Tap a box to see what is in it.</div><div class="sides" id="sides"></div>');
    var out = '';
    sides.forEach(function (s) {
      var rg = RNG[s] ? RNG[s][0] + ' – ' + RNG[s][1] + (s === 'AR' ? ' + 210x100' : '') : '';
      out += '<div class="side"><div><span class="tag' + (/R$/.test(s) ? ' r' : '') + '">' + s + '</span> <span class="small muted">' + esc(rg) + '</span></div><div class="rack" style="grid-template-columns:30px repeat(' + COLS + ',minmax(0,1fr))"><div></div>';
      for (var c = 1; c <= COLS; c++) out += '<div class="h">C' + c + '</div>';
      for (var r = 6; r >= 1; r--) {
        out += '<div class="h">R' + r + '</div>';
        for (var c2 = 1; c2 <= COLS; c2++) {
          var code = s + '-C' + c2 + '-R' + r, bx = BOXES[code];
          if (!bx) { out += '<div class="bx free" data-b="' + code + '">·</div>'; continue; }
          var list = netsAt(code), n = list[0], st = isEmpty(code) ? 'out' : (bx.kind === 'bin' ? (list.some(function (x) { return status(x) === 'out'; }) ? 'out' : list.some(function (x) { return status(x) === 'low'; }) ? 'low' : 'ok') : status(n));
          out += '<div class="bx ' + st + (bx.role === 'backup' ? ' bkp' : '') + '" data-b="' + code + '" data-s="' + n.size + '" title="' + code + '"><span>' + n.size + '</span><span>' + (bx.kind === 'bin' ? '3 bins' : n.color) + (bx.role === 'backup' ? ' ·B' : '') + '</span></div>';
        }
      }
      out += '</div></div>';
    });
    document.getElementById('sides').innerHTML = out;
    app.querySelectorAll('.bx').forEach(function (b) { b.onclick = function () {
      var code = b.dataset.b, bx = BOXES[code], el = document.getElementById('boxInfo');
      if (!bx) { el.innerHTML = '<b>' + esc(code) + '</b> is free.'; return; }
      var r = boxRec(code), list = netsAt(code);
      el.innerHTML = '<b>' + esc(code) + '</b> · ' + (bx.role === 'pick' ? 'PICK' : 'BACKUP') + (bx.kind === 'bin' ? ' · 3 bins' : '') + ' · ' +
        list.map(function (n) { return esc(netLabel(n)) + ' <b>' + onHand(n.id) + '</b> in total' + (bx.mix ? ' (' + bx.mix[n.id] + ' in this box)' : ''); }).join(' · ') +
        ' · ' + (r ? (r.state === 'empty' ? '<b>empty</b>' : 'made ' + esc(fmtD(r.made))) : 'not scanned yet') + ' · home: <code>' + esc(list[0].home) + '</code>';
    }; });
    document.getElementById('rq').oninput = function () { var v = this.value.trim().toLowerCase(); app.querySelectorAll('.bx').forEach(function (b) { b.classList.toggle('hl', !!v && (b.dataset.s || '').indexOf(v) === 0); }); };
  }

  // ---------- refill list (every 3-4 days, from the second floor) ----------
  function viewRefill() {
    var empt = Object.keys(BOXES).filter(isEmpty).sort(sideOrder);
    var low = NETS.filter(function (n) { return status(n) !== 'ok'; }).sort(function (a, b) { return sideOrder(a.pick, b.pick); });
    var untracked = Object.keys(BOXES).filter(function (c) { return !boxRec(c); }).length;
    h('<h2>Refill list</h2><div class="note">Walk the racks in order (AR → AL → BR → BL → CR → CL). For each empty box, take the <b>oldest</b> batch from the second floor, fill the box, then scan <b>REFILL</b> and the box. Never pour new nets on top of old ones.</div>' +
      '<div class="card"><h3>Empty boxes to fill (' + empt.length + ')</h3><div class="tablewrap"><table><thead><tr><th>Box</th><th>Type</th><th>Net</th><th>Take from second floor</th></tr></thead><tbody>' +
      (empt.map(function (c) { var bx = BOXES[c], list = netsAt(c); return '<tr><td><code>' + c + '</code></td><td>' + (bx.role === 'pick' ? 'Pick' : 'Backup') + (bx.kind === 'bin' ? ' · 3 bins' : '') + '</td><td>' + list.map(function (n) { return '<span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + (bx.mix ? ' ×' + bx.mix[n.id] : ' ×' + bx.cap); }).join('<br>') + '</td><td>' + list.map(function (n) { var o = oldest2F(n); return o ? '<code>' + o.id + '</code> made ' + esc(fmtD(o.created)) : '<span class="muted">no batch on 2F</span>'; }).join('<br>') + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="muted">No empty boxes. Pickers scan EMPTY when a box runs out, or SWAP when they bring a backup down.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="card"><h3>Low in total, make more (' + low.length + ')</h3><div class="tablewrap"><table><thead><tr><th>Net</th><th>Pick box</th><th>In total</th><th>Refill at</th></tr></thead><tbody>' +
      low.map(function (n) { return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + n.pick + '</code></td><td>' + onHand(n.id) + '</td><td>' + n.refillAt + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      (untracked ? '<div class="small muted">' + untracked + ' boxes have not been scanned since the new layout. They count as full with an unknown date until the first REFILL, SWAP or rack-in.</div>' : ''));
  }

  // ---------- setup labels ----------
  function viewPrint() {
    var sides = window.SIDES || [];
    h('<h2>Setup labels</h2><div class="note">Print these once. Shelf labels (one per box slot, stuck on the shelf edge, never moved) and badges are 50 × 25 mm. Batch labels (100 × 50 mm) print from <a href="#batches">Batches</a>. All barcodes are Code 128, which every USB scanner reads.</div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Worker badges</h3><button class="btn primary" id="pW">Print all badges</button></div><div class="labels-preview" id="prevW"></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Command sheet</h3><button class="btn primary" id="pC">Print commands</button></div><div class="small muted">Includes the second-floor label 2F.</div><div class="labels-preview" id="prevC"></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Side signs (3 per A4)</h3><button class="btn primary" id="pS">Print all 6 signs (2 pages)</button></div><div class="small muted">One sign at the end of each rack side: the side code and its size range. Prints 3 per A4 page, portrait. Cut along the borders and laminate.</div><div class="signs-preview" id="prevS"></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Shelf labels</h3><div class="row" style="align-items:flex-end"><label class="f">Side<select id="pSide">' + sides.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary" id="pL">Print this side</button></div></div><div class="small muted" id="cntL"></div><div class="labels-preview" id="prevL"></div></div>');
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

  // ---------- settings ----------
  function viewSettings() {
    h('<h2>Settings</h2><div class="card"><h3>Workers</h3><div class="small muted">Each worker gets a badge code. Print badges from Setup labels.</div><div class="tablewrap"><table><thead><tr><th>Badge</th><th>Name</th><th>Main step</th><th></th></tr></thead><tbody id="wt"></tbody></table></div>' +
      '<form id="wAdd" class="row" style="align-items:flex-end"><label class="f">Name<input id="wName" required></label><label class="f">Main step<select id="wRole">' + STAGES.slice(1, 6).concat(['Racks & dispatch']).map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary">Add worker</button></form></div>' +
      '<div class="card"><h3>Google Sheet (shared data)</h3><div class="small muted">Connect a Google Sheet so every scan is saved there and every computer sees the same stock. Setup steps are in <code>google-sheet/SETUP.md</code>. Once connected, the sheet is the master copy.</div>' +
      '<form id="gsForm" class="row" style="align-items:flex-end"><label class="f" style="flex:1 1 360px">Web app link (ends with /exec)<input id="gsUrl" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(S.settings.sheetUrl || ARMORX_SHEET.url) + '"></label>' +
      '<label class="f">Access key<input id="gsKey" value="' + esc(S.settings.sheetKey || ARMORX_SHEET.key) + '"></label><label class="f">This computer<input id="gsStation" placeholder="e.g. Stitching PC" value="' + esc(S.settings.station || '') + '"></label>' +
      '<button class="btn primary">Connect</button>' + (sheetOn() ? '<button type="button" class="btn" id="gsOff">Disconnect</button><button type="button" class="btn" id="gsWorkers">Send workers to sheet</button>' : '') + '</form><div class="small" id="gsMsg">' + esc(syncText()) + '</div></div>' +
      '<div class="card"><h3>Data</h3><div class="small muted">Without a Google Sheet, everything stays in this browser. Back it up as a file, or start fresh before going live.</div><div class="row"><button class="btn" id="bk">Download backup</button><label class="btn">Restore backup<input type="file" id="rs" accept=".json" hidden></label><button class="btn" id="demo">Reload sample data</button><button class="btn danger" id="clr">Start fresh (empty)</button></div><div id="confirmBox"></div></div>');
    function drawW() {
      document.getElementById('wt').innerHTML = S.workers.map(function (w, i) { return '<tr><td><code>' + esc(w.id) + '</code></td><td><input data-i="' + i + '" class="wn" value="' + esc(w.name) + '" style="border:1px solid var(--line);padding:4px 6px;border-radius:2px;background:var(--surface);color:var(--ink)"></td><td>' + esc(w.role) + '</td><td>' + (S.workers.length > 1 ? '<button class="btn" data-del="' + i + '">Remove</button>' : '') + '</td></tr>'; }).join('');
      app.querySelectorAll('.wn').forEach(function (x) { x.onchange = function () { var w = S.workers[x.dataset.i]; w.name = x.value.trim() || w.name; save(); queue({ type: 'WORKER', who: w.id, name: w.name, role: w.role }); toast('Saved.'); }; });
      app.querySelectorAll('[data-del]').forEach(function (x) { x.onclick = function () { S.workers.splice(+x.dataset.del, 1); save(); drawW(); }; });
    }
    drawW();
    document.getElementById('wAdd').onsubmit = function (e) {
      e.preventDefault(); var max = S.workers.reduce(function (a, w) { return Math.max(a, parseInt(w.id.slice(4), 10) || 0); }, 0);
      var nw = { id: 'EMP-' + String(max + 1).padStart(2, '0'), name: document.getElementById('wName').value.trim(), role: document.getElementById('wRole').value }; S.workers.push(nw); save(); queue({ type: 'WORKER', who: nw.id, name: nw.name, role: nw.role }); drawW(); document.getElementById('wName').value = '';
    };
    document.getElementById('gsForm').onsubmit = function (e) {
      e.preventDefault();
      var u = document.getElementById('gsUrl').value.trim(), k = document.getElementById('gsKey').value.trim();
      S.settings.station = document.getElementById('gsStation').value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) { document.getElementById('gsMsg').textContent = 'The link should start with https://script.google.com/macros/s/ and end with /exec.'; return; }
      document.getElementById('gsMsg').textContent = 'Checking the sheet…';
      fetch(u + '?key=' + encodeURIComponent(k)).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'The sheet said no');
        S.settings.sheetUrl = u; S.settings.sheetKey = k; S.demo = false; S.queue = [];
        applyRemote(d); save(); toast('Connected to the Google Sheet.'); route();
      }).catch(function (err) { document.getElementById('gsMsg').textContent = 'Could not connect: ' + err.message + '. Check the link and access key, and that the web app is shared with "Anyone".'; });
    };
    var off = document.getElementById('gsOff'); if (off) off.onclick = function () { S.settings.sheetUrl = ''; save(); toast('Disconnected. Data now stays in this browser.'); route(); };
    var gw = document.getElementById('gsWorkers'); if (gw) gw.onclick = function () { S.workers.forEach(function (w) { queue({ type: 'WORKER', who: w.id, name: w.name, role: w.role }); }); toast('Sending ' + S.workers.length + ' workers to the sheet.'); };
    document.getElementById('bk').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = 'armorx-inventory-backup.json'; a.click(); };
    document.getElementById('rs').onchange = function () { var f = this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { try { var d = JSON.parse(r.result); if (!d.stock || !d.batches) throw 0; S = d; save(); toast('Backup restored.'); route(); } catch (e) { toast('That file is not an ArmorX backup.'); } }; r.readAsText(f); };
    function ask(msg, fn) {
      var el = document.getElementById('confirmBox');
      el.innerHTML = '<div class="note row" style="align-items:center;justify-content:space-between"><span>' + msg + '</span><span class="row"><button class="btn danger" id="yes">Yes, do it</button><button class="btn" id="no">Keep my data</button></span></div>';
      document.getElementById('yes').onclick = function () { fn(); el.innerHTML = ''; };
      document.getElementById('no').onclick = function () { el.innerHTML = ''; };
    }
    document.getElementById('demo').onclick = function () { ask('Replace everything with the sample data?', function () { var ks = S.settings; S = blank(); S.settings = ks; seedDemo(); toast('Sample data loaded.'); route(); }); };
    document.getElementById('clr').onclick = function () { ask('Delete all batches, stock and scans, and start with an empty system? Workers are kept.', function () { var w = S.workers, ks = S.settings; S = blank(); S.settings = ks; S.workers = w.map(function (x) { return { id: x.id, name: x.name.replace(' (sample)', ''), role: x.role }; }); save(); toast('Empty system ready. Count your stock with COUNT scans.'); route(); }); };
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
    if (sheetOn()) { pill.hidden = false; var w = (S.queue || []).length; pill.textContent = syncState.err ? 'SHEET OFFLINE · ' + w + ' waiting' : (w ? 'SAVING · ' + w + ' waiting' : 'SHEET · synced'); pill.style.background = syncState.err ? 'var(--bad)' : ''; pill.style.color = syncState.err ? '#fff' : ''; }
    else { pill.hidden = !S.demo; pill.textContent = 'DEMO · data stays in this browser'; pill.style.background = ''; pill.style.color = ''; }
  }
  function flush() {
    if (!sheetOn() || syncState.busy || !(S.queue || []).length) { paintSync(); return Promise.resolve(); }
    syncState.busy = true;
    var batch = S.queue.slice(0, 50);
    // text/plain keeps this a "simple" request, so Google Apps Script accepts it without a proxy.
    return fetch(S.settings.sheetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: S.settings.sheetKey, station: S.settings.station || '', events: batch }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'save failed');
        var ok = {}; (d.saved || []).forEach(function (id) { ok[id] = 1; });
        S.queue = S.queue.filter(function (ev) { return !ok[ev.id]; }); syncState.err = null; save();
      })
      .catch(function (err) { syncState.err = err.message || 'offline'; })
      .then(function () { syncState.busy = false; paintSync(); if ((S.queue || []).length && !syncState.err) return flush(); });
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
    syncState.at = d.at || now(); syncState.err = null;
  }
  function pull() {
    if (!sheetOn() || syncState.busy) return Promise.resolve(false);
    return flush().then(function () {
      if ((S.queue || []).length) return false; // never overwrite scans that are not saved yet
      return fetch(S.settings.sheetUrl + '?key=' + encodeURIComponent(S.settings.sheetKey || ''))
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d.ok) throw new Error(d.error || 'read failed'); applyRemote(d); save(); return true; })
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
  var VIEWS = { dashboard: viewDashboard, scan: viewScan, batches: viewBatches, stock: viewStock, racks: viewRacks, refill: viewRefill, pick: viewPick, print: viewPrint, log: viewLog, settings: viewSettings };
  function route() {
    document.removeEventListener('click', refocus);
    var k = (location.hash || '#dashboard').slice(1); if (!VIEWS[k]) k = 'dashboard';
    document.querySelectorAll('#tabs a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + k); });
    VIEWS[k]();
    paintSync();
  }
  window.addEventListener('hashchange', route);
  load();
  var setupM = /^#setup=([^&]+)/.exec(location.hash || '');
  if (setupM) {
    var keep = S.settings || {};
    if (S.demo || !sheetOn()) { S = blank(); S.workers = []; }
    S.settings = keep; S.settings.sheetUrl = ARMORX_SHEET.url; S.settings.sheetKey = decodeURIComponent(setupM[1]);
    if (!S.settings.station) S.settings.station = TOUCH ? 'Phone' : 'Computer';
    S.demo = false; S.queue = []; save();
    history.replaceState(null, '', location.pathname + location.search + '#scan');
    setTimeout(function () { toast('This device is now connected to the ArmorX sheet. Pick your name to start.'); }, 300);
  }
  if (S.settings && S.settings.me && worker(S.settings.me)) sess.emp = S.settings.me;
  if (!location.hash && TOUCH) history.replaceState(null, '', location.pathname + location.search + '#scan');
  route(); if (sheetOn()) pull().then(function (c) { if (sess.emp == null && S.settings.me && worker(S.settings.me)) sess.emp = S.settings.me; if (c) route(); });
  window.ArmorX = { handle: handle, state: function () { return S; } };
})();
