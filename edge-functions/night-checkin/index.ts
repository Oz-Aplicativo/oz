// Edge Function: night-checkin
// OZ App - Supabase Edge Function
//
// Registra check-in de um cliente em um bar via "Noite Toda".
// SEGURANÇA: valida no servidor que o cliente possui um night_link
// com status='active' antes de criar o night_checkin.
// O frontend NÃO pode inserir night_checkin diretamente — apenas esta
// edge function o faz, usando service_role após validação.
//
// Body: { bar_id, bar_name }
// Header: Authorization: Bearer <jwt>

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

// Retorna a data de hoje no fuso BRT (UTC-3), respeitando a regra das 06h:
// madrugadas antes das 06h BRT pertencem ao dia anterior.
// Isso garante consistência com _todayStr() do frontend.
function todayBRT(): string {
  // Desloca -3h para obter hora BRT
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  // Regra das 06h: antes das 06h BRT pertence ao dia anterior
  const hourBRT = now.getUTCHours(); // após o offset já é hora BRT
  if (hourBRT < 6) now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().split("T")[0]; // YYYY-MM-DD no fuso BRT
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return corsResponse({ error: "Authorization header ausente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Valida JWT do cliente
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return corsResponse({ error: "Token inválido ou expirado." }, 401);

  // Cliente service_role para operações no banco
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Body ──────────────────────────────────────────────────────────────────
  let body: { bar_id?: string; bar_name?: string };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { bar_id, bar_name } = body;
  if (!bar_id)   return corsResponse({ error: "bar_id é obrigatório." }, 400);
  if (!bar_name) return corsResponse({ error: "bar_name é obrigatório." }, 400);

  // ── Busca dados do usuário ─────────────────────────────────────────────────
  const { data: dbUser } = await supabase
    .from("users")
    .select("id, name, email, activations_count, referred_by")
    .eq("id", user.id)
    .single();

  if (!dbUser) return corsResponse({ error: "Usuário não encontrado." }, 404);

  const userName = dbUser.name || dbUser.email?.split("@")[0] || "Cliente";

  // ── Valida bar ────────────────────────────────────────────────────────────
  const { data: bar } = await supabase
    .from("bars")
    .select("id, name, active")
    .eq("id", bar_id)
    .single();

  if (!bar)        return corsResponse({ error: "Bar não encontrado." }, 404);
  if (!bar.active) return corsResponse({ error: "Bar inativo." }, 400);

  // ── VALIDAÇÃO PRINCIPAL: verifica night_link ativo ─────────────────────────
  // O cliente DEVE ter um night_link com status='active' criado nesta sessão noturna.
  // Busca por created_at dentro da janela da noite (últimas 30h para cobrir madrugadas).
  const windowMs  = Date.now() - 30 * 60 * 60 * 1000; // 30 horas atrás em ms

  const { data: nightLink } = await supabase
    .from("activations")
    .select("id, qr_code, expires_at, night_session, bar_id, bar_name")
    .eq("user_id", user.id)
    .in("type", ["night_link", "advance_night"])
    .eq("status", "active")
    .gte("created_at", windowMs)   // criado nas últimas 30h (int8 ms)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!nightLink) {
    console.warn(`[night-checkin] user:${user.id} tentou check-in em bar:${bar_id} sem night_link ativo.`);
    return corsResponse({
      error: "Nenhuma Noite Toda ativa encontrada. Adquira o Link da Noite Toda primeiro.",
    }, 403);
  }

  console.log(`[night-checkin] night_link:${nightLink.id} válido para user:${user.id} → bar:${bar_id}`);

  // ── Verifica se já fez check-in neste bar nesta sessão ──────────────────
  const { data: jaCheckin } = await supabase
    .from("activations")
    .select("id")
    .eq("user_id", user.id)
    .eq("bar_id", bar_id)
    .eq("type", "night_checkin")
    .eq("night_session", nightLink.night_session || nightLink.id)
    .eq("status", "active")
    .limit(1);

  if (jaCheckin && jaCheckin.length > 0) {
    return corsResponse({
      error: "Você já fez check-in neste bar nesta sessão.",
      already_checked_in: true,
    }, 409);
  }

  // ── Busca night_link para herdar promoter_id e night_pick_promoter ─────────
  const { data: nightLinkFull } = await supabase
    .from("activations")
    .select("id, qr_code, expires_at, night_session, bar_id, bar_name, promoter_id, night_pick_promoter")
    .eq("id", nightLink.id)
    .single();

  const inheritedPromoterId      = nightLinkFull?.promoter_id       || null;
  const inheritedNightPickPromo  = nightLinkFull?.night_pick_promoter || null;

  // ── Registra night_checkin ────────────────────────────────────────────────
  const { data: checkin, error: insertErr } = await supabase
    .from("activations")
    .insert({
      user_id:              user.id,
      user_name:            userName,
      bar_id:               bar.id,
      bar_name:             bar.name,
      type:                 "night_checkin",
      amount:               0,
      qr_code:              nightLink.qr_code || nightLink.id,
      expires_at:           nightLink.expires_at || "",
      night_session:        nightLink.night_session || nightLink.id,
      promoter_id:          inheritedPromoterId,
      promoter_code:        inheritedPromoterId,
      night_pick_promoter:  inheritedNightPickPromo,
      benefit_date:         todayBRT(),
      status:               "active",
      created_at:           Date.now(),
      updated_at:           Date.now(),
    })
    .select()
    .single();

  if (insertErr || !checkin) {
    console.error(`[night-checkin] Erro ao inserir checkin:`, insertErr);
    return corsResponse({ error: "Erro ao registrar check-in.", detail: insertErr?.message }, 500);
  }

  // ── Atualiza contador de ativações do usuário ─────────────────────────────
  await supabase
    .from("users")
    .update({
      activations_count: (dbUser.activations_count || 0) + 1,
      updated_at:        Date.now(),
    })
    .eq("id", user.id);

  console.log(`[night-checkin] Check-in ${checkin.id} registrado — user:${user.id} bar:${bar_id}`);

  // night_checkin é entrada gratuita derivada de um night_link já pago.
  // As comissões foram geradas no momento do pagamento do night_link.
  // Este checkin NÃO gera nenhuma earning adicional.
  console.log(`[night-checkin] Check-in ${checkin.id} registrado sem earnings (gratuito).`);

  return corsResponse({
    success:        true,
    checkin_id:     checkin.id,
    night_link_id:  nightLink.id,
    qr_code:        nightLink.qr_code || nightLink.id,
    expires_at:     nightLink.expires_at,
    night_session:  nightLink.night_session || nightLink.id,
  }, 201);
});
