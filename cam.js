/* ArmorX Inventory: phone camera scanning.
   Opens the back camera full screen, reads Code 128 labels and sends each code to the
   same handle() the USB scanner uses. Stays open so a worker can scan a batch and then a box.
   Uses the phone's built-in barcode reader when there is one (Android Chrome), otherwise ZXing (iPhone). */
(function () {
  'use strict';
  var el, video, msg, prompt, stream, reader, timer, onCode, lastCode = '', lastAt = 0, busy = false;

  function build() {
    el = document.createElement('div');
    el.className = 'cam';
    el.innerHTML =
      '<video playsinline muted autoplay></video>' +
      '<div class="cam-aim"></div>' +
      '<div class="cam-top"><div class="cam-prompt"></div><button type="button" class="cam-close" aria-label="Close camera">Done</button></div>' +
      '<div class="cam-msg" role="status">Point the camera at a label</div>';
    document.body.appendChild(el);
    video = el.querySelector('video');
    msg = el.querySelector('.cam-msg');
    prompt = el.querySelector('.cam-prompt');
    el.querySelector('.cam-close').onclick = close;
  }

  function mirror() {
    var p = document.getElementById('prompt'), f = document.getElementById('fb');
    if (p) prompt.innerHTML = p.innerHTML;
    if (f) { msg.innerHTML = f.innerHTML; msg.className = 'cam-msg ' + f.className.replace('feedback', '').trim(); }
  }

  function got(text) {
    var code = String(text || '').trim().toUpperCase(), t = Date.now();
    if (!code || busy) return;
    if (code === lastCode && t - lastAt < 2500) return; // same label still in view
    if (t - lastAt < 900) return;
    lastCode = code; lastAt = t; busy = true;
    if (navigator.vibrate) navigator.vibrate(60);
    el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 180);
    try { onCode(code); } finally { mirror(); setTimeout(function () { busy = false; }, 400); }
  }

  function camera() {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (s) { stream = s; video.srcObject = s; return video.play(); });
  }

  function startNative() {
    var det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code'] });
    return camera().then(function () {
      timer = setInterval(function () {
        if (video.readyState < 2) return;
        det.detect(video).then(function (codes) { if (codes && codes[0]) got(codes[0].rawValue); }).catch(function () {});
      }, 160);
    });
  }

  // ZXing: copy each frame to a canvas and decode it (more reliable than ZXing's own video loop).
  function startZXing() {
    if (!window.ZXing) return Promise.reject(new Error('Scanner library did not load'));
    var Z = window.ZXing, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.QR_CODE]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    reader = new Z.MultiFormatReader(); reader.setHints(hints);
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    return camera().then(function () {
      timer = setInterval(function () {
        var w = video.videoWidth, h = video.videoHeight;
        if (!w || video.readyState < 2) return;
        canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
        try {
          var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
          got(reader.decode(bmp).getText());
        } catch (e) { /* no code in this frame */ }
        finally { try { reader.reset(); } catch (e2) {} }
      }, 220);
    });
  }

  function pickEngine() {
    if (!('BarcodeDetector' in window)) return Promise.resolve(startZXing);
    return window.BarcodeDetector.getSupportedFormats()
      .then(function (f) { return f.indexOf('code_128') >= 0 ? startNative : startZXing; })
      .catch(function () { return startZXing; });
  }

  function open(handler) {
    onCode = handler;
    if (!el) build();
    el.hidden = false; document.body.classList.add('cam-on');
    mirror();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'This browser cannot use the camera. Open the link in Chrome (Android) or Safari (iPhone).';
      return;
    }
    pickEngine().then(function (start) { return start(); }).catch(function (err) {
      var n = err && err.name;
      msg.textContent = n === 'NotAllowedError' ? 'Camera permission was blocked. Allow the camera for this site in the browser settings, then try again.'
        : n === 'NotFoundError' ? 'No camera found on this device.'
        : 'Could not start the camera: ' + ((err && err.message) || err);
      msg.className = 'cam-msg bad';
    });
  }

  function close() {
    clearInterval(timer); timer = null;
    reader = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (video) video.srcObject = null;
    if (el) el.hidden = true;
    document.body.classList.remove('cam-on');
  }

  window.ArmorXCam = { open: open, close: close, feed: got };
})();
