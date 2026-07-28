/* =========================================
   Juroc Solutions — SMTP credential check
   =========================================
   Run with: npm run verify
   Connects to the relay and sends one test message to MAIL_TO.
   Use this before pointing DNS at the VPS — it isolates credential and
   permission problems from everything else in the stack.
   ========================================= */

require('dotenv').config();

const nodemailer = require('nodemailer');

const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter(key => !process.env[key]);

if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER;
const MAIL_TO = process.env.MAIL_TO || MAIL_FROM;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: String(process.env.SMTP_SECURE).toLowerCase() !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

(async () => {
  try {
    console.log(`Connecting to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465} …`);
    await transporter.verify();
    console.log('✓ Connection and credentials accepted');

    console.log(`Sending a test message to ${MAIL_TO} …`);
    const info = await transporter.sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'Juroc Solutions', address: MAIL_FROM },
      to: MAIL_TO,
      subject: 'Contact form SMTP test',
      text: [
        'This is a test from the Juroc contact form service.',
        '',
        'If you are reading this, the relay works and the service can send mail.',
        `Sent at ${new Date().toISOString()}`
      ].join('\n')
    });

    console.log(`✓ Sent (id: ${info.messageId})`);
    if (info.rejected && info.rejected.length) {
      console.warn(`! Rejected recipients: ${info.rejected.join(', ')}`);
    }
    console.log('\nNow check the inbox — and confirm it is not in the spam folder.');
  } catch (err) {
    console.error('\n✗ Failed:', err.message);
    if (err.code === 'EAUTH') {
      console.error('Authentication was rejected. If this mailbox has 2FA, you need an');
      console.error('app-specific password rather than the normal account password.');
    }
    if (err.code === 'ESOCKET' || err.code === 'ETIMEDOUT') {
      console.error('Could not reach the server. Check SMTP_HOST/SMTP_PORT, and whether the');
      console.error('VPS firewall or provider blocks outbound SMTP on that port.');
    }
    process.exit(1);
  }
})();
