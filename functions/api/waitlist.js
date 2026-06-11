/**
 * Waitlist signup handler (Cloudflare Pages Function).
 *
 * Receives a POST { email } from the homepage form and creates /
 * upserts the contact in Brevo, tagged with our waitlist list id.
 *
 * Why this lives in a Pages Function (not client JS):
 * The Brevo API key authorises transactional email, full contact
 * database access, and Conversations. Putting it in the browser
 * would be a security leak. The function keeps it server-side, with
 * the key pulled from Cloudflare Pages environment variables.
 *
 * Required environment variables (Cloudflare → Pages → Project →
 * Settings → Environment variables):
 *   BREVO_API_KEY (or BREVO_KEY) — accepts either name so it works
 *                              alongside whatever the app backend uses.
 *
 * Optional:
 *   BREVO_WAITLIST_LIST_ID     Override the default waitlist id.
 *                              Defaults to 2 (Gidsly's existing
 *                              marketing list).
 *
 * Success → 200 {ok:true}. Every failure → JSON {error:'code'} so
 * the client can surface a friendly message without leaking internals.
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

  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError(400, 'invalid_email');
  }

  // First + last name are mandatory at the form level so we can
  // personalise FUT outreach ("Hi {{contact.FIRSTNAME}}, …"). Trim,
  // cap at a sane length, and reject empties. We don't normalise
  // case because names carry their own preferences (e.g. "van Kempen").
  const firstName = typeof payload?.firstName === 'string' ? payload.firstName.trim().slice(0, 80) : '';
  const lastName  = typeof payload?.lastName  === 'string' ? payload.lastName.trim().slice(0, 80)  : '';
  if (!firstName) return jsonError(400, 'missing_first_name');
  if (!lastName)  return jsonError(400, 'missing_last_name');

  const apiKey = env.BREVO_API_KEY || env.BREVO_KEY;
  const listId = Number(env.BREVO_WAITLIST_LIST_ID || 2);
  if (!apiKey) {
    console.error('[waitlist] missing BREVO_API_KEY env');
    return jsonError(500, 'server_not_configured');
  }

  // Best-effort source attribution so marketing can tell
  // gidsly.com waitlist joiners apart from app.gidsly.com signups.
  const referrer = request.headers.get('referer') || request.headers.get('referrer') || '';
  const ip = (request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || '').split(',')[0].trim();

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
        // FIRSTNAME + LASTNAME are Brevo's standard attribute names —
        // they show up in the contact list view as their own columns
        // and are usable in templates as {{contact.FIRSTNAME}} etc.
        attributes: {
          FIRSTNAME:    firstName,
          LASTNAME:     lastName,
          SIGNED_UP_AT: new Date().toISOString(),
          SOURCE:       'gidsly.com-waitlist',
          REFERRER_URL: referrer || undefined,
          SIGNUP_IP:    ip       || undefined,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[waitlist] Brevo responded ${res.status}: ${detail.slice(0, 400)}`);
      return jsonError(502, 'brevo_error', { status: res.status });
    }
    return jsonOk({ ok: true });
  } catch (err) {
    console.error('[waitlist] unexpected error:', err);
    return jsonError(500, 'server_error');
  }
}

function jsonOk(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

function jsonError(status, code, extra = {}) {
  return new Response(JSON.stringify({ error: code, ...extra }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
