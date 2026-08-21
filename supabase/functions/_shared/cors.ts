// ---------------------------------------------------------------------------
// Intestazioni CORS condivise da tutte le Edge Function.
// ---------------------------------------------------------------------------
// In produzione conviene restringere `Access-Control-Allow-Origin` al dominio
// dell'applicazione impostando il secret ALLOWED_ORIGIN:
//     supabase secrets set ALLOWED_ORIGIN=https://chamahub.example.com
// ---------------------------------------------------------------------------

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
