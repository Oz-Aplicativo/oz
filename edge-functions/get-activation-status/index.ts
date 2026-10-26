// Edge Function: get-activation-status
// OZ App - Supabase Edge Function
//
// Consultada pelo frontend em polling para saber se o pagamento foi aprovado
// e o beneficio ja esta ativo. O frontend nao confia no retorno do pagamento —
// ele consulta este endpoint a cada 3s ate receber status='active' ou 'failed'.
//
// GET /get-activation-status?activation_id=<uuid>
// Header: Authorization: Bearer <jwt>
//
// Retorna:
//   { status: 'pending_payment' | 'active' | 'cancelled' | 'failed' }
//   + dados completos da ativacao quando active

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function corsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return corsResponse({ error: "Authorization header ausente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return corsResponse({ error: "Token invalido ou expirado." }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Lê activation_id da query string ─────────────────────────────────────
  const url          = new URL(req.url);
  const activationId = url.searchParams.get("activation_id");

  if (!activationId) {
    return corsResponse({ error: "activation_id e obrigatorio." }, 400);
  }

  // ── Busca a ativação garantindo que pertence ao usuario autenticado ───────
  const { data: activation, error: actErr } = await supabase
    .from("activations")
    .select("id, status, type, bar_id, bar_name, expires_at, amount, created_at")
    .eq("id", activationId)
    .eq("user_id", user.id)  // garante que so o dono consulta
    .single();

  if (actErr || !activation) {
    return corsResponse({ error: "Ativacao nao encontrada." }, 404);
  }

  // ── Mapeia status para resposta simplificada ao frontend ──────────────────
  // pending_payment → aguardando pagamento
  // active          → beneficio ativo (webhook confirmou)
  // cancelled       → pagamento falhou ou expirou
  const statusMap: Record<string, string> = {
    pending_payment: "pending_payment",
    active:          "active",
    cancelled:       "cancelled",
    failed:          "failed",
  };

  const statusFrontend = statusMap[activation.status] || activation.status;

  // ── Retorna dados completos quando ativo ──────────────────────────────────
  if (activation.status === "active") {
    return corsResponse({
      status:     "active",
      activation: {
        id:         activation.id,
        type:       activation.type,
        bar_id:     activation.bar_id,
        bar_name:   activation.bar_name,
        expires_at: activation.expires_at,
        amount:     activation.amount,
      },
    }, 200);
  }

  // ── Retorna apenas o status para outros casos ─────────────────────────────
  return corsResponse({ status: statusFrontend }, 200);
});
