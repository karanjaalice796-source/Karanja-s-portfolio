const authTabs = document.querySelectorAll('[data-auth-tab]');
const authPanels = document.querySelectorAll('[data-auth-panel]');

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const selectedMode = tab.dataset.authTab;
    authTabs.forEach((authTab) => {
      const selected = authTab === tab;
      authTab.setAttribute('aria-selected', String(selected));
      authTab.tabIndex = selected ? 0 : -1;
    });
    authPanels.forEach((panel) => {
      panel.hidden = panel.dataset.authPanel !== selectedMode;
    });
  });
});

document.querySelectorAll('[data-auth-submit]').forEach((button) => {
  const form = button.form;
  if (!form) return;

  const label = button.textContent;
  form.addEventListener('submit', () => {
    button.disabled = true;
    button.textContent = button.dataset.loadingLabel || 'Please wait...';
    form.setAttribute('aria-busy', 'true');
  });

  window.addEventListener('pageshow', () => {
    button.disabled = false;
    button.textContent = label;
    form.removeAttribute('aria-busy');
  });
});
