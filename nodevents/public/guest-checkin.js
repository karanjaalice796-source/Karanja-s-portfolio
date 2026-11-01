(function () {
  var video = document.querySelector('[data-checkin-video]');
  var startButton = document.querySelector('[data-start-scanner]');
  var stopButton = document.querySelector('[data-stop-scanner]');
  var status = document.querySelector('[data-scanner-status]');
  var form = document.querySelector('.manual-checkin');
  if (!video || !startButton || !stopButton || !status || !form) return;

  var eventId = document.querySelector('[data-event-id]').getAttribute('data-event-id');
  var isTicketCheckin = form.dataset.checkinMode === 'ticket';
  var tokenField = isTicketCheckin ? 'qr_token' : 'checkin_token';
  var attendeeType = isTicketCheckin ? 'ticket' : 'guest';
  var stream = null;
  var scanning = false;
  var detector = null;

  function stopScanner() {
    scanning = false;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    video.srcObject = null;
    startButton.disabled = false;
    stopButton.disabled = true;
  }

  async function submitCheckin(token) {
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      status.textContent = 'The scanned QR code is not a valid ' + attendeeType + ' code.';
      return;
    }
    scanning = false;
    status.textContent = 'Checking in ' + attendeeType + '…';
    try {
      var endpoint = isTicketCheckin ? '/tickets/check-in' : '/guests/check-in';
      var response = await fetch('/events/' + encodeURIComponent(eventId) + endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams({ [tokenField]: token }),
        credentials: 'same-origin',
      });
      var result = await response.json();
      if (!response.ok) {
        status.textContent = result.error || 'Could not check in this guest.';
        scanning = Boolean(stream);
        return;
      }
      status.textContent = result.message;
      stopScanner();
      window.setTimeout(function () { window.location.reload(); }, 900);
    } catch (error) {
      console.error('Guest check-in failed:', error);
      status.textContent = 'Could not reach the server. Check your connection and try again.';
      scanning = Boolean(stream);
    }
  }

  async function scanFrame() {
    if (!scanning || !stream) return;
    if (video.readyState >= 2) {
      try {
        var codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) {
          await submitCheckin(codes[0].rawValue);
          if (!scanning) return;
        }
      } catch (error) {
        console.error('QR scan failed:', error);
        status.textContent = 'Could not read that QR code. Hold it steady and try again.';
      }
    }
    if (scanning) window.requestAnimationFrame(scanFrame);
  }

  startButton.addEventListener('click', async function () {
    if (!window.BarcodeDetector) {
      status.textContent = 'QR scanning is not supported in this browser. Enter the code manually or use a recent Chrome or Edge browser.';
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = 'Camera access is unavailable. Use HTTPS or localhost, or enter the code manually.';
      return;
    }
    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      startButton.disabled = true;
      stopButton.disabled = false;
      status.textContent = 'Camera is ready. Hold a ' + attendeeType + ' check-in QR code in view.';
      window.requestAnimationFrame(scanFrame);
    } catch (error) {
      console.error('Guest check-in camera could not start:', error);
      stopScanner();
      status.textContent = error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access or enter the code manually.'
        : 'Could not start the camera. Use HTTPS or localhost, or enter the code manually.';
    }
  });

  stopButton.addEventListener('click', function () {
    stopScanner();
    status.textContent = 'Scanner is stopped.';
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var token = new FormData(form).get(tokenField);
    submitCheckin(String(token || '').trim());
  });

  window.addEventListener('pagehide', stopScanner);
})();
