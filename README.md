# Chushkopek API

API-only Next.js service for the Chushkopek hackathon demo.

## Routes

- `POST /api/demo-crash`
  - Receives the memory-leak threshold payload from the storefront.
  - Sends a PagerDuty Events API v2 alert.
  - Intentionally throws after PagerDuty accepts the alert so the demo shows a controlled server crash.
- `POST /api/pagerduty-webhook?token=...`
  - Receives PagerDuty `incident.triggered` webhooks.
  - Calls the configured Twilio destination number.
  - Ignores non-trigger events such as acknowledge/resolve/update.

## Environment Variables

Set these in Vercel Production:

```txt
CORS_ALLOWED_ORIGIN
PAGERDUTY_EVENTS_URL
PAGERDUTY_ROUTING_KEY
PAGERDUTY_WEBHOOK_TOKEN
TWILIO_ACCOUNT_SID
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_FROM_NUMBER
TEAMMATE_PHONE_NUMBER
```

For EU PagerDuty Events API v2 alerts:

```txt
PAGERDUTY_EVENTS_URL=https://events.eu.pagerduty.com/v2/enqueue
```

`CORS_ALLOWED_ORIGIN` should be the deployed storefront origin, for example:

```txt
https://test-hackathon-theta.vercel.app
```

Do not commit real secrets, tokens, or phone numbers.

## Local Development

```sh
npm install
npm run dev
```

## Validation

```sh
npm run build
npm run lint
```
