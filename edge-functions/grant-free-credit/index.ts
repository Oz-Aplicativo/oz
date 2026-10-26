// Edge Function: grant-free-credit
// OZ App - Supabase Edge Function
//
// Concede free_credit ao indicador quando o indicado faz sua 1a ativacao paga.
// Idempotente. So role 'cliente' recebe. Expira em 90 dias.
//
// Body: { new_user_id: string, inviter_id: string }
// Header: Authorization: Bearer <jwt>

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const FREE_CREDIT_EXPIRY_DAYS = 90;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

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

  // ── Body ────────────────────────────────────────────────────────────────
  let body: { new_user_id?: string; inviter_id?: string };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { new_user_id, inviter_id } = body;

  if (!new_user_id) return corsResponse({ error: "new_user_id é obrigatório." }, 400);
  if (!inviter_id)  return corsResponse({ error: "inviter_id é obrigatório." }, 400);

  // ── Valida usuário que indicou ─────────────────────────────────────────
  const { data: inviter } = await supabase
    .from("users")
    .select("id, name, role")
    .eq("id", inviter_id)
    .single();

  if (!inviter) {
    return corsResponse({ error: "Usuário indicador não encontrado." }, 404);
  }
  if (inviter.role !== "cliente") {
    return corsResponse({
      message: "Indicador não é cliente — free_credit não aplicável.",
      skipped: true,
    }, 200);
  }

  // ── Verifica se já foi concedido (idempotência) ───────────────────────
  const originKey = `FREE-INVITE-${new_user_id}`;

  const { data: existingCredits } = await supabase
    .from("activations")
    .select("id")
    .eq("user_id", inviter_id)
    .eq("type", "free_credit")
    .ilike("qr_code", `${originKey}%`)
    .not("status", "eq", "cancelled");

  if (existingCredits && existingCredits.length > 0) {
    return corsResponse({
      message:  "Free credit já concedido para esta indicação.",
      skipped:  true,
      existing: existingCredits[0],
    }, 200);
  }

  // ── Verifica a 1ª ativação do novo usuário ─────────────────────────────
  // Conta apenas ativações com status active (já confirmadas)
  const TIPOS_PAGOS = ["individual", "advance_individual", "night_link", "advance_night", "night"];
  const { count } = await supabase
    .from("activations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", new_user_id)
    .eq("status", "active")
    .in("type", TIPOS_PAGOS);

  // Só concede se for exatamente a 1ª ativação active
  if ((count ?? 0) !== 1) {
    return corsResponse({
      message: `Não é a primeira ativação ativa do novo usuário (count=${count}) — free_credit não aplicável.`,
      skipped: true,
    }, 200);
  }

  // ── Cria free_credit ───────────────────────────────────────────────────
  const expiry = new Date(Date.now() + FREE_CREDIT_EXPIRY_DAYS * 86_400_000).toISOString();
  const qrCode = `${originKey}-${Date.now()}`;

  const { data: credit, error: cErr } = await supabase
    .from("activations")
    .insert({
      user_id:      inviter_id,
      user_name:    inviter.name,
      bar_id:       null,
      bar_name:     "OZ Platform",
      type:         "free_credit",
      amount:       0,
      qr_code:      qrCode,
      expires_at:   expiry,
      origin:       "referral",
      origin_act_id: new_user_id,
      status:       "active",
      created_at:   Date.now(),
      updated_at:   Date.now(),
    })
    .select()
    .single();

  if (cErr) {
    console.error("[grant-free-credit] Erro ao criar free_credit:", JSON.stringify(cErr));
    return corsResponse({ error: "Erro ao criar crédito gratuito.", detail: cErr?.message, hint: cErr?.hint, code: cErr?.code }, 500);
  }

  console.log(`[grant-free-credit] Free credit concedido ao inviter ${inviter.name} (${inviter_id})`);

  return corsResponse({ success: true, credit }, 201);
});
