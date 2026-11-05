(function () {
  const eventElement = document.querySelector('[data-event-id]');
  const vendorElement = document.querySelector('[data-vendor-token]');
  const clientElement = document.querySelector('[data-client-token]');
  if (!eventElement && !vendorElement && !clientElement) return;

  const socket = io();
  socket.on('connect', function () {
    if (eventElement) socket.emit('join:event', Number(eventElement.dataset.eventId));
    if (vendorElement) socket.emit('join:vendor', vendorElement.dataset.vendorToken);
    if (clientElement) socket.emit('join:client', clientElement.dataset.clientToken);
  });
  socket.on('update', function (data) {
    if (data.attendance) {
      const checkedIn = document.querySelector('[data-live-checked-in]');
      const registered = document.querySelector('[data-live-registered]');
      const awaitingPayment = document.querySelector('[data-live-awaiting-payment]');
      if (checkedIn) checkedIn.textContent = data.attendance.checkedIn;
      if (registered) registered.textContent = data.attendance.confirmed;
      if (awaitingPayment) awaitingPayment.textContent = data.attendance.awaitingPayment;
    }
    let banner = document.getElementById('live-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'live-banner';
      banner.setAttribute('role', 'status');
      document.body.appendChild(banner);
    }
    banner.replaceChildren(document.createTextNode(`${data.message} `));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Refresh';
    button.addEventListener('click', function () { location.reload(); });
    banner.appendChild(button);
    if (clientElement && data.refresh) {
      if (typeof window.refreshClientPortal === 'function') {
        window.refreshClientPortal();
      } else {
        button.textContent = 'Refreshing…';
        button.disabled = true;
        setTimeout(function () { location.reload(); }, 1200);
      }
    }
  });
})();
