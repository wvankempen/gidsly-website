/**
 * Contact form handler (Cloudflare Pages Function).
 *
 * Receives a POST { name?, email, message, 'bot-field'? } from the
 * contact form on gidsly.com and does two things:
 *
 *   1. Upserts the sender into Brevo (list 11 by default), tagged
 *      with attributes that make the submission searchable later.
 *   2. Fires a transactional email to CONTACT_FORWARD_EMAIL so
 *      whoever runs the inbox sees the message immediately, with
 *      Reply-To set to the sender so a reply just works.
 *
 * Honeypot: any non-empty `bot-field` is treated as a bot. We
 * return 200 ok so the bot script thinks it succeeded, but we
 * skip Brevo entirely.
 *
 * Required environment variables (Cloudflare → Pages → Project →
 * Settings → Environment variables):
 *   BREVO_API_KEY (or BREVO_KEY)
 *   BREVO_SENDER_EMAIL          The "From" address. Must be a
 *                               domain Brevo has verified for you.
 *
 * Optional:
 *   CONTACT_FORWARD_EMAIL       Where the notification email lands.
 *                               Defaults to info@gidsly.com.
 *   BREVO_CONTACT_LIST_ID       Brevo list to add submitters to.
 *                               Defaults to 11.
 */

const CORS = {
  'Access-Control-Allow-Origin':  'https://gidsly.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export async function onRequestOptions() {
  return new Response('', { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, 'bad_json');
  }

  // Honeypot: a real user leaves bot-field empty. Bots fill in every
  // visible-looking input. Pretend success and bail.
  if (typeof payload?.['bot-field'] === 'string' && payload['bot-field'].trim() !== '') {
    return jsonOk({ ok: true });
  }

  const email   = typeof payload?.email   === 'string' ? payload.email.trim().toLowerCase() : '';
  const name    = typeof payload?.name    === 'string' ? payload.name.trim()                : '';
  const message = typeof payload?.message === 'string' ? payload.message.trim()             : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'invalid_email');
  if (!message)                                            return jsonError(400, 'missing_message');

  const apiKey       = env.BREVO_API_KEY || env.BREVO_KEY;
  const senderEmail  = env.BREVO_SENDER_EMAIL;
  const forwardEmail = env.CONTACT_FORWARD_EMAIL || 'info@gidsly.com';
  const listId       = Number(env.BREVO_CONTACT_LIST_ID || 11);
  if (!apiKey || !senderEmail) {
    console.error('[contact] missing BREVO_API_KEY or BREVO_SENDER_EMAIL env');
    return jsonError(500, 'server_not_configured');
  }

  const referrer = request.headers.get('referer') || '';
  const ip = (request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || '').split(',')[0].trim();

  // Run both calls in parallel. Either failing alone is non-fatal:
  // the user-facing success only requires one of the two to land,
  // and we log the other for follow-up.
  const [brevoContact, brevoEmail] = await Promise.allSettled([
    upsertContact({ apiKey, listId, email, name, message, referrer, ip }),
    sendNotification({ apiKey, senderEmail, forwardEmail, email, name, message, referrer, ip }),
  ]);

  if (brevoContact.status === 'rejected') {
    console.error('[contact] Brevo contact upsert failed:', brevoContact.reason);
  }
  if (brevoEmail.status === 'rejected') {
    console.error('[contact] Brevo email send failed:', brevoEmail.reason);
  }

  // Both failed → tell the client so they can retry.
  if (brevoContact.status === 'rejected' && brevoEmail.status === 'rejected') {
    return jsonError(502, 'brevo_error');
  }
  return jsonOk({ ok: true });
}

async function upsertContact({ apiKey, listId, email, name, message, referrer, ip }) {
  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key':      apiKey,
      'content-type': 'application/json',
      'accept':       'application/json',
    },
    body: JSON.stringify({
      email,
      listIds:       [listId],
      updateEnabled: true,
      attributes: {
        FIRSTNAME:       name || undefined,
        SOURCE:          'gidsly.com-contact-form',
        LAST_MESSAGE:    message.slice(0, 4000),
        SUBMITTED_AT:    new Date().toISOString(),
        REFERRER_URL:    referrer || undefined,
        SIGNUP_IP:       ip || undefined,
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`brevo_contacts_${res.status}: ${detail.slice(0, 200)}`);
  }
}

async function sendNotification({ apiKey, senderEmail, forwardEmail, email, name, message, referrer, ip }) {
  const subject = `New contact form submission from ${name || email}`;
  const safeName    = escapeHtml(name || '(not provided)');
  const safeEmail   = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
  const safeRef     = escapeHtml(referrer || '(unknown)');
  const safeIp      = escapeHtml(ip || '(unknown)');

  const htmlContent = `
    <h2 style="font-family:sans-serif">New contact form submission</h2>
    <p style="font-family:sans-serif"><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
    <p style="font-family:sans-serif"><strong>Message:</strong></p>
    <blockquote style="font-family:sans-serif;border-left:3px solid #ccc;padding-left:12px;color:#333">${safeMessage}</blockquote>
    <hr>
    <p style="font-family:sans-serif;color:#888;font-size:12px">
      Referrer: ${safeRef}<br>IP: ${safeIp}
    </p>
  `;
  const textContent =
    `New contact form submission\n\n` +
    `From: ${name || '(not provided)'} <${email}>\n\n` +
    `Message:\n${message}\n\n` +
    `---\nReferrer: ${referrer || '(unknown)'}\nIP: ${ip || '(unknown)'}`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key':      apiKey,
      'content-type': 'application/json',
      'accept':       'application/json',
    },
    body: JSON.stringify({
      sender:    { email: senderEmail, name: 'Gidsly contact form' },
      to:        [{ email: forwardEmail }],
      replyTo:   { email, name: name || undefined },
      subject,
      htmlContent,
      textContent,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`brevo_email_${res.status}: ${detail.slice(0, 200)}`);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonOk(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function jsonError(status, code) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
