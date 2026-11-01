(function () {
  var themeButton = document.querySelector('.theme-toggle');
  var root = document.documentElement;

  function setTheme(theme, save) {
    root.dataset.theme = theme;
    if (!themeButton) return;
    var nextLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeButton.setAttribute('aria-label', nextLabel);
    themeButton.setAttribute('title', nextLabel);
    themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
    if (save) {
      try {
        localStorage.setItem('assignment-tracker-theme', theme);
      } catch (error) {
        console.warn('Could not save the selected color theme.', error);
      }
    }
  }

  if (themeButton) {
    setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light', false);
    themeButton.addEventListener('click', function () {
      setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });
  }

  document.querySelectorAll('.password-toggle').forEach(function (button) {
    button.addEventListener('click', function () {
      var field = document.getElementById(button.getAttribute('aria-controls'));
      if (!field) return;
      var visible = field.type === 'password';
      field.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Hide' : 'Show';
      button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', String(visible));
    });
  });
}());
