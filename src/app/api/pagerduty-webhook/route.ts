import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const TRIGGERED_EVENT_TYPE = "incident.triggered";
const DEFAULT_TWILIO_API_BASE_URL = "https://api.twilio.com";
const ALERT_TWIML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<Response>",
  "  <Say>Chushkopek alert. PagerDuty created a new incident. Please check the app and PagerDuty.</Say>",
  "</Response>",
].join("");

type JsonObject = Record<string, unknown>;

export async function POST(request: Request) {
  const tokenCheck = authorizeRequest(request);
  if (tokenCheck) {
    return tokenCheck;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Expected a JSON PagerDuty webhook payload." },
      { status: 400 },
    );
  }

  const eventTypes = extractEventTypes(payload);
  if (!eventTypes.includes(TRIGGERED_EVENT_TYPE)) {
    return Response.json({
      ok: true,
      ignored: true,
      eventTypes,
    });
  }

  const config = getTwilioConfig();
  if ("error" in config) {
    return Response.json({ ok: false, error: config.error }, { status: 500 });
  }

  const twilioResponse = await startTwilioCall(config);
  if (!twilioResponse.ok) {
    console.error("Twilio rejected outbound call request", {
      status: twilioResponse.status,
      body: twilioResponse.body,
    });

    return Response.json(
      {
        ok: false,
        error: "Twilio rejected the outbound call request.",
        status: twilioResponse.status,
        details: twilioResponse.body,
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    callSid: twilioResponse.body.sid,
  });
}

function authorizeRequest(request: Request) {
  const expectedToken = process.env.PAGERDUTY_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return Response.json(
      { ok: false, error: "PAGERDUTY_WEBHOOK_TOKEN is not configured." },
      { status: 500 },
    );
  }

  const providedToken = new URL(request.url).searchParams.get("token");
  if (!providedToken || !safeEquals(providedToken, expectedToken)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

function safeEquals(a: string, b: string) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);

  return first.length === second.length && timingSafeEqual(first, second);
}

function extractEventTypes(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.flatMap(extractEventTypes);
  }

  if (!isJsonObject(payload)) {
    return [];
  }

  const eventTypes = new Set<string>();
  addEventType(eventTypes, payload.event_type);

  if (isJsonObject(payload.event)) {
    addEventType(eventTypes, payload.event.event_type);
  }

  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      for (const eventType of extractEventTypes(message)) {
        eventTypes.add(eventType);
      }
    }
  }

  return [...eventTypes];
}

function addEventType(eventTypes: Set<string>, value: unknown) {
  if (typeof value === "string") {
    eventTypes.add(value);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTwilioConfig():
  | {
      accountSid: string;
      apiKeySid: string;
      apiKeySecret: string;
      fromNumber: string;
      teammatePhoneNumber: string;
      apiBaseUrl: string;
    }
  | { error: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const teammatePhoneNumber = process.env.TEAMMATE_PHONE_NUMBER;

  const missing = [
    ["TWILIO_ACCOUNT_SID", accountSid],
    ["TWILIO_API_KEY_SID", apiKeySid],
    ["TWILIO_API_KEY_SECRET", apiKeySecret],
    ["TWILIO_FROM_NUMBER", fromNumber],
    ["TEAMMATE_PHONE_NUMBER", teammatePhoneNumber],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    return { error: `Missing required environment variables: ${missing.join(", ")}.` };
  }

  return {
    accountSid: accountSid!,
    apiKeySid: apiKeySid!,
    apiKeySecret: apiKeySecret!,
    fromNumber: fromNumber!,
    teammatePhoneNumber: teammatePhoneNumber!,
    apiBaseUrl: process.env.TWILIO_API_BASE_URL ?? DEFAULT_TWILIO_API_BASE_URL,
  };
}

async function startTwilioCall(config: Exclude<ReturnType<typeof getTwilioConfig>, { error: string }>) {
  const apiBaseUrl = config.apiBaseUrl.replace(/\/$/, "");
  const url = `${apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(
    config.accountSid,
  )}/Calls.json`;
  const body = new URLSearchParams({
    To: config.teammatePhoneNumber,
    From: config.fromNumber,
    Twiml: ALERT_TWIML,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.apiKeySid}:${config.apiKeySecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => null),
  };
}
