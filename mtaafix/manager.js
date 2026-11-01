const express = require('express');

const REPORT_STATUSES = ['Unresolved', 'In progress', 'Fixed'];

/**
 * Creates the internal management API for Jenga Nasi Kenya reports and contact messages.
 * Authentication can be added in front of this router before production use.
 */
function createManagerRouter(database) {
  const router = express.Router();

  router.get('/reports', (_request, response) => {
    const reports = database.prepare(`
      SELECT
        id, title, category, location, severity, status, confirmations,
        icon, color, photo_name AS photo, created_at AS createdAt
      FROM reports
      ORDER BY created_at DESC, id DESC
    `).all();

    response.json(reports);
  });

  router.patch('/reports/:id', (request, response) => {
    const reportId = Number(request.params.id);
    const status = typeof request.body?.status === 'string' ? request.body.status.trim() : '';

    if (!Number.isInteger(reportId) || reportId < 1) {
      return response.status(400).json({ error: 'A valid report id is required.' });
    }

    if (!REPORT_STATUSES.includes(status)) {
      return response.status(400).json({
        error: `Status must be one of: ${REPORT_STATUSES.join(', ')}.`
      });
    }

    const result = database.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportId);
    if (result.changes === 0) return response.status(404).json({ error: 'Report not found.' });

    return response.json({ id: reportId, status });
  });

  router.delete('/reports/:id', (request, response) => {
    const reportId = Number(request.params.id);
    if (!Number.isInteger(reportId) || reportId < 1) {
      return response.status(400).json({ error: 'A valid report id is required.' });
    }

    const result = database.prepare('DELETE FROM reports WHERE id = ?').run(reportId);
    if (result.changes === 0) return response.status(404).json({ error: 'Report not found.' });

    return response.sendStatus(204);
  });

  router.get('/messages', (_request, response) => {
    const messages = database.prepare(`
      SELECT id, name, email, message, created_at AS createdAt
      FROM messages
      ORDER BY created_at DESC, id DESC
    `).all();

    response.json(messages);
  });

  return router;
}

module.exports = { createManagerRouter };
