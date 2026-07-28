/* =========================================
   Juroc Solutions — Contact form mail service
   =========================================
   Receives POST /api/contact from the website and sends two messages:
     1. an enquiry notification to the business inbox
     2. a confirmation auto-reply to the visitor
   Credentials come from .env and never reach the browser.
   ========================================= */

require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

/* Inside a container this must be 0.0.0.0, otherwise it binds the container's
   own loopback and nginx — in a different container — cannot reach it. The
   port is never published to the host (compose uses "expose", not "ports"),
   so the service stays unreachable from outside the Docker network.
   Set BIND_HOST=127.0.0.1 if you ever run this directly on a host. */
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

/* nginx sits in front of us, so the client IP arrives in X-Forwarded-For.
   Without this the rate limiter would see 127.0.0.1 for every visitor and
   throttle the whole site as if it were one person. */
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));

/* --- CORS ---
   The normal deployment serves the site and this API from the same origin, so
   no preflight happens. This is here for staging hosts listed in ALLOWED_ORIGINS. */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* --- Transport --- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: String(process.env.SMTP_SECURE).toLowerCase() !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  /* Nodemailer defaults to a 2-minute connection timeout. If the host cannot
     reach the relay at all — a provider blocking outbound SMTP is the usual
     cause — the request would hang far past nginx's 30s proxy_read_timeout,
     handing the visitor a 504 with no useful error and tying up a connection
     the whole time. Fail fast instead, so the form shows its own error and
     tells them to email directly. */
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000
});

const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER;
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Juroc Solutions';
const MAIL_TO = process.env.MAIL_TO || MAIL_FROM;

/* --- Helpers --- */

/* Strip CR/LF before any value goes into a mail header. Without this, a name
   field containing "\r\nBcc: someone@evil.com" would inject a real header. */
const headerSafe = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Mirrors the client-side rules in js/main.js so the two cannot disagree. */
const LIMITS = {
  firstName: 100,
  lastName: 100,
  email: 254,
  company: 200,
  subject: 200,
  message: 5000
};

function validate(body) {
  const errors = [];
  const clean = {};

  for (const [field, max] of Object.entries(LIMITS)) {
    const raw = body[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    const optional = field === 'company';

    if (!value && !optional) {
      errors.push(`${field} is required`);
      continue;
    }
    if (value.length > max) {
      errors.push(`${field} must be ${max} characters or fewer`);
      continue;
    }
    clean[field] = value;
  }

  if (clean.email && !EMAIL_RE.test(clean.email)) {
    errors.push('email is not a valid address');
  }
  if (body.consent !== true && body.consent !== 'true' && body.consent !== 'on') {
    errors.push('consent to the privacy policy is required');
  }

  return { errors, clean };
}

function buildNotification(data) {
  const fullName = `${data.firstName} ${data.lastName}`;
  const rows = [
    ['Name', fullName],
    ['Email', data.email],
    ['Company', data.company || '—'],
    ['Subject', data.subject]
  ];

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#1a1a1a">
      <h2 style="margin:0 0 16px">New enquiry from the website</h2>
      <table cellpadding="6" style="border-collapse:collapse;margin-bottom:20px">
        ${rows.map(([label, value]) => `
          <tr>
            <td style="background:#f4f4f5;font-weight:600;white-space:nowrap">${escapeHtml(label)}</td>
            <td>${escapeHtml(value)}</td>
          </tr>`).join('')}
      </table>
      <h3 style="margin:0 0 8px">Message</h3>
      <div style="white-space:pre-wrap;padding:12px;background:#f9f9fa;border-left:3px solid #d4d4d8">${escapeHtml(data.message)}</div>
      <p style="margin-top:20px;color:#71717a;font-size:13px">
        Reply directly to this email to respond to ${escapeHtml(fullName)}.
      </p>
    </div>`;

  const text = [
    'New enquiry from the website',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Message:',
    data.message
  ].join('\n');

  return {
    from: { name: MAIL_FROM_NAME, address: MAIL_FROM },
    to: MAIL_TO,
    replyTo: { name: headerSafe(fullName), address: data.email },
    subject: headerSafe(`[Website] ${data.subject}`),
    text,
    html
  };
}

function buildAutoReply(data) {
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#1a1a1a">
      <h2 style="margin:0 0 16px">Thank you for getting in touch</h2>
      <p>Hi ${escapeHtml(data.firstName)},</p>
      <p>
        We've received your message and will respond within one business day.
        Our hours are Monday to Friday, 09:00 – 18:00 EET.
      </p>
      <h3 style="margin:24px 0 8px;font-size:15px">Your message</h3>
      <div style="white-space:pre-wrap;padding:12px;background:#f9f9fa;border-left:3px solid #d4d4d8">${escapeHtml(data.message)}</div>
      <p style="margin-top:24px">
        Kind regards,<br>
        <strong>Juroc Solutions SRL</strong><br>
        <a href="mailto:${escapeHtml(MAIL_TO)}">${escapeHtml(MAIL_TO)}</a>
      </p>
      <p style="margin-top:24px;color:#71717a;font-size:12px">
        This is an automated confirmation. You can reply to this email to add anything further.
      </p>
    </div>`;

  const text = [
    `Hi ${data.firstName},`,
    '',
    "We've received your message and will respond within one business day.",
    'Our hours are Monday to Friday, 09:00 - 18:00 EET.',
    '',
    'Your message:',
    data.message,
    '',
    'Kind regards,',
    'Juroc Solutions SRL',
    MAIL_TO
  ].join('\n');

  return {
    from: { name: MAIL_FROM_NAME, address: MAIL_FROM },
    to: { name: headerSafe(`${data.firstName} ${data.lastName}`), address: data.email },
    replyTo: MAIL_TO,
    subject: headerSafe(`We've received your message — ${data.subject}`),
    text,
    html
  };
}

/* --- Routes --- */

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many submissions. Please try again later.' }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/contact', contactLimiter, async (req, res) => {
  const body = req.body || {};

  /* Honeypot: hidden from real users, irresistible to bots. Return success so
     the bot has no signal that it was caught. */
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn('[contact] honeypot triggered from %s', req.ip);
    return res.json({ ok: true });
  }

  const { errors, clean } = validate(body);
  if (errors.length) {
    return res.status(400).json({ ok: false, error: errors[0], errors });
  }

  /* The notification is the one that must land — it is the actual enquiry.
     Send it first and fail the request if it does not go out. */
  try {
    await transporter.sendMail(buildNotification(clean));
  } catch (err) {
    console.error('[contact] notification failed:', err);
    return res.status(502).json({
      ok: false,
      error: 'We could not send your message. Please email us directly.'
    });
  }

  /* The auto-reply is a courtesy. If it fails the enquiry is still captured,
     so log it and report success rather than telling the visitor to resend. */
  try {
    await transporter.sendMail(buildAutoReply(clean));
  } catch (err) {
    console.error('[contact] auto-reply to %s failed:', clean.email, err);
  }

  console.log('[contact] enquiry received from %s <%s>', `${clean.firstName} ${clean.lastName}`, clean.email);
  res.json({ ok: true });
});

/* --- Start --- */
app.listen(PORT, BIND_HOST, () => {
  console.log(`[contact] listening on ${BIND_HOST}:${PORT}`);

  /* Surface bad credentials at deploy time instead of on the first real enquiry. */
  transporter.verify()
    .then(() => console.log('[contact] SMTP connection verified'))
    .catch(err => console.error('[contact] SMTP VERIFY FAILED — mail will not send:', err.message));
});
