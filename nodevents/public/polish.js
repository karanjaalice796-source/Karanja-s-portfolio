(function () {
  var key = 'nodevents-confetti';

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function track(event) {
    var button = event.target.closest && event.target.closest('button, .button');
    if (!button) return;
    var rect = button.getBoundingClientRect();
    button.style.setProperty('--x', (event.clientX - rect.left) + 'px');
    button.style.setProperty('--y', (event.clientY - rect.top) + 'px');
  }

  document.addEventListener('pointerover', track);
  document.addEventListener('pointerout', track);

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('button, .button');
    if (!button || button.disabled || prefersReducedMotion()) return;
    var rect = button.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 2;
    var x = event.detail === 0 ? rect.width / 2 : event.clientX - rect.left;
    var y = event.detail === 0 ? rect.height / 2 : event.clientY - rect.top;
    var ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (x - size / 2) + 'px';
    ripple.style.top = (y - size / 2) + 'px';
    button.appendChild(ripple);
    ripple.addEventListener('animationend', function () { ripple.remove(); });
  });

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('button[name="status"][value="confirmed"]');
    if (!button || !document.querySelector('[data-vendor-token]')) return;
    try {
      sessionStorage.setItem(key, '1');
    } catch (error) {
      console.warn('Could not save the vendor confirmation celebration:', error);
    }
  });

  function burst() {
    var colors = ['#e5764b', '#f0b85a', '#33785b', '#6aa8d8', '#c0558a'];
    var box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    for (var index = 0; index < 70; index++) {
      var piece = document.createElement('i');
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.width = 6 + Math.random() * 6 + 'px';
      piece.style.height = 8 + Math.random() * 8 + 'px';
      piece.style.background = colors[index % colors.length];
      piece.style.animationDelay = Math.random() * 0.5 + 's';
      piece.style.animationDuration = 2 + Math.random() * 1.8 + 's';
      piece.style.setProperty('--drift', (Math.random() * 160 - 80) + 'px');
      piece.style.setProperty('--spin', (Math.random() * 900 - 450) + 'deg');
      box.appendChild(piece);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 4500);
  }

  try {
    if (sessionStorage.getItem(key)) {
      sessionStorage.removeItem(key);
      if (!prefersReducedMotion()) burst();
    }
  } catch (error) {
    console.warn('Could not load the vendor confirmation celebration:', error);
  }
})();
