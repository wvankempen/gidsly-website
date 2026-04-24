/**
 * Waitlist signup handler.
 *
 * Receives a POST { email } from the homepage form and creates /
 * upserts the contact in Brevo, tagged with our waitlist list id.
 *
 * Why this lives in a Netlify Function (not client JS):
 * The Brevo API key authorises transactional email, full contact
 * database access, and Conversations. Putting it in the browser
 * would be a security leak. This function keeps it server-side,
 * behind Netlify's standard HTTPS boundary, with the key pulled
 * from Netlify environment properties.
 *
 * Required environment properties (set in Netlify → Site settings →
 * Environment variables):
 *   BREVO_KEY (or BREVO_API_KEY) — accepts either name so it works
 *                              with whatever convention Netlify and
 *                              the app backend happen to share.
 *
 * Optional:
 *   BREVO_WAITLIST_LIST_ID     Override the default waitlist id.
 *                              Defaults to 2 (Gidsly's existing
 *                              marketing list).
 *
 * Success → 200 {ok:true}. Every failure → JSON {error:'code'} so
 * the client can surface a friendly message without leaking internals.
 */

exports.handler = async (event) => {
  // CORS + method guard. Marketing site is same-origin so CORS is
  // academic, but return a sensible response if someone POSTs from
  // elsewhere anyway.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin':  'https://gidsly.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  // Parse + validate
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) };
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid_email' }) };
  }

  // Env. Accept BREVO_KEY or BREVO_API_KEY (the app backend uses the
  // latter; Netlify was set with the former). List id defaults to 2
  // (Gidsly's existing marketing list); override via
  // BREVO_WAITLIST_LIST_ID for no-code redirects.
  const apiKey = process.env.BREVO_KEY || process.env.BREVO_API_KEY;
  const listId = Number(process.env.BREVO_WAITLIST_LIST_ID || 2);
  if (!apiKey) {
    console.error('[waitlist] missing BREVO_KEY / BREVO_API_KEY env');
    return { statusCode: 500, body: JSON.stringify({ error: 'server_not_configured' }) };
  }

  // Best-effort source attribution so marketing can tell
  // gidsly.com waitlist joiners apart from app.gidsly.com signups.
  const referrer = event.headers?.referer || event.headers?.referrer || '';
  const ip = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || event.headers?.['client-ip'] || '';

  // Brevo upsert — updateEnabled=true means re-submits just patch
  // attributes rather than 409-ing.
  try {
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
          SIGNED_UP_AT:   new Date().toISOString(),
          SOURCE:         'gidsly.com-waitlist',
          REFERRER_URL:   referrer || undefined,
          SIGNUP_IP:      ip || undefined,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[waitlist] Brevo responded ${res.status}: ${detail.slice(0, 400)}`);
      return { statusCode: 502, body: JSON.stringify({ error: 'brevo_error', status: res.status }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[waitlist] unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error' }) };
  }
};
