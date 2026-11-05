(function () {
  var root = document.querySelector('[data-client-token]');
  if (!root) return;
  var token = root.getAttribute('data-client-token');
  var nameKey = 'portalName:' + token;
  var savedName = '';

  try {
    savedName = localStorage.getItem(nameKey) || '';
  } catch (error) {
    console.warn('Could not read the saved client portal name:', error);
  }

  function fillNames(scope) {
    if (!savedName) return;
    scope.querySelectorAll('input[name="approved_by"], input[name="sender_name"]').forEach(function (input) {
      if (!input.value) {
        input.value = savedName;
        input.defaultValue = savedName;
      }
    });
  }

  document.addEventListener('input', function (event) {
    var input = event.target;
    if (!input || (input.name !== 'approved_by' && input.name !== 'sender_name')) return;
    savedName = input.value;
    try {
      localStorage.setItem(nameKey, savedName);
    } catch (error) {
      console.warn('Could not save the client portal name:', error);
    }
  });

  function localTimes(scope) {
    scope.querySelectorAll('[data-utc], [data-local-time]').forEach(function (element) {
      var value = element.getAttribute('data-utc') || element.getAttribute('data-local-time');
      var date = new Date(value.replace(' ', 'T') + (element.hasAttribute('data-utc') ? 'Z' : ''));
      if (!Number.isNaN(date.getTime())) {
        element.textContent = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      }
    });
  }

  function isBusy(section) {
    var active = document.activeElement;
    if (active && section.contains(active) && /^(INPUT|TEXTAREA|BUTTON)$/.test(active.tagName)) return true;
    if (section.querySelector('details[open]')) return true;
    return Array.prototype.some.call(section.querySelectorAll('textarea, input:not([type="hidden"])'), function (input) {
      return input.value !== input.defaultValue;
    });
  }

  var loading = false;
  function refresh() {
    if (loading) return;
    loading = true;
    fetch(location.pathname, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Client portal refresh returned HTTP ' + response.status);
        return response.text();
      })
      .then(function (html) {
        var next = new DOMParser().parseFromString(html, 'text/html');
        document.querySelectorAll('[data-live]').forEach(function (current) {
          var updated = next.getElementById(current.id);
          if (!updated || isBusy(current) || current.innerHTML === updated.innerHTML) return;
          current.innerHTML = updated.innerHTML;
          fillNames(current);
          localTimes(current);
        });
      })
      .catch(function (error) {
        console.error('Could not refresh the client event portal:', error);
      })
      .then(function () {
        loading = false;
      });
  }

  fillNames(document);
  localTimes(document);
  window.refreshClientPortal = refresh;
  window.setInterval(refresh, 30000);
})();
