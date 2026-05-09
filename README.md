# Gidsly website

The public marketing site at **[gidsly.com](https://gidsly.com)**.

Separate from the Gidsly product app (which lives in
[`wvankempen/Gidsly`](https://github.com/wvankempen/Gidsly)). The two codebases
are intentionally kept apart — different audience, different deploy, different
release cadence.

## What this is

A single static page:

- Brand hero + waitlist form (Loops)
- Three feature "proof" cards
- Five-item feature grid
- Quote band + footer CTA

No build step. Pure HTML + CSS + a tiny bit of vanilla JS.

## Local preview

Open `index.html` in any browser — there's no server required.

If you want live-reload while editing, any of the following work:

```bash
# with npx (if you have Node installed)
npx serve .

# with Python
python -m http.server 8000
```

Then visit `http://localhost:8000` (or whatever port the tool shows).

## Deploy

Auto-deployed to **Cloudflare Pages** on every push to `main`. No manual steps.

Server-side helpers live in `functions/api/` and are picked up automatically
as Pages Functions:

- `functions/api/waitlist.js` — homepage waitlist form (Brevo upsert)
- `functions/api/contact.js`  — contact form (Brevo upsert + notification email)

Required env vars in the Cloudflare Pages project:
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`. Optional overrides:
`CONTACT_FORWARD_EMAIL`, `BREVO_WAITLIST_LIST_ID`, `BREVO_CONTACT_LIST_ID`.

## Third-party services in this page

- **[Loops](https://loops.so)** — waitlist email capture. Form submits via a
  hidden iframe to Loops' newsletter endpoint, keyed by the form id in
  `index.html`. No cookies set on `gidsly.com`.
- **Google Fonts** — Fraunces + DM Sans loaded from `fonts.googleapis.com`.
  Can be self-hosted later for stricter GDPR posture.
- **Unsplash** — hero collage and feature card images hotlinked from
  `images.unsplash.com`. Could be swapped for locally-hosted copies to
  remove a third-party dependency.

## Related
- Product app: [`wvankempen/Gidsly`](https://github.com/wvankempen/Gidsly)
- Gidsly's subprocessor list lives in the app repo at
  [`docs/subprocessors.md`](https://github.com/wvankempen/Gidsly/blob/main/docs/subprocessors.md)
  and needs updating to include Loops.
