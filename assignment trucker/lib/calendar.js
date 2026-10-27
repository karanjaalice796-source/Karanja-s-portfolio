function dateKey(value) {
  if (value instanceof Date) {
    return value.getUTCFullYear() + '-' + String(value.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(value.getUTCDate()).padStart(2, '0');
  }
  return String(value).slice(0, 10);
}

function buildCalendar(year, month, assignments, today) {
  var first = new Date(year, month - 1, 1);
  var firstWeekday = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(year, month, 0).getDate();
  var cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  var grouped = Object.create(null);
  assignments.forEach(function (assignment) {
    var key = dateKey(assignment.due_on);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(assignment);
  });
  var cells = [];
  for (var index = 0; index < cellCount; index += 1) {
    var dayDate = new Date(year, month - 1, index - firstWeekday + 1);
    var key = dayDate.getFullYear() + '-' + String(dayDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(dayDate.getDate()).padStart(2, '0');
    cells.push({
      key: key,
      day: dayDate.getDate(),
      inMonth: dayDate.getMonth() === month - 1,
      isToday: key === today,
      assignments: grouped[key] || []
    });
  }
  return {
    year: year,
    month: month,
    monthLabel: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(first),
    previous: year + '-' + String(month === 1 ? 12 : month - 1).padStart(2, '0'),
    next: (month === 12 ? year + 1 : year) + '-' + String(month === 12 ? 1 : month + 1).padStart(2, '0'),
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weeks: Array.from({ length: cellCount / 7 }, function (_, week) {
      return cells.slice(week * 7, week * 7 + 7);
    })
  };
}

module.exports = { dateKey: dateKey, buildCalendar: buildCalendar };
