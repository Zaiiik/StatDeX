import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const APP_URL = "https://zaiiik.github.io/StatDeX/?stripe_test=success";

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "cache-control": "no-store",
      },
    });
  }

  return new Response(null, {
    status: 303,
    headers: {
      "location": APP_URL,
      "cache-control": "no-store, max-age=0, must-revalidate",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
});
