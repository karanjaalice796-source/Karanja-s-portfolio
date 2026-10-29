(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var form = document.getElementById('new');
  function openForm() {
    if (!form) return;
    form.open = true;
    var field = form.querySelector('input');
    if (field) setTimeout(function () { field.focus({ preventScroll: true }); }, 60);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a[href="#new"]')) openForm();
  });
  if (location.hash === '#new') openForm();

  if (reduce) return;
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var end = parseInt(el.getAttribute('data-count'), 10);
    if (!end) return;
    var start = null;
    el.textContent = '0';
    function step(t) {
      if (start === null) start = t;
      var p = Math.min((t - start) / 700, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
})();
