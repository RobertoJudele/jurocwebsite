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
  },
  /* Fail in seconds, not nodemailer's default two minutes. A hang here almost
     always means the host cannot reach the relay at all, and waiting two
     minutes to learn that is not useful. */
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000
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
    if (err.code === 'ESOCKET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION') {
      console.error('Could not reach the relay. Check SMTP_HOST/SMTP_PORT first, then whether');
      console.error('outbound SMTP is blocked. Hetzner, DigitalOcean, Oracle Cloud and others');
      console.error('block ports 25/465/587 by default and only lift it on request.');
      console.error('');
      console.error('Confirm with:');
      console.error("  timeout 8 bash -c 'cat < /dev/null > /dev/tcp/smtp.gmail.com/465' \\");
      console.error('    && echo OPEN || echo BLOCKED');
      console.error('');
      console.error('If it is blocked, either ask the provider to unblock it, or switch to a');
      console.error('transactional email API over HTTPS on port 443, which is never blocked.');
    }
    process.exit(1);
  }
})();
