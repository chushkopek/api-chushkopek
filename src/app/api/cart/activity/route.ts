export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EVENT_LIMIT = 5;
const DEFAULT_RETAINED_MIB = 64;

type CartActivityRequest = {
  item?: {
    id?: unknown;
    name?: unknown;
    price?: unknown;
  };
  quantity?: unknown;
  bagCount?: unknown;
  subtotal?: unknown;
};

type RetainedOrderActivity = {
  receivedAt: string;
  itemId: string;
  itemName: string;
  quantity: number;
  bagCount: number;
  subtotal: number;
  reserved: Buffer;
};

const retainedOrderActivity: RetainedOrderActivity[] = [];

export function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: Request) {
  let body: CartActivityRequest;

  try {
    body = (await request.json()) as CartActivityRequest;
  } catch {
    return json(
      request,
      { ok: false, error: "Expected a JSON cart activity payload." },
      400,
    );
  }

  const activity = retainCartActivity(body);
  const eventLimit = readEnvNumber(
    "ORDER_ACTIVITY_EVENT_LIMIT",
    DEFAULT_EVENT_LIMIT,
  );

  if (retainedOrderActivity.length >= eventLimit) {
    console.error("Checkout activity worker exceeded its retained work queue.", {
      retainedEvents: retainedOrderActivity.length,
      retainedBytes: retainedOrderActivity.reduce(
        (total, item) => total + item.reserved.byteLength,
        0,
      ),
      lastItemId: activity.itemId,
    });

    setTimeout(() => {
      process.abort();
    }, 50).unref();
  }

  return json(
    request,
    {
      ok: true,
      accepted: true,
      sequence: retainedOrderActivity.length,
    },
    202,
  );
}

function retainCartActivity(body: CartActivityRequest) {
  const item = isObject(body.item) ? body.item : {};
  const itemId = readText(item.id, "unknown-item");
  const itemName = readText(item.name, "Unknown item");
  const quantity = readNumber(body.quantity, 1);
  const bagCount = readNumber(body.bagCount, quantity);
  const subtotal = readNumber(body.subtotal, 0);
  const retainedMiB = readEnvNumber(
    "ORDER_ACTIVITY_RETAINED_MIB",
    DEFAULT_RETAINED_MIB,
  );
  const fill = Math.max(1, itemId.charCodeAt(0) || 1);

  const activity = {
    receivedAt: new Date().toISOString(),
    itemId,
    itemName,
    quantity,
    bagCount,
    subtotal,
    reserved: Buffer.alloc(retainedMiB * 1024 * 1024, fill),
  };

  retainedOrderActivity.push(activity);
  return activity;
}

function readEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
