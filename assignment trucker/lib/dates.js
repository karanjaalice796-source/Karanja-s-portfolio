function toISO(value) {
  var d = value instanceof Date ? value : new Date(value);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function today() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dayNumber(value) {
  if (!value) return NaN;
  var parts = String(value).slice(0, 10).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function pretty(value) {
  if (!value) return 'Not set';
  var parts = String(value).slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function annotate(row, remindDays) {
  var days = Math.round((dayNumber(row.due_on) - dayNumber(toISO(today()))) / 86400000);
  var submitted = Boolean(row.submitted_at);
  var state = submitted ? 'done' : days < 0 ? 'late' : days <= Number(remindDays) ? 'soon' : 'ok';
  return Object.assign({}, row, {
    days: days,
    submitted: submitted,
    state: state,
    handedInLate: submitted && row.submitted_at && dayNumber(row.submitted_at) > dayNumber(row.due_on)
  });
}

module.exports = { toISO: toISO, today: today, pretty: pretty, annotate: annotate };