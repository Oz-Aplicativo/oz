// Edge Function: cancelar-ativacao
// OZ App - Supabase Edge Function
//
// Bar cancela entrada individual do cliente. Cria free_credit de compensacao no servidor.
// Valida: JWT, role=bar, ownership da ativacao, tipo cancelavel.
//
// Body: { activation_id: string, user_id: string, user_name: string }
// Header: Authorization: Bearer <jwt-do-bar>
// Respostas: 201 cancelado+free_credit | 200 ja cancelado | 400 tipo invalido | 403 nao pertence

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Tipos que NÃO podem ser cancelados pelo bar
const TIPOS_NAO_CANCELAVEIS = [
  "free_credit",
  "free_credit_used",
  "free_used",
  "night_checkin",
];

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return corsResponse({ error: "Authorization header ausente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Valida JWT
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return corsResponse({ error: "Token inválido ou expirado." }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Valida role do usuário autenticado ────────────────────────────────────
  const { data: dbUser, error: uErr } = await supabase
    .from("users")
    .select("id, role, bar_id, bar_name, name")
    .eq("id", user.id)
    .single();

  if (uErr || !dbUser) return corsResponse({ error: "Usuário não encontrado." }, 404);
  if (dbUser.role !== "bar") {
    return corsResponse({ error: "Apenas usuários com perfil 'bar' podem cancelar ativações." }, 403);
  }

  const barId   = dbUser.bar_id || dbUser.id;
  const barName = dbUser.bar_name || dbUser.name || "";

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: { activation_id?: string; user_id?: string; user_name?: string };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { activation_id, user_id, user_name } = body;
  if (!activation_id) return corsResponse({ error: "activation_id é obrigatório." }, 400);
  if (!user_id)       return corsResponse({ error: "user_id é obrigatório." }, 400);

  // ── Busca a ativação ──────────────────────────────────────────────────────
  const { data: activation, error: aErr } = await supabase
    .from("activations")
    .select("id, user_id, bar_id, bar_name, type, status, amount")
    .eq("id", activation_id)
    .single();

  if (aErr || !activation) return corsResponse({ error: "Ativação não encontrada." }, 404);

  // ── Valida que a ativação pertence ao bar autenticado ─────────────────────
  if (activation.bar_id !== barId) {
    console.warn(
      `[cancelar-ativacao] Bar ${barId} tentou cancelar ativação do bar ${activation.bar_id}`
    );
    return corsResponse({
      error: "Esta ativação não pertence ao seu bar.",
    }, 403);
  }

  // ── Valida que o user_id bate com o da ativação ───────────────────────────
  if (activation.user_id !== user_id) {
    return corsResponse({ error: "user_id não corresponde à ativação informada." }, 400);
  }

  // ── Idempotência ──────────────────────────────────────────────────────────
  if (activation.status === "cancelled") {
    return corsResponse({ message: "Ativação já estava cancelada.", activation }, 200);
  }

  // ── Valida tipo cancelável ────────────────────────────────────────────────
  if (TIPOS_NAO_CANCELAVEIS.includes(activation.type)) {
    return corsResponse({
      error: `Ativações do tipo '${activation.type}' não podem ser canceladas pelo bar.`,
    }, 400);
  }

  const agora = new Date().toISOString();

  // ── 1. Cancela a ativação ─────────────────────────────────────────────────
  const { data: cancelada, error: cErr } = await supabase
    .from("activations")
    .update({
      status:       "cancelled",
      cancelled_by: barId,
      cancelled_at: agora,
      updated_at:   agora,
    })
    .eq("id", activation_id)
    .select()
    .single();

  if (cErr) {
    console.error("[cancelar-ativacao] Erro ao cancelar ativação:", cErr);
    return corsResponse({ error: "Erro ao cancelar ativação." }, 500);
  }

  // ── 2. Cria free_credit de compensação para o cliente ─────────────────────
  // O servidor define amount=0 e type='free_credit' — nunca vem do browser.
  const { data: freeCredit, error: fErr } = await supabase
    .from("activations")
    .insert({
      user_id:       user_id,
      user_name:     user_name || "",
      bar_id:        barId,
      bar_name:      barName,
      type:          "free_credit",
      amount:        0,             // sempre zero — compensação gratuita
      qr_code:       "",
      expires_at:    "",            // crédito gratuito não expira
      origin:        "bar_cancellation",
      origin_act_id: activation_id,
      promoter_id:   "",
      promoter_code: "",
      status:        "active",
      created_at:    agora,
    })
    .select()
    .single();

  if (fErr) {
    // Não reverte o cancelamento — apenas loga o erro do free_credit
    console.error("[cancelar-ativacao] Erro ao criar free_credit de compensação:", fErr);
  }

  console.log(
    `[cancelar-ativacao] Ativação ${activation_id} cancelada pelo bar ${barId}.` +
    (freeCredit ? ` Free credit ${freeCredit.id} criado para ${user_id}.` : " Free credit NÃO criado.")
  );

  return corsResponse({
    success:    true,
    activation: cancelada,
    free_credit: freeCredit || null,
  }, 201);
});
