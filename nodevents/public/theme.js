(function () {
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  function updateToggle() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
    toggle.title = `Switch to ${isDark ? 'light' : 'dark'} mode`;
    if (themeColor) themeColor.content = isDark ? '#171a18' : '#252921';
  }

  updateToggle();
  toggle.addEventListener('click', function () {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    updateToggle();
    try {
      localStorage.setItem('nodevents-theme', theme);
    } catch (error) {
      console.error('Could not save the Nodevents theme preference:', error);
    }
  });
})();
