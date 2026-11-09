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
  var BY_ID = {}, BY_BOX = {};
  NETS.forEach(function (n) {
    BY_ID[n.id] = n;
    n.boxes.forEach(function (b) { BY_BOX[b] = n; });
    n.reserve.forEach(function (b) { BY_BOX[b] = n; });
  });
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
    ], settings: { batchSize: '100x50' }, demo: false };
  }
  var S;
  function load() {
    try { var raw = localStorage.getItem(KEY); S = raw ? JSON.parse(raw) : null; } catch (e) { S = null; }
    if (!S) { S = blank(); seedDemo(); }
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
        b.stage = 6; b.loc = n.boxes[0]; S.stock[b.net] = onHand(b.net) + b.good;
        b.history.push({ stage: 6, by: 'EMP-06', qty: b.good, rej: 0, t: t6, loc: b.loc });
        addLog({ t: t6, type: 'IN', who: 'EMP-06', wo: b.id, net: b.net, qty: b.good, loc: b.loc, note: 'Rack-in' });
      }
    });
    [['DN-210x100-GR', 6, 'OUT'], ['DN-205x100-BR', 2, 'OUT'], ['DN-210x100-BK', 40, 'FBA'], ['DN-200x90-GR', 1, 'RETURN']].forEach(function (o, i) {
      var n = BY_ID[o[0]]; if (!n) return;
      var q = o[2] === 'RETURN' ? o[1] : -o[1];
      S.stock[n.id] = Math.max(0, onHand(n.id) + q);
      addLog({ t: new Date(Date.now() - (i + 1) * 1000 * 60 * 23).toISOString(), type: o[2], who: 'EMP-06', net: n.id, qty: o[1], loc: n.boxes[0], note: o[2] === 'FBA' ? 'FBA shipment' : (o[2] === 'OUT' ? 'Order pick' : 'Customer return · good') });
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
      '<div class="t"><b style="font-size:10pt">' + esc(b.id) + '</b><span class="home">RACK: ' + esc(n.home) + '</span></div>' +
      '<div class="ticks">' + SHORT.slice(1).map(function (s) { return '<span>' + s + '</span>'; }).join('') + '</div>';
    barcode(el.querySelector('.bc'), b.id, { height: 34, width: 2.2 }, '10mm');
    return el;
  }
  function boxLabel(code) {
    var n = BY_BOX[code], el = document.createElement('div'), res = /R6$/.test(code);
    el.className = 'lbl lbl-loc';
    el.innerHTML = '<div class="stripe ' + esc(n ? n.color : '') + '"></div><div class="code">' + esc(code) + '</div>' +
      '<div class="sub"><span>' + esc(n ? netLabel(n) : 'free') + '</span><span>' + (res ? 'RESERVE 25' : 'BOX 20') + '</span></div><svg class="bc"></svg>';
    barcode(el.querySelector('.bc'), code, { height: 30, width: 1.6 }, '8mm');
    return el;
  }
  function badgeLabel(w) {
    var el = document.createElement('div'); el.className = 'lbl lbl-badge';
    el.innerHTML = '<div class="sub mono" style="font-size:6.5pt">ARMORX · WORKER</div><div class="nm">' + esc(w.name) + '</div><div class="mono" style="font-size:6.5pt">' + esc(w.id) + ' · ' + esc(w.role) + '</div><svg class="bc"></svg>';
    barcode(el.querySelector('.bc'), w.id, { height: 30, width: 2 }, '9mm');
    return el;
  }
  var COMMANDS = [['CMD-OUT', 'OUT · order pick'], ['CMD-FBA', 'OUT · FBA shipment'], ['CMD-RETURN', 'RETURN · back to stock'], ['CMD-DAMAGED', 'RETURN · damaged'], ['CMD-COUNT', 'COUNT · correct stock'], ['CMD-CANCEL', 'CANCEL · clear'], ['QTY-1', 'Qty 1'], ['QTY-5', 'Qty 5'], ['QTY-10', 'Qty 10'], ['QTY-20', 'Qty 20'], ['QTY-25', 'Qty 25']];
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
    var dim = size === '50x25' ? '50mm 25mm' : '100mm 50mm';
    st.textContent = '@page{size:' + dim + ';margin:0}';
    toast('Opening print dialog: pick the thermal printer and paper ' + dim.replace(/ /, ' × ') + ', margins none.');
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
      return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + esc(n.boxes[0]) + '</code></td><td>' + onHand(n.id) + '</td><td>' + (n.perDay || '—') + '</td><td><span class="pill ' + (st === 'out' ? 'p-bad">Out' : 'p-warn">Low') + '</span></td><td><button class="btn" data-make="' + n.id + '" data-qty="' + need + '">Make ' + need + '</button></td></tr>';
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
    el.innerHTML = '<div class="row" style="justify-content:space-between"><h3>' + b.id + ' · ' + esc(netLabel(n)) + ' · ' + b.qty + ' nets</h3><button class="btn primary" id="reprint">Print label</button></div>' + stepsHtml(b) +
      '<div class="row"><div id="lblPrev"></div><div class="tablewrap" style="flex:1"><table><thead><tr><th>Step</th><th>Who</th><th>Good</th><th>Rejected</th><th>When</th></tr></thead><tbody>' +
      b.history.map(function (x) { return '<tr><td>' + esc(STAGES[x.stage]) + (x.loc ? ' <code>' + esc(x.loc) + '</code>' : '') + '</td><td>' + esc(wname(x.by)) + '</td><td>' + x.qty + '</td><td>' + (x.rej || '') + '</td><td class="muted">' + fmtT(x.t) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    el.querySelector('#lblPrev').appendChild(batchLabel(b));
    el.querySelector('#reprint').onclick = function () { printLabels([batchLabel(b)], '100x50'); };
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
      '<button type="button" class="btn camBtn" id="camBtn">Scan with camera</button>' +
      '<div class="prompt" id="prompt"></div>' +
      '<input id="scanIn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan here…" aria-label="Scan input">' +
      '<div class="feedback" id="fb" role="status">Ready.</div>' +
      '<div id="adjust"></div>' +
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
      '<li>After Pack, scan the batch, then the <b>box label</b> on the rack. Stock goes up.</li>' +
      '<li>To ship: scan <b>OUT</b> (or <b>FBA</b>), then each box label, then the quantity.</li></ol></details></div>');
    var inp = document.getElementById('scanIn');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = inp.value; inp.value = ''; handle(v); } });
    if (!TOUCH) document.addEventListener('click', refocus);
    document.getElementById('meSel').onchange = function () { var v = this.value || null; sess.emp = v; S.settings.me = v; sess.mode = null; sess.await = null; save(); if (v) fb('Hello ' + esc(wname(v)) + '.', 'ok'); paint(); };
    document.getElementById('camBtn').onclick = function () { if (window.ArmorXCam) window.ArmorXCam.open(handle); };
    function sim(id, codes) { var el = document.getElementById(id); el.innerHTML = codes.map(function (c) { return '<button type="button" data-c="' + esc(c[0]) + '" title="' + esc(c[1] || '') + '">' + esc(c[0]) + (c[1] ? ' · ' + esc(c[1]) : '') + '</button>'; }).join(''); }
    sim('simW', S.workers.map(function (w) { return [w.id, w.name.replace(' (sample)', '')]; }));
    sim('simB', Object.values(S.batches).filter(function (b) { return b.stage < 6; }).slice(-6).map(function (b) { return [b.id, SHORT[b.stage + 1] + ' next']; }));
    var picks = ['DN-210x100-BK', 'DN-210x100-GR', 'DN-200x100-BK', 'DN-250x150-GR', 'DN-210x95-BR', 'DN-205x90-GR', 'DN-210x100-BR'].map(function (id) { return [BY_ID[id].boxes[0], BY_ID[id].size + ' ' + BY_ID[id].color]; });
    sim('simL', picks);
    sim('simC', [['CMD-OUT'], ['CMD-FBA'], ['CMD-RETURN'], ['CMD-COUNT'], ['CMD-CANCEL'], ['QTY-1'], ['QTY-5'], ['QTY-20']]);
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
      else if (sess.await === 'qty') p = esc({ OUT: 'How many going out?', FBA: 'How many for FBA?', RETURN: 'How many returned?', DAMAGED: 'How many damaged?', COUNT: 'How many are in the box now?' }[sess.mode]) + ' <span class="small">' + esc(netLabel(sess.net)) + ' · type a number or scan QTY</span>';
      else if (sess.mode) p = esc({ OUT: 'OUT mode · scan a box label', FBA: 'FBA mode · scan a box label', RETURN: 'RETURN mode · scan the box label', DAMAGED: 'DAMAGED mode · scan the box label', COUNT: 'COUNT mode · scan a box label' }[sess.mode]);
      else p = 'Scan a batch label, a box label or a command';
    }
    document.getElementById('prompt').innerHTML = p;
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
    var m = /^CMD-(OUT|FBA|RETURN|DAMAGED|COUNT)$/.exec(code);
    if (m) { sess.mode = m[1]; sess.await = null; sess.wo = null; fb(esc(m[1]) + ' mode on. Scan a box label.', 'ok'); paint(); return; }
    var q = /^QTY-(\d+)$/.exec(code) || (/^\d+$/.test(code) ? [code, code] : null);
    if (q) { applyQty(parseInt(q[1], 10)); return; }
    if (/^WO-\d+$/.test(code)) { scanBatch(code); return; }
    if (BY_BOX[code] || BY_ID[code]) { scanBox(code); return; }
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
  function scanBox(code) {
    var n = BY_BOX[code] || BY_ID[code];
    if (sess.await === 'loc' && sess.wo) {
      var b = S.batches[sess.wo];
      if (b.net !== n.id) { fb('Wrong box. <code>' + esc(code) + '</code> is ' + esc(netLabel(n)) + '. This batch goes to <code>' + esc(BY_ID[b.net].home) + '</code>.', 'bad'); return; }
      b.stage = 6; b.loc = code; S.stock[n.id] = onHand(n.id) + b.good;
      b.history.push({ stage: 6, by: sess.emp, qty: b.good, rej: 0, t: now(), loc: code });
      addLog({ type: 'IN', who: sess.emp, wo: b.id, net: n.id, qty: b.good, loc: code, note: 'Rack-in' });
      save(); fb('<b>' + b.good + ' nets in</b> at <code>' + esc(code) + '</code>. ' + esc(netLabel(n)) + ' now ' + onHand(n.id) + ' on hand.', 'ok');
      sess.wo = null; sess.await = null; paint(); return;
    }
    if (sess.mode) { sess.net = n; sess.loc = BY_BOX[code] ? code : n.boxes[0]; sess.await = 'qty'; fb(esc(netLabel(n)) + ' · ' + onHand(n.id) + ' on hand. Enter the quantity.', 'ok'); paint(); return; }
    fb('<code>' + esc(code) + '</code> · ' + esc(netLabel(n)) + ' · <b>' + onHand(n.id) + ' on hand</b> · refill at ' + n.refillAt + '. Scan OUT, FBA, RETURN or COUNT first to change stock.', 'warn');
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
    fb('<b>' + esc(mode) + ' ' + q + '</b> · ' + esc(netLabel(n)) + ' · now ' + after + ' on hand.' + (warn ? ' <b>Below refill level.</b>' : ''), warn ? 'warn' : 'ok');
    sess.await = null; sess.net = null; paint();
  }

  // ---------- stock ----------
  function viewStock() {
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Stock</h2><label class="f">Search size, color or rack<input id="q" placeholder="e.g. 210x100, Grey, AR-C1"></label></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Net</th><th>Rack location</th><th>On hand</th><th>Space</th><th>Refill at</th><th>Sells / day</th><th>Days left</th><th>Status</th><th>Amazon SKUs</th></tr></thead><tbody id="tb"></tbody></table></div>');
    function draw() {
      var q = document.getElementById('q').value.trim().toLowerCase();
      document.getElementById('tb').innerHTML = NETS.filter(function (n) { return !q || (n.size + ' ' + n.color + ' ' + n.home + ' ' + n.skus).toLowerCase().indexOf(q) >= 0; }).map(function (n) {
        var oh = onHand(n.id), st = status(n), days = n.perDay ? Math.floor(oh / n.perDay) : '—';
        return '<tr><td><span class="sw sw-' + n.color + '"></span>' + esc(netLabel(n)) + '</td><td><code>' + esc(n.home) + '</code></td><td><b>' + oh + '</b></td><td>' + n.cap + '</td><td>' + n.refillAt + '</td><td>' + (n.perDay || '—') + '</td><td>' + days + '</td><td><span class="pill ' + (st === 'out' ? 'p-bad">Out' : st === 'low' ? 'p-warn">Low' : 'p-ok">OK') + '</span></td><td class="muted small">' + esc(n.skus) + '</td></tr>';
      }).join('');
    }
    document.getElementById('q').oninput = draw; draw();
  }

  // ---------- rack map ----------
  function viewRacks() {
    var sides = window.SIDES || [], COLS = window.RACK_COLS || 6;
    h('<div class="row" style="justify-content:space-between;align-items:flex-end"><h2>Rack map</h2><label class="f">Find a net<input id="rq" placeholder="e.g. 205x90"></label></div>' +
      '<div class="legend"><span><i style="background:var(--soft-ok)"></i>Healthy</span><span><i style="background:var(--soft-warn)"></i>Below refill level</span><span><i style="background:var(--soft-bad)"></i>Empty</span><span><i style="border:1px dashed var(--line)"></i>Reserve (row 6) / free</span></div>' +
      '<div class="card small" id="boxInfo">Tap a box to see what is in it.</div><div class="sides" id="sides"></div>');
    var out = '';
    sides.forEach(function (s) {
      out += '<div class="side"><div><span class="tag' + (/R$/.test(s) ? ' r' : '') + '">' + s + '</span> <span class="small muted">Rack ' + s[0] + ', ' + (/R$/.test(s) ? 'right' : 'left') + ' side</span></div><div class="rack"><div></div>';
      for (var c = 1; c <= COLS; c++) out += '<div class="h">C' + c + '</div>';
      for (var r = 6; r >= 1; r--) {
        out += '<div class="h">R' + r + '</div>';
        for (var c2 = 1; c2 <= COLS; c2++) {
          var code = s + '-C' + c2 + '-R' + r, n = BY_BOX[code];
          if (!n) { out += '<div class="bx free" data-b="' + code + '">' + (r === 6 ? '' : '·') + '</div>'; continue; }
          var cls = r === 6 ? 'res' : status(n);
          out += '<div class="bx ' + cls + '" data-b="' + code + '" data-s="' + n.size + '" title="' + code + ' · ' + netLabel(n) + '"><span>' + n.size + '</span><span>' + n.color[0] + (r === 6 ? '·R' : '') + '</span></div>';
        }
      }
      out += '</div></div>';
    });
    document.getElementById('sides').innerHTML = out;
    app.querySelectorAll('.bx').forEach(function (b) { b.onclick = function () {
      var n = BY_BOX[b.dataset.b], el = document.getElementById('boxInfo');
      el.innerHTML = n ? '<b>' + esc(b.dataset.b) + '</b> · ' + esc(netLabel(n)) + ' · <b>' + onHand(n.id) + ' on hand</b> (space ' + n.cap + ', refill at ' + n.refillAt + ') · all boxes: <code>' + esc(n.home) + '</code>' + (n.reserve.length ? ' · reserve <code>' + esc(n.reserve.join(', ')) + '</code>' : '') : '<b>' + esc(b.dataset.b) + '</b> is free.';
    }; });
    document.getElementById('rq').oninput = function () { var v = this.value.trim().toLowerCase(); app.querySelectorAll('.bx').forEach(function (b) { b.classList.toggle('hl', !!v && (b.dataset.s || '').indexOf(v) === 0); }); };
  }

  // ---------- setup labels ----------
  function viewPrint() {
    var sides = window.SIDES || [];
    h('<h2>Setup labels</h2><div class="note">Print these once. Box labels and badges are 50 × 25 mm. Batch labels (100 × 50 mm) print from <a href="#batches">Batches</a>. All barcodes are Code 128, which every USB scanner reads.</div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Worker badges</h3><button class="btn primary" id="pW">Print all badges</button></div><div class="labels-preview" id="prevW"></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h3>Command sheet</h3><button class="btn primary" id="pC">Print commands</button></div><div class="labels-preview" id="prevC"></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end"><h3>Box labels</h3><div class="row" style="align-items:flex-end"><label class="f">Side<select id="pSide">' + sides.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label><button class="btn primary" id="pL">Print this side</button></div></div><div class="small muted" id="cntL"></div><div class="labels-preview" id="prevL"></div></div>');
    S.workers.forEach(function (w) { document.getElementById('prevW').appendChild(badgeLabel(w)); });
    COMMANDS.forEach(function (c) { document.getElementById('prevC').appendChild(cmdLabel(c)); });
    function codesFor(side) { return Object.keys(BY_BOX).filter(function (k) { return k.indexOf(side + '-') === 0; }).sort(function (a, b) { var x = a.match(/C(\d)-R(\d)/), y = b.match(/C(\d)-R(\d)/); return x[1] - y[1] || y[2] - x[2]; }); }
    function drawL() { var side = document.getElementById('pSide').value, codes = codesFor(side), el = document.getElementById('prevL'); el.innerHTML = ''; codes.slice(0, 12).forEach(function (c) { el.appendChild(boxLabel(c)); }); document.getElementById('cntL').textContent = codes.length + ' labels on side ' + side + (codes.length > 12 ? ' (showing the first 12)' : '') + '.'; }
    document.getElementById('pSide').onchange = drawL; drawL();
    document.getElementById('pW').onclick = function () { printLabels(S.workers.map(badgeLabel), '50x25'); };
    document.getElementById('pC').onclick = function () { printLabels(COMMANDS.map(cmdLabel), '50x25'); };
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
      if (changed && ['dashboard', 'stock', 'racks', 'log'].indexOf(k) >= 0) route();
    });
  }, 20000);

  // ---------- router ----------
  var VIEWS = { dashboard: viewDashboard, scan: viewScan, batches: viewBatches, stock: viewStock, racks: viewRacks, print: viewPrint, log: viewLog, settings: viewSettings };
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
