function cell(value) {
  var text = String(value === undefined || value === null ? '' : value);
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function send(res, filename, headers, rows) {
  var content = [headers].concat(rows).map(function (row) {
    return row.map(cell).join(',');
  }).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename.replace(/[^a-zA-Z0-9._-]/g, '_') + '"');
  res.send('\ufeff' + content);
}

module.exports = { send: send };