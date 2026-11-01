const nodemailer = require('nodemailer');
const db = require('../config/db');
const dates = require('./dates');
const { studentAssignments } = require('./queries');

function mailConfig() {
  var port = Number(process.env.SMTP_PORT || 587);
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host: process.env.SMTP_HOST,
    port: port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || ''
    } : undefined,
    from: process.env.SMTP_FROM
  };
}

function createTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth
  });
}

async function sendDailyReminders() {
  var config = mailConfig();
  if (!config) return { enabled: false, sent: 0 };
  var transport = createTransport(config);
  var users = (await db.query(
    "SELECT id, full_name, email, remind_days FROM users" +
    " WHERE active = TRUE AND role = 'student' AND email_reminders = TRUE" +
    ' AND reminder_sent_on IS DISTINCT FROM CURRENT_DATE ORDER BY id'
  )).rows;
  var sent = 0;
  for (var user of users) {
    var assignments = (await studentAssignments(user.id)).map(function (row) {
      return dates.annotate(row, user.remind_days);
    }).filter(function (row) {
      return !row.submitted && (row.state === 'late' || row.days <= user.remind_days);
    });
    if (!assignments.length) continue;

    var lines = assignments.map(function (row) {
      var due = row.state === 'late' ? 'Overdue by ' + Math.abs(row.days) + ' day(s)' :
        row.days === 0 ? 'Due today' : row.days === 1 ? 'Due tomorrow' : 'Due in ' + row.days + ' days';
      return '- ' + row.title + ' (' + row.course_name + '): ' + due;
    });
    await transport.sendMail({
      from: config.from,
      to: user.email,
      subject: 'Your assignment deadline summary',
      text: 'Hello ' + user.full_name + ',\n\nHere are your upcoming and overdue assignments:\n\n' +
        lines.join('\n') + '\n\nSign in to your assignment tracker to review your work.'
    });
    await db.query('UPDATE users SET reminder_sent_on = CURRENT_DATE WHERE id = $1', [user.id]);
    sent += 1;
  }
  return { enabled: true, sent: sent };
}

function startDailyReminderSchedule() {
  if (!mailConfig()) {
    console.log('Daily email reminders are disabled. Configure SMTP_HOST and SMTP_FROM to enable them.');
    return null;
  }
  var configuredHour = Number(process.env.EMAIL_REMINDER_HOUR || 8);
  if (!Number.isInteger(configuredHour) || configuredHour < 0 || configuredHour > 23) {
    throw new Error('EMAIL_REMINDER_HOUR must be an hour from 0 to 23.');
  }
  console.log('Daily email reminders are enabled. Scheduled for ' + String(configuredHour).padStart(2, '0') + ':00 server local time.');
  var lastRunDate = '';
  async function checkSchedule() {
    var now = new Date();
    var today = dates.toISO(now);
    if (now.getHours() !== configuredHour || lastRunDate === today) return;
    lastRunDate = today;
    try {
      var result = await sendDailyReminders();
      console.log('Daily assignment reminders sent:', result.sent);
    } catch (err) {
      lastRunDate = '';
      console.error('Could not send daily assignment reminders:', err);
    }
  }
  var timer = setInterval(checkSchedule, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  checkSchedule();
  return timer;
}

module.exports = {
  mailConfig: mailConfig,
  sendDailyReminders: sendDailyReminders,
  startDailyReminderSchedule: startDailyReminderSchedule
};
