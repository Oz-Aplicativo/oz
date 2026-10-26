// Edge Function: criar-ativacao
// OZ App - Supabase Edge Function
//
// Cria ativacao individual (R$5 fixo no servidor). Distribui comissoes internamente.
// Impede dupla ativacao no mesmo bar/dia. Atualiza contadores do usuario.
//
// Body: { bar_id, bar_name, qr_code, expires_at, promoter_id?, promoter_code?, pick_promoter?, benefit_date? }
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

// ─── Constantes ──────────────────────────────────────────────────────────────
const AMOUNT_INDIVIDUAL  = 5;  // R$5 fixo para ativação individual
const MAX_ACTS_COMISSAO  = 3;
const PICK_FLAT          = 1;
const REF_FULL           = 5;
const REF_SPLIT          = 4;

// ─── Helper de earnings (idêntico ao gerar-earning) ─────────────────────────
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

  const { data: promoter } = await supabase
    .from("users")
    .select("id, balance")
    .eq("id", promoterId)
    .single();

  if (!promoter) return null;

  await supabase
    .from("users")
    .update({ balance: Number(promoter.balance || 0) + amount, updated_at: Date.now() })
    .eq("id", promoterId);

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

  if (eErr) console.error(`[criar-ativacao] Erro ao inserir earning:`, eErr);
  return earning;
}

