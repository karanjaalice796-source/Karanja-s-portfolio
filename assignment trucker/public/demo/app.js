/* Assignment Tracker: browser-only storage and reminders. */
(function () {
  'use strict';

  var STORE_KEY = 'assignmentTracker.items';
  var PROFILE_KEY = 'assignmentTracker.profile';
  var STATUSES = ['Not Started', 'In Progress', 'Completed'];
  var items = loadItems();
  var filter = 'open';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('assignmentForm');
  var listEl = $('list');

  function loadItems() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (item) {
        return item && typeof item.id === 'string' && typeof item.title === 'string' &&
          typeof item.course === 'string' && typeof item.due === 'string';
      }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveItems() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch (e) {
      alert('This browser could not save your assignments. Check that private browsing is off.');
    }
  }

  function loadProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseDate(str) {
    var p = str.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function today() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysUntil(dueStr) {
    return Math.round((parseDate(dueStr) - today()) / 86400000);
  }

  function prettyDate(str) {
    return parseDate(str).toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function relativeLabel(days) {
    if (days < -1) return 'Overdue by ' + (-days) + ' days';
    if (days === -1) return 'Overdue by 1 day';
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return 'Due in ' + days + ' days';
  }

  function stateOf(item) {
    if (item.status === 'Completed') return 'done';
    var d = daysUntil(item.due);
    if (d < 0) return 'late';
    if (d <= Number(item.remindDays)) return 'soon';
    return 'ok';
  }

  function make(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function resetForm() {
    form.reset();
    $('editId').value = '';
    $('issued').value = toISO(new Date());
    $('formHeading').textContent = 'Add an assignment';
    $('saveBtn').textContent = 'Add assignment';
    $('cancelBtn').hidden = true;
    clearErrors();
  }

  function clearErrors() {
    ['title', 'course', 'due'].forEach(function (f) {
      $(f).classList.remove('invalid');
      $(f + 'Error').hidden = true;
    });
  }

  function validate() {
    clearErrors();
    var ok = true;
    ['title', 'course', 'due'].forEach(function (f) {
      if (!$(f).value.trim()) {
        $(f).classList.add('invalid');
        $(f + 'Error').hidden = false;
        ok = false;
      }
    });
    return ok;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!validate()) return;

    var data = {
      title: $('title').value.trim(),
      course: $('course').value.trim(),
      description: $('description').value.trim(),
      issued: $('issued').value,
      due: $('due').value,
      status: $('status').value,
      remindDays: $('remindDays').value
    };

    var id = $('editId').value;
    if (id) {
      var item = findItem(id);
      if (!item) return;
      for (var k in data) item[k] = data[k];
      if (item.status !== 'Completed') item.submitted = item.submitted || false;
      item.notifiedOn = '';
    } else {
      data.id = 'a' + Date.now() + Math.floor(Math.random() * 1000);
      data.submitted = false;
      data.notifiedOn = '';
      items.push(data);
    }

    saveItems();
    resetForm();
    render();
    checkReminders(true);
    $('title').focus();
  });

  $('cancelBtn').addEventListener('click', resetForm);

  function findItem(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function startEdit(id) {
    var item = findItem(id);
    if (!item) return;
    $('editId').value = item.id;
    $('title').value = item.title;
    $('course').value = item.course;
    $('description').value = item.description || '';
    $('issued').value = item.issued || '';
    $('due').value = item.due;
    $('status').value = item.status;
    $('remindDays').value = item.remindDays;
    $('formHeading').textContent = 'Edit assignment';
    $('saveBtn').textContent = 'Save changes';
    $('cancelBtn').hidden = false;
    clearErrors();
    $('title').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function visibleItems() {
    var q = $('search').value.trim().toLowerCase();
    var course = $('courseFilter').value;
    var out = items.filter(function (it) {
      var st = stateOf(it);
      if (filter === 'open' && it.status === 'Completed') return false;
      if (filter === 'overdue' && st !== 'late') return false;
      if (filter === 'completed' && it.status !== 'Completed') return false;
      if (course && it.course !== course) return false;
      if (q && (it.title + ' ' + (it.description || '') + ' ' + it.course).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    var sort = $('sortBy').value;
    out.sort(function (a, b) {
      if (sort === 'course') return a.course.localeCompare(b.course) || a.due.localeCompare(b.due);
      if (sort === 'status') return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.due.localeCompare(b.due);
      return a.due.localeCompare(b.due);
    });
    return out;
  }

  function render() {
    renderCourses();
    renderSummary();
    var shown = visibleItems();
    listEl.textContent = '';
    if (shown.length === 0) {
      listEl.appendChild(emptyState());
      return;
    }
    shown.forEach(function (it) { listEl.appendChild(buildRow(it)); });
  }

  function emptyState() {
    var box = make('div', 'empty');
    if (items.length === 0) {
      box.appendChild(make('p', '', 'You have no assignments yet. Add your first one using the form.'));
      var demo = make('button', 'btn small', 'Load three examples');
      demo.type = 'button';
      demo.addEventListener('click', loadExamples);
      box.appendChild(demo);
    } else {
      box.appendChild(make('p', '', 'Nothing matches the current filter.'));
    }
    return box;
  }

  function buildRow(it) {
    var st = stateOf(it);
    var days = daysUntil(it.due);
    var row = make('article', 'row ' + (st === 'ok' ? '' : st));

    var info = make('div', 'info');
    info.appendChild(make('div', 'title', it.title));
    info.appendChild(make('div', 'course', it.course));
    if (it.description) info.appendChild(make('div', 'notes', it.description));
    row.appendChild(info);

    var due = make('div', 'due');
    due.appendChild(make('div', 'due-date', prettyDate(it.due)));
    if (it.status === 'Completed') {
      due.appendChild(make('div', 'due-note', it.submitted ? 'Handed in' : 'Finished, not handed in'));
    } else {
      due.appendChild(make('div', 'due-note ' + (st === 'ok' ? '' : st), relativeLabel(days)));
    }
    row.appendChild(due);

    var box = make('div', 'status-box');
    var sel = make('select');
    sel.setAttribute('aria-label', 'Progress for ' + it.title);
    STATUSES.forEach(function (s) {
      var o = make('option', '', s);
      if (s === it.status) o.selected = true;
      sel.appendChild(o);
    });
    sel.className = it.status === 'Completed' ? 's-done' : it.status === 'In Progress' ? 's-prog' : 's-not';
    sel.addEventListener('change', function () {
      it.status = sel.value;
      if (it.status !== 'Completed') it.submitted = false;
      saveItems();
      render();
      checkReminders(false);
    });
    box.appendChild(sel);

    var lab = make('label', 'submit-check');
    var cb = make('input');
    cb.type = 'checkbox';
    cb.checked = !!it.submitted;
    cb.addEventListener('change', function () {
      it.submitted = cb.checked;
      if (cb.checked) it.status = 'Completed';
      saveItems();
      render();
      checkReminders(false);
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode('Submitted'));
    box.appendChild(lab);
    row.appendChild(box);

    var act = make('div', 'row-actions');
    var edit = make('button', 'link-btn', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Edit ' + it.title);
    edit.addEventListener('click', function () { startEdit(it.id); });
    var del = make('button', 'link-btn del', 'Delete');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete ' + it.title);
    del.addEventListener('click', function () {
      if (confirm('Delete "' + it.title + '"? This cannot be undone.')) {
        items = items.filter(function (x) { return x.id !== it.id; });
        saveItems();
        if ($('editId').value === it.id) resetForm();
        render();
        checkReminders(false);
      }
    });
    act.appendChild(edit);
    act.appendChild(del);
    row.appendChild(act);
    return row;
  }

  function renderCourses() {
    var courses = [];
    items.forEach(function (it) {
      if (courses.indexOf(it.course) === -1) courses.push(it.course);
    });
    courses.sort();

    var dl = $('courseList');
    dl.textContent = '';
    courses.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      dl.appendChild(o);
    });

    var sel = $('courseFilter');
    var current = sel.value;
    sel.textContent = '';
    var all = make('option', '', 'All courses');
    all.value = '';
    sel.appendChild(all);
    courses.forEach(function (c) {
      var o = make('option', '', c);
      o.value = c;
      sel.appendChild(o);
    });
    sel.value = courses.indexOf(current) === -1 ? '' : current;
  }

  function renderSummary() {
    var open = 0, late = 0, week = 0, done = 0;
    items.forEach(function (it) {
      if (it.status === 'Completed') { done++; return; }
      open++;
      var d = daysUntil(it.due);
      if (d < 0) late++;
      else if (d <= 7) week++;
    });

    var s = $('summary');
    s.textContent = '';
    if (items.length === 0) return;
    function part(n, text) {
      var span = document.createElement('span');
      var b = make('strong', '', String(n));
      span.appendChild(b);
      span.appendChild(document.createTextNode(' ' + text));
      return span;
    }
    s.appendChild(part(open, 'open'));
    s.appendChild(document.createTextNode(', '));
    s.appendChild(part(week, 'due in the next 7 days'));
    s.appendChild(document.createTextNode(', '));
    s.appendChild(part(late, 'overdue'));
    s.appendChild(document.createTextNode(', '));
    s.appendChild(part(done, 'completed.'));
  }

  function checkReminders(allowPopup) {
    var banner = $('reminderBanner');
    var late = [], soon = [];
    items.forEach(function (it) {
      var st = stateOf(it);
      if (st === 'late') late.push(it);
      if (st === 'soon') soon.push(it);
    });

    banner.textContent = '';
    if (late.length === 0 && soon.length === 0) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.className = late.length ? 'banner late' : 'banner';
    banner.appendChild(make('p', '', late.length ? 'You have work that is past its due date.' : 'Deadlines are coming up.'));
    var ul = make('ul');
    late.concat(soon).forEach(function (it) {
      ul.appendChild(make('li', '', it.title + ' (' + it.course + '): ' + relativeLabel(daysUntil(it.due)).toLowerCase()));
    });
    banner.appendChild(ul);

    if (allowPopup !== false && 'Notification' in window && Notification.permission === 'granted') {
      var todayStr = toISO(new Date());
      var changed = false;
      late.concat(soon).forEach(function (it) {
        if (it.notifiedOn !== todayStr) {
          new Notification('Assignment reminder', {
            body: it.title + ' (' + it.course + '): ' + relativeLabel(daysUntil(it.due)).toLowerCase()
          });
          it.notifiedOn = todayStr;
          changed = true;
        }
      });
      if (changed) saveItems();
    }
  }

  $('alertsBtn').addEventListener('click', function () {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications. The reminder box on the page still works.');
      return;
    }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') {
        $('alertsBtn').textContent = 'Browser alerts are on';
        checkReminders(true);
      } else {
        alert('Alerts are blocked. You can allow them from the lock icon next to the address bar.');
      }
    });
  });

  function initProfile() {
    var p = loadProfile();
    $('studentName').value = p.name || '';
    $('studentId').value = p.id || '';
    var who = make('p', 'print-only');
    who.id = 'printWho';
    document.querySelector('.topbar-inner > div').appendChild(who);
    updatePrintHeader();

    ['studentName', 'studentId'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        try {
          localStorage.setItem(PROFILE_KEY, JSON.stringify({
            name: $('studentName').value.trim(),
            id: $('studentId').value.trim()
          }));
        } catch (e) { /* Profile storage is optional. */ }
        updatePrintHeader();
      });
    });
  }

  function updatePrintHeader() {
    var n = $('studentName').value.trim();
    var i = $('studentId').value.trim();
    $('printWho').textContent = (n || 'Student') + (i ? ' (' + i + ')' : '') +
      ' - printed ' + new Date().toLocaleDateString();
  }

  function csvCell(v) {
    v = String(v === undefined || v === null ? '' : v);
    if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }

  $('exportBtn').addEventListener('click', function () {
    if (items.length === 0) { alert('There is nothing to download yet.'); return; }
    var head = ['Student', 'Student ID', 'Title', 'Course', 'Notes', 'Date given', 'Due date', 'Progress', 'Submitted'];
    var n = $('studentName').value.trim(), i = $('studentId').value.trim();
    var lines = [head.map(csvCell).join(',')];
    items.slice().sort(function (a, b) { return a.due.localeCompare(b.due); }).forEach(function (it) {
      lines.push([n, i, it.title, it.course, it.description, it.issued, it.due, it.status, it.submitted ? 'Yes' : 'No']
        .map(csvCell).join(','));
    });
    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'assignments-' + toISO(new Date()) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });

  $('printBtn').addEventListener('click', function () {
    updatePrintHeader();
    window.print();
  });

  $('clearDoneBtn').addEventListener('click', function () {
    var count = items.filter(function (x) { return x.status === 'Completed'; }).length;
    if (count === 0) { alert('There are no completed assignments to remove.'); return; }
    if (confirm('Remove ' + count + ' completed assignment' + (count === 1 ? '' : 's') + '?')) {
      items = items.filter(function (x) { return x.status !== 'Completed'; });
      saveItems();
      render();
      checkReminders(false);
    }
  });

  function loadExamples() {
    var t = today();
    function offset(n) { var d = new Date(t); d.setDate(d.getDate() + n); return toISO(d); }
    var base = Date.now();
    items = items.concat([
      { id: 'ex' + base + '1', title: 'HTML portfolio page', course: 'Web Development', description: 'Header, about section and a contact form.', issued: offset(-5), due: offset(1), status: 'In Progress', remindDays: '2', submitted: false, notifiedOn: '' },
      { id: 'ex' + base + '2', title: 'Database design sketch', course: 'Databases', description: 'Draw the tables for a school library.', issued: offset(-9), due: offset(-2), status: 'Not Started', remindDays: '2', submitted: false, notifiedOn: '' },
      { id: 'ex' + base + '3', title: 'JavaScript quiz app', course: 'Web Development', description: '', issued: offset(-1), due: offset(9), status: 'Not Started', remindDays: '3', submitted: false, notifiedOn: '' }
    ]);
    saveItems();
    render();
    checkReminders(false);
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.remove('active');
        t.setAttribute('aria-pressed', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-pressed', 'true');
      filter = tab.getAttribute('data-filter');
      render();
    });
  });
  $('search').addEventListener('input', render);
  $('courseFilter').addEventListener('change', render);
  $('sortBy').addEventListener('change', render);

  initProfile();
  resetForm();
  render();
  checkReminders(true);
  if ('Notification' in window && Notification.permission === 'granted') {
    $('alertsBtn').textContent = 'Browser alerts are on';
  }
  setInterval(function () { render(); checkReminders(true); }, 60000);
})();