const DEFAULT_ORIGINS = new Set([
  "https://zaiiik.github.io",
  "https://localhost",
  "http://localhost",
  "http://127.0.0.1",
]);

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get("LEVELING_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...configured]);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = allowedOrigins().has(origin) ? origin : "https://zaiiik.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders(req) })
    : null;
}

export function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "UNKNOWN_ERROR");
  return value.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 120) || "UNKNOWN_ERROR";
}