async function distribuirComissoes(
  supabase: ReturnType<typeof createClient>,
  activation: Record<string, unknown>
) {
  const activationId = activation.id as string;
  const userId       = activation.user_id as string;
  const refId        = activation.promoter_id as string | null;
  const pickId       = activation.pick_promoter as string | null;
  const barName      = (activation.bar_name as string) || "oz";

  const TIPOS_PAGOS = ["individual", "advance_individual", "night_link", "advance_night", "night"];

  const { count } = await supabase
    .from("activations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["confirmado", "usado", "active"])
    .in("type", TIPOS_PAGOS)
    .neq("id", activationId);

  const actsThisUser = count ?? 0;
  const withinCap    = actsThisUser < MAX_ACTS_COMISSAO;
  const samePromoter = refId && pickId && refId === pickId;
  const label        = "Unitário";

  const tasks = [];

  if (refId && withinCap && pickId && !samePromoter) {
    tasks.push(creditarEarning(supabase, { promoterId: refId,  amount: REF_SPLIT, reason: `Comissão ref (split) — ${label} em ${barName}`, activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
    tasks.push(creditarEarning(supabase, { promoterId: pickId, amount: PICK_FLAT,  reason: `Comissão pick — ${label} em ${barName}`,        activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (refId && withinCap && samePromoter) {
    tasks.push(creditarEarning(supabase, { promoterId: refId,  amount: REF_FULL,  reason: `Comissão ref+pick — ${label} em ${barName}`,    activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (refId && withinCap && !pickId) {
    tasks.push(creditarEarning(supabase, { promoterId: refId,  amount: REF_FULL,  reason: `Comissão ref — ${label} em ${barName}`,         activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (refId && !withinCap && pickId && !samePromoter) {
    tasks.push(creditarEarning(supabase, { promoterId: pickId, amount: PICK_FLAT,  reason: `Comissão pick (cap) — ${label} em ${barName}`, activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  } else if (!refId && pickId) {
    tasks.push(creditarEarning(supabase, { promoterId: pickId, amount: PICK_FLAT,  reason: `Comissão pick (sem ref) — ${label} em ${barName}`, activationId, userId, actsThisUser: actsThisUser + 1, origin: barName }));
  }

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

  let body: {
    bar_id: string;
    bar_name: string;
    qr_code: string;
    expires_at: string;
    promoter_id?: string;
    promoter_code?: string;
    pick_promoter?: string;
    benefit_date?: string;  // YYYY-MM-DD — data do benefício agendado (null = hoje)
  };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { bar_id, bar_name, qr_code, expires_at, promoter_id, promoter_code, pick_promoter, benefit_date } = body;

  if (!bar_id)     return corsResponse({ error: "bar_id é obrigatório." }, 400);
  if (!bar_name)   return corsResponse({ error: "bar_name é obrigatório." }, 400);
  if (!qr_code)    return corsResponse({ error: "qr_code é obrigatório." }, 400);
  if (!expires_at) return corsResponse({ error: "expires_at é obrigatório." }, 400);

  // ── Valida bar ────────────────────────────────────────────────────────────
  const { data: bar } = await supabase
    .from("bars")
    .select("id, name, active")
    .eq("id", bar_id)
    .single();

  if (!bar) return corsResponse({ error: "Bar não encontrado." }, 404);
  if (!bar.active) return corsResponse({ error: "Bar inativo." }, 400);

  // ── Busca dados do usuário ────────────────────────────────────────────────
  const { data: dbUser } = await supabase
    .from("users")
    .select("id, name, activations_count, total_saved, referred_by")
    .eq("id", user.id)
    .single();

  if (!dbUser) return corsResponse({ error: "Usuário não encontrado." }, 404);

  // ── Impede dupla ativação individual no mesmo dia no mesmo bar ───────────
  // Usa BRT (UTC-3) para coincidir com _todayStr() do frontend
  const nowBRT     = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayBRT   = nowBRT.toISOString().split("T")[0];
  const inicioDiaMs = new Date(todayBRT + "T03:00:00.000Z").getTime(); // 00h BRT = 03h UTC
  const fimDiaMs    = inicioDiaMs + 86_400_000;

  const { data: jaAtivou } = await supabase
    .from("activations")
    .select("id")
    .eq("user_id", user.id)
    .eq("bar_id", bar_id)
    .in("type", ["individual", "advance_individual"])
    .not("status", "eq", "cancelled")
    .eq("benefit_date", todayBRT);

  if (jaAtivou && jaAtivou.length > 0) {
    return corsResponse({ error: "Você já ativou este bar hoje." }, 409);
  }

  // ── Cria ativação com amount fixo R$5 ────────────────────────────────────
  const { data: activation, error: aErr } = await supabase
    .from("activations")
    .insert({
      user_id:       user.id,
      user_name:     dbUser.name,
      bar_id,
      bar_name,
      type:          "individual",
      amount:        AMOUNT_INDIVIDUAL,  // R$5 fixo — não vem do browser
      qr_code,
      expires_at,
      promoter_id:   promoter_id   || dbUser.referred_by || null,
      promoter_code: promoter_code || null,
      pick_promoter: pick_promoter || null,
      benefit_date:  benefit_date  || null,  // data do benefício (YYYY-MM-DD); null = hoje
      status:        "active",
      created_at:    new Date().toISOString(),
    })
    .select()
    .single();

  if (aErr || !activation) {
    console.error("[criar-ativacao] Erro ao criar ativação:", aErr);
    return corsResponse({ error: "Erro ao criar ativação." }, 500);
  }

  // ── Atualiza contadores do usuário ────────────────────────────────────────
  await supabase
    .from("users")
    .update({
      activations_count: (dbUser.activations_count || 0) + 1,
      total_saved:       (dbUser.total_saved || 0) + AMOUNT_INDIVIDUAL,
      updated_at:        new Date().toISOString(),
    })
    .eq("id", user.id);

  // ── Incrementa promoção ativa (se existir) ────────────────────────────────
  const { data: promo } = await supabase
    .from("promotions")
    .select("id, activations_count")
    .eq("bar_id", bar_id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (promo) {
    await supabase
      .from("promotions")
      .update({
        activations_count: (promo.activations_count || 0) + 1,
        updated_at:        new Date().toISOString(),
      })
      .eq("id", promo.id);
  }

  // ── Distribui comissões ───────────────────────────────────────────────────
  const earnings = await distribuirComissoes(supabase, activation);

  return corsResponse({ success: true, activation, earnings }, 201);
});
