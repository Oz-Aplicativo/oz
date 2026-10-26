// Edge Function: gerar-earning
// OZ App - Supabase Edge Function
//
// Recebe uma ativacao ja gravada e distribui comissoes dos promoters no servidor.
//
// Regras de negocio:
//   Unitario (individual): total R$5 - distribuivel ao promoter R$5
//   Noite Toda (night/night_link): total R$10 - distribuivel R$5 (plataforma retém R$5)
//   MAX_ACTS=3  PICK_FLAT=R$1  REF_FULL=R$5  REF_SPLIT=R$4
//
//   Cenario A - ref dentro do cap + pick diferente: ref R$4, pick R$1
//   Cenario B - ref === pick, dentro do cap:        ref R$5
//   Cenario C - ref dentro do cap, sem pick:        ref R$5
//   Cenario D - ref fora do cap, com pick:          pick R$1
//   Cenario E - ref fora do cap, sem pick:          ninguem recebe
//   Cenario F - sem ref, com pick:                  pick R$1
//   Cenario G - sem ref, sem pick:                  ninguem recebe
//
// Body: { activation_id: string }
// Header: Authorization: Bearer <jwt>

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS ──────────────────────────────────────────────────────────────────
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

// ─── Constantes financeiras ─────────────────────────────────────────────────
const MAX_ACTS           = 3;
const PICK_FLAT          = 1;
const REF_FULL           = 5;
const REF_SPLIT          = 4;
const NIGHT_TOTAL        = 10;
const UNIT_TOTAL         = 5;
const PLATFORM_CUT_NIGHT = 5;

// ─── Helper: creditar balance + criar earning ───────────────────────────────
async function creditarEarning(
  supabase: ReturnType<typeof createClient>,
  params: {
    promoterId:   string;
    amount:       number;
    reason:       string;
    activationId: string;
    userId:       string;
    actsThisUser: number;
    origin:       string;
  }
) {
  const { promoterId, amount, reason, activationId, userId, actsThisUser, origin } = params;
  if (amount <= 0) return null;

  const { data: promoter, error: pErr } = await supabase
    .from("users")
    .select("id, balance")
    .eq("id", promoterId)
    .single();

  if (pErr || !promoter) {
    console.error(`[gerar-earning] Promoter ${promoterId} não encontrado:`, pErr);
    return null;
  }

  const novoBalance = Number(promoter.balance || 0) + amount;

  const { error: bErr } = await supabase
    .from("users")
    .update({ balance: novoBalance, updated_at: Date.now() })
    .eq("id", promoterId);

  if (bErr) {
    console.error(`[gerar-earning] Erro ao atualizar balance:`, bErr);
    return null;
  }

  const { data: earning, error: eErr } = await supabase
    .from("earnings")
    .insert({
      promoter_id:    promoterId,
      promoter_code:  promoterId,
      user_id:        userId,
      activation_id:  activationId,
      amount,
      reason,
      acts_this_user: actsThisUser,
      origin,
      status:         "pendente",
      created_at:     Date.now(),
    })
    .select()
    .single();

  if (eErr) {
    console.error(`[gerar-earning] Erro ao criar earning:`, eErr);
    return null;
  }

  return earning;
}

// ─── Lógica principal de comissões ─────────────────────────────────────────
async function resolveCommissions(
  supabase: ReturnType<typeof createClient>,
  activation: Record<string, unknown>
) {
  const activationId   = activation.id as string;
  const userId         = activation.user_id as string;
  const type           = activation.type as string;
  const refId          = activation.promoter_id as string | null;
  // night_link, night e advance_night usam night_pick_promoter; demais usam pick_promoter
  const isNight        = type === "night" || type === "night_link" || type === "advance_night";
  const pickId         = (
    isNight
      ? (activation.night_pick_promoter || activation.pick_promoter)
      : activation.pick_promoter
  ) as string | null;
  const barName        = (activation.bar_name as string) || "oz";
  const distributable  = isNight
    ? NIGHT_TOTAL - PLATFORM_CUT_NIGHT
    : UNIT_TOTAL;

  if (distributable <= 0) return [];

  // Conta earnings ja gerados para este par usuario+promoter (ref)
  // Fonte de verdade definitiva para o cap — nao depende de filtros de tipo/status
  const { data: earningsRef } = refId
    ? await supabase
        .from("earnings")
        .select("id")
        .eq("user_id", userId)
        .eq("promoter_id", refId)
    : { data: [] };

  const actsThisUser = earningsRef?.length ?? 0;
  const withinCap    = actsThisUser < MAX_ACTS;
  const samePromoter = refId && pickId && refId === pickId;
  const label        = isNight ? "Noite Toda" : "Unitário";

  const tasks: ReturnType<typeof creditarEarning>[] = [];

  if (refId && withinCap && pickId && !samePromoter) {
    // Cenário A
    tasks.push(creditarEarning(supabase, { promoterId: refId,  amount: REF_SPLIT, reason: `Comissão ref (split) — ${label} em ${barName}`,  activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
    tasks.push(creditarEarning(supabase, { promoterId: pickId, amount: PICK_FLAT,  reason: `Comissão pick — ${label} em ${barName}`,          activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (refId && withinCap && samePromoter) {
    // Cenário B
    tasks.push(creditarEarning(supabase, { promoterId: refId,  amount: REF_FULL,  reason: `Comissão ref+pick — ${label} em ${barName}`,      activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (refId && withinCap && !pickId) {
    // Cenário C
    tasks.push(creditarEarning(supabase, { promoterId: refId,  amount: REF_FULL,  reason: `Comissão ref — ${label} em ${barName}`,           activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (refId && !withinCap && pickId && !samePromoter) {
    // Cenário D
    tasks.push(creditarEarning(supabase, { promoterId: pickId, amount: PICK_FLAT,  reason: `Comissão pick (cap atingido) — ${label} em ${barName}`, activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (!refId && pickId) {
    // Cenário F
    tasks.push(creditarEarning(supabase, { promoterId: pickId, amount: PICK_FLAT,  reason: `Comissão pick (sem ref) — ${label} em ${barName}`, activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  }
  // Cenários E e G: ninguém recebe — não enfileira nada

  return await Promise.all(tasks);
}

// ─── Handler principal ──────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return corsResponse({ error: "Authorization header ausente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return corsResponse({ error: "Token inválido ou expirado." }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  let body: { activation_id?: string };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { activation_id } = body;
  if (!activation_id) return corsResponse({ error: "activation_id é obrigatório." }, 400);

  const { data: activation, error: actErr } = await supabase
    .from("activations")
    .select("*")
    .eq("id", activation_id)
    .single();

  if (actErr || !activation) return corsResponse({ error: "Ativação não encontrada." }, 404);

  const EXCLUIDOS = ["cancelled", "free_credit", "free_credit_used", "free_used", "night_checkin"];
  if (EXCLUIDOS.includes(activation.type) || activation.status === "cancelled") {
    return corsResponse({ error: "Tipo de ativação não gera comissão.", type: activation.type }, 400);
  }

  const { data: existingEarnings } = await supabase
    .from("earnings")
    .select("id")
    .eq("activation_id", activation_id);

  if (existingEarnings && existingEarnings.length > 0) {
    return corsResponse({ error: "Comissões já processadas para esta ativação.", earnings: existingEarnings }, 409);
  }

  try {
    const earnings = await resolveCommissions(supabase, activation);
    return corsResponse({ success: true, earnings }, 201);
  } catch (err) {
    console.error("[gerar-earning] Erro inesperado:", err);
    return corsResponse({ error: "Erro interno ao processar comissões." }, 500);
  }
});
