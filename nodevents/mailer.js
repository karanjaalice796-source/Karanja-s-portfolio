const nodemailer = require('nodemailer');

const configured = Boolean(process.env.SMTP_HOST);

let transport = null;
if (configured) {
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port.');
  }

  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail({ to, subject, text }) {
  if (!configured) {
    console.log(`\n[demo mode: email not actually sent]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return true;
  }

  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || 'Nodevents <no-reply@example.com>',
      to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.error('Email failed:', error);
    return false;
  }
}

module.exports = { sendMail, configured };
