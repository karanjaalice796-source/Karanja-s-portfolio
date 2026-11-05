(function () {
  var form = document.querySelector('[data-route-distance]');
  var result = document.querySelector('[data-route-result]');
  if (!form || !result) return;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    var origin = form.elements.origin.value.trim();
    var destination = form.elements.destination.value.trim();
    result.textContent = 'Calculating driving route…';
    button.disabled = true;

    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ origin: origin, destination: destination }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Could not calculate the driving route.');
          return data;
        });
      })
      .then(function (route) {
        var kilometers = (route.distanceMeters / 1000).toFixed(1);
        var minutes = Math.ceil(route.durationSeconds / 60);
        var duration = minutes >= 60
          ? Math.floor(minutes / 60) + ' hr ' + (minutes % 60) + ' min'
          : minutes + ' min';
        result.replaceChildren();
        result.appendChild(document.createTextNode(kilometers + ' km · about ' + duration + ' by car. '));
        var link = document.createElement('a');
        link.href = route.mapsUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View route in Google Maps';
        result.appendChild(link);
      })
      .catch(function (error) {
        result.textContent = error.message || 'Could not calculate the driving route.';
      })
      .then(function () {
        button.disabled = false;
      });
  });
}());
