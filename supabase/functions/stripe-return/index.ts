import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const page = (status: "success" | "cancel") => {
  const success = status === "success";
  const title = success ? "Paiement confirmé" : "Paiement annulé";
  const message = success
    ? "Stripe a confirmé ton paiement. Ton accès LEVELING-APP va se mettre à jour automatiquement."
    : "Aucun paiement n’a été effectué. Tu peux revenir à LEVELING-APP quand tu veux.";
  const badge = success ? "PAIEMENT VALIDÉ" : "PAIEMENT ANNULÉ";
  const badgeColor = success ? "#27e789" : "#ff4f8b";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · LEVELING-APP</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 15%,#250038 0,#0b0710 42%,#050507 100%);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;padding:24px}.card{width:min(520px,100%);border:1px solid rgba(189,0,255,.55);border-radius:26px;background:rgba(10,8,15,.94);padding:30px 24px;text-align:center;box-shadow:0 0 40px rgba(189,0,255,.15)}.brand{font-weight:1000;letter-spacing:.16em;font-size:1.15rem;background:linear-gradient(90deg,#bd00ff,#ff007f);-webkit-background-clip:text;background-clip:text;color:transparent}.badge{display:inline-block;margin:22px 0 12px;padding:8px 13px;border-radius:999px;border:1px solid ${badgeColor};color:${badgeColor};font-size:.72rem;font-weight:900;letter-spacing:.08em}h1{margin:6px 0 10px;font-size:1.65rem}p{color:#b8b4c3;line-height:1.55;margin:0 auto 24px;max-width:410px}.btn{width:100%;border:0;border-radius:15px;padding:15px 18px;font-weight:1000;font-size:1rem;color:#fff;background:linear-gradient(90deg,#9400ff,#ff008d);cursor:pointer}.hint{margin-top:14px;font-size:.72rem;color:#777282}
</style>
</head>
<body>
<main class="card">
<div class="brand">LEVELING-APP</div>
<div class="badge">${badge}</div>
<h1>${title}</h1>
<p>${message}</p>
<button class="btn" onclick="backToApp()">RETOURNER À LEVELING-APP</button>
<div class="hint">Si le bouton ne revient pas à l’app, utilise simplement le bouton Retour de ton navigateur.</div>
</main>
<script>function backToApp(){try{history.go(-2)}catch(e){history.back()}}</script>
</body>
</html>`;
};

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") === "success" ? "success" : "cancel";
  return new Response(page(status), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
});