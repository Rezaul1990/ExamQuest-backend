const nodemailer = require("nodemailer");
const env = require("../../config/env");

function buildLink(path, token) {
  return `${env.appDeepLinkScheme}://${path}?token=${encodeURIComponent(token)}`;
}

async function sendMail({ to, subject, text }) {
  const smtpReady = env.smtp.host && env.smtp.user && env.smtp.pass;
  if (!smtpReady) {
    console.warn('[mail] Delivery skipped: SMTP is not configured.');
    return;
  }
  try {
    const transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
    await transport.sendMail({ to, from: env.smtp.from, subject, text });
  } catch {
    const error = new Error('Mail delivery is temporarily unavailable');
    error.statusCode = 503;
    error.code = 'MAIL_DELIVERY_FAILED';
    throw error;
  }
}

module.exports = { buildLink, sendMail };
