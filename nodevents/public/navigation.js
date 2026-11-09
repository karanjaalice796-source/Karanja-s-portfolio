(() => {
  const menus = document.querySelectorAll('details.responsive-menu');
  if (!menus.length) return;

  const mobileViewport = window.matchMedia('(max-width: 900px)');
  const sidebarMenus = [...menus].filter((menu) => menu.classList.contains('sidebar-menu'));
  let savedBodyOverflow = '';

  const syncBodyScroll = () => {
    const drawerOpen = mobileViewport.matches && sidebarMenus.some((menu) => menu.open);
    if (drawerOpen && !document.body.classList.contains('navigation-drawer-open')) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('navigation-drawer-open');
    } else if (!drawerOpen && document.body.classList.contains('navigation-drawer-open')) {
      document.body.classList.remove('navigation-drawer-open');
      document.body.style.overflow = savedBodyOverflow;
    }
  };

  const syncMenus = () => {
    menus.forEach((menu) => {
      menu.open = !mobileViewport.matches;
    });
    syncBodyScroll();
  };

  menus.forEach((menu) => {
    menu.addEventListener('toggle', () => {
      if (mobileViewport.matches && menu.open) {
        menus.forEach((otherMenu) => {
          if (otherMenu !== menu) otherMenu.open = false;
        });
      }
      syncBodyScroll();
    });

    menu.addEventListener('click', (event) => {
      if (!mobileViewport.matches || !sidebarMenus.includes(menu)) return;
      if (!event.target.closest('a')) return;
      menu.open = false;
      syncBodyScroll();
    });
  });

  document.addEventListener('pointerdown', (event) => {
    if (!mobileViewport.matches) return;
    sidebarMenus.forEach((menu) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    syncBodyScroll();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !mobileViewport.matches) return;
    const openMenu = sidebarMenus.find((menu) => menu.open);
    if (!openMenu) return;
    openMenu.open = false;
    openMenu.querySelector('summary')?.focus();
    syncBodyScroll();
  });

  syncMenus();
  mobileViewport.addEventListener('change', syncMenus);
})();
