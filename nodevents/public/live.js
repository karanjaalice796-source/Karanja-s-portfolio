(function () {
  const eventElement = document.querySelector('[data-event-id]');
  const vendorElement = document.querySelector('[data-vendor-token]');
  if (!eventElement && !vendorElement) return;

  const socket = io();
  socket.on('connect', function () {
    if (eventElement) socket.emit('join:event', Number(eventElement.dataset.eventId));
    if (vendorElement) socket.emit('join:vendor', vendorElement.dataset.vendorToken);
  });
  socket.on('update', function (data) {
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
  });
})();
