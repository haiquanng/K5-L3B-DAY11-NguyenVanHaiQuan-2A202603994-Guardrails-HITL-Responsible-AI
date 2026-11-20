// Server-only transport. API keys stay in Python's root .env; the browser never sees them.
const backend = process.env.ARENA_BACKEND_URL ?? "http://127.0.0.1:8011";

function clientIp(request: Request): string {
  // Cloudflare Tunnel sets cf-connecting-ip; fall back to the first forwarded hop.
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "local";
}

export async function proxyBackend(
  request: Request,
  endpoint: string,
  method: "GET" | "POST" = "GET",
) {
  if (method === "POST") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const extra = (process.env.ARENA_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
    const originHost = origin ? new URL(origin).host : null;
    const allowed =
      !originHost ||
      originHost === host ||
      originHost.endsWith(".trycloudflare.com") ||
      originHost.endsWith(".vercel.app") ||
      extra.includes(origin ?? "");
    if (!allowed) {
      return Response.json({ error: "Yêu cầu khác nguồn bị từ chối." }, { status: 403 });
    }
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
      return Response.json({ error: "Cần gửi JSON." }, { status: 415 });
    }
  }
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), method === "POST" ? 120_000 : 8_000);
  try {
    const body = method === "POST" ? await request.text() : undefined;
    if (body && Buffer.byteLength(body) > 12_000) {
      return Response.json({ error: "Prompt quá dài." }, { status: 413 });
    }
    const response = await fetch(`${backend}${endpoint}`, {
      method,
      body,
      cache: "no-store",
      signal: abort.signal,
      headers: {
        "X-Arena-Client": clientIp(request),
        // Random per-browser id: a whole class often shares one school IP.
        "X-Arena-Uid": (request.headers.get("x-arena-uid") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64),
        // Shared secret: the tunnel is public, so the backend only answers this app.
        ...(process.env.ARENA_TOKEN ? { "X-Arena-Token": process.env.ARENA_TOKEN } : {}),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Chưa kết nối được arena backend. Thử lại sau ít giây." },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
