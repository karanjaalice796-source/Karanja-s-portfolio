const elements = {
  total: document.querySelector('#totalReports'), pending: document.querySelector('#pendingReports'),
  priority: document.querySelector('#priorityReports'), fixed: document.querySelector('#fixedReports'),
  reportTable: document.querySelector('#reportTable'), messageList: document.querySelector('#messageList'),
  messageCount: document.querySelector('#messageCount'), search: document.querySelector('#reportSearch'), toast: document.querySelector('#toast')
};
let reports = [];

function notify(message) { elements.toast.textContent = message; elements.toast.classList.add('visible'); setTimeout(() => elements.toast.classList.remove('visible'), 2400); }
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value ?? ''; return node.innerHTML; }
function priority(report) { return report.confirmations >= 20 ? 'High priority' : report.confirmations >= 10 ? 'Rising' : 'Standard'; }

function renderMetrics() {
  elements.total.textContent = reports.length;
  elements.pending.textContent = reports.filter(report => report.status === 'Unresolved').length;
  elements.priority.textContent = reports.filter(report => report.confirmations >= 20).length;
  elements.fixed.textContent = reports.filter(report => report.status === 'Fixed').length;
}

function renderReports() {
  const query = elements.search.value.trim().toLowerCase();
  const visible = reports.filter(report => `${report.title} ${report.location} ${report.category}`.toLowerCase().includes(query));
  if (!visible.length) { elements.reportTable.innerHTML = '<tr><td colspan="5" class="loading">No reports found.</td></tr>'; return; }
  elements.reportTable.innerHTML = visible.map(report => `<tr>
    <td>${escapeHtml(report.title)}<span class="report-category">${escapeHtml(report.category)}</span></td>
    <td>${escapeHtml(report.location)}</td>
    <td><span class="priority ${report.confirmations >= 20 ? 'high' : ''}">${priority(report)} · ${report.confirmations}</span></td>
    <td><select class="status-select" data-status="${report.id}" aria-label="Update status for ${escapeHtml(report.title)}">
      ${['Unresolved', 'In progress', 'Fixed'].map(status => `<option ${status === report.status ? 'selected' : ''}>${status}</option>`).join('')}
    </select></td><td><button class="delete-button" type="button" data-delete="${report.id}">Remove</button></td></tr>`).join('');
}

function renderMessages(messages) {
  elements.messageCount.textContent = `${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`;
  if (!messages.length) { elements.messageList.innerHTML = '<p class="loading">No messages yet.</p>'; return; }
  elements.messageList.innerHTML = messages.map(message => `<article class="message"><div class="message-top"><div><strong>${escapeHtml(message.name)}</strong><span class="message-email"> · ${escapeHtml(message.email)}</span></div><time>${message.createdAt ? new Date(message.createdAt).toLocaleString() : 'Recently'}</time></div><p>${escapeHtml(message.message)}</p></article>`).join('');
}

async function updateStatus(id, status) {
  const response = await fetch(`/api/manager/reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update report.');
  reports = reports.map(report => report.id === id ? { ...report, status } : report); renderMetrics(); renderReports(); notify('Report status updated.');
}
async function removeReport(id) {
  if (!window.confirm('Remove this report permanently?')) return;
  const response = await fetch(`/api/manager/reports/${id}`, { method: 'DELETE' });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Could not remove report.'); }
  reports = reports.filter(report => report.id !== id); renderMetrics(); renderReports(); notify('Report removed.');
}
async function loadDashboard() {
  try {
    const [reportsResponse, messagesResponse] = await Promise.all([fetch('/api/manager/reports'), fetch('/api/manager/messages')]);
    if (!reportsResponse.ok || !messagesResponse.ok) throw new Error('Could not load dashboard data.');
    reports = await reportsResponse.json(); renderMetrics(); renderReports(); renderMessages(await messagesResponse.json());
  } catch (error) { elements.reportTable.innerHTML = `<tr><td colspan="5" class="loading">${escapeHtml(error.message)}</td></tr>`; elements.messageList.innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`; }
}
elements.search.addEventListener('input', renderReports);
elements.reportTable.addEventListener('change', event => { if (event.target.matches('[data-status]')) updateStatus(Number(event.target.dataset.status), event.target.value).catch(error => notify(error.message)); });
elements.reportTable.addEventListener('click', event => { const button = event.target.closest('[data-delete]'); if (button) removeReport(Number(button.dataset.delete)).catch(error => notify(error.message)); });
document.querySelector('#refreshButton').addEventListener('click', loadDashboard);
loadDashboard();
