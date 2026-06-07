export const runtime = "nodejs";

const DEFAULT_PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";
const DEDUP_KEY = "pepper-roaster-memory-leak-demo";

type DemoCrashRequest = {
  leakCount?: unknown;
  retainedBytes?: unknown;
  threshold?: unknown;
};

export function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: Request) {
  let body: DemoCrashRequest;

  try {
    body = (await request.json()) as DemoCrashRequest;
  } catch {
    return json(
      request,
      { ok: false, error: "Expected a JSON demo crash payload." },
      400,
    );
  }

  const leakCount = readNumber(body.leakCount);
  const retainedBytes = readNumber(body.retainedBytes);
  const threshold = readNumber(body.threshold);

  if (leakCount === null || retainedBytes === null || threshold === null) {
    return json(
      request,
      {
        ok: false,
        error: "leakCount, retainedBytes, and threshold must be numbers.",
      },
      400,
    );
  }

  const routingKey = process.env.PAGERDUTY_ROUTING_KEY;
  if (!routingKey) {
    return json(
      request,
      {
        ok: false,
        error: "PAGERDUTY_ROUTING_KEY is not configured.",
        leakCount,
        retainedBytes,
        threshold,
      },
      500,
    );
  }

  const pagerDutyResponse = await fetch(getPagerDutyEventsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: "trigger",
      dedup_key: DEDUP_KEY,
      payload: {
        summary: "Pepper Roaster memory leak demo threshold exceeded",
        source: "online-store-memory-leak",
        severity: "critical",
        component: "storefront",
        group: "demo",
        class: "memory_leak",
        custom_details: {
          leakCount,
          retainedBytes,
          threshold,
        },
      },
    }),
  });

  if (!pagerDutyResponse.ok) {
    return json(
      request,
      {
        ok: false,
        error: "PagerDuty rejected the demo incident trigger.",
        status: pagerDutyResponse.status,
        details: await readPagerDutyResponse(pagerDutyResponse),
      },
      502,
    );
  }

  throw new Error(
    `Controlled demo crash after PagerDuty trigger: leakCount=${leakCount}, retainedBytes=${retainedBytes}`,
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getPagerDutyEventsUrl() {
  return process.env.PAGERDUTY_EVENTS_URL ?? DEFAULT_PAGERDUTY_EVENTS_URL;
}

async function readPagerDutyResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: getCorsHeaders(request),
  });
}

function getCorsHeaders(request: Request) {
  const configuredOrigin = process.env.CORS_ALLOWED_ORIGIN;
  const requestOrigin = request.headers.get("origin");
  const allowOrigin = configuredOrigin ?? requestOrigin ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
