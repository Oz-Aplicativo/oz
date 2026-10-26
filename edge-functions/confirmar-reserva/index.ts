// Edge Function: confirmar-reserva
// OZ App - Supabase Edge Function
//
// Cria, confirma ou cancela reserva antecipada de forma segura no servidor.
// amount/paid definidos aqui - browser nao determina valores financeiros.
//
// Body criar:    { action:"criar", scheduled_benefit_id, bar_id, bar_name, benefit_date, benefit_title, promoter_id? }
// Body confirmar:{ action:"confirmar", reservation_id }
// Body cancelar: { action:"cancelar", reservation_id }
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

// ─── Preço fixo de reserva paga (quando aplicável) ───────────────────────────
const AMOUNT_RESERVA = 5; // R$5 para ativação vinculada à reserva

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

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { action } = body;

  // ════════════════════════════════════════════════════════════════════════
  // AÇÃO: criar
  // ════════════════════════════════════════════════════════════════════════
  if (action === "criar") {
    const {
      scheduled_benefit_id,
      bar_id,
      bar_name,
      benefit_date,
      benefit_title,
      promoter_id,
      activation_type: rawActType,
    } = body as {
      scheduled_benefit_id: string;
      bar_id:               string;
      bar_name:             string;
      benefit_date:         string;
      benefit_title:        string;
      promoter_id?:         string;
      activation_type?:     string;
    };

    // Normaliza para valores aceitos pelo enum reservation_act_type
    const activation_type =
      rawActType === "advance_night" ? "advance_night" : "advance_individual";

    if (!scheduled_benefit_id) return corsResponse({ error: "scheduled_benefit_id é obrigatório." }, 400);
    if (!bar_id)               return corsResponse({ error: "bar_id é obrigatório." }, 400);
    if (!bar_name)             return corsResponse({ error: "bar_name é obrigatório." }, 400);
    if (!benefit_date)         return corsResponse({ error: "benefit_date é obrigatório." }, 400);
    if (!benefit_title)        return corsResponse({ error: "benefit_title é obrigatório." }, 400);

    // Valida scheduled_benefit
    const { data: sb } = await supabase
      .from("scheduled_benefits")
      .select("*")
      .eq("id", scheduled_benefit_id)
      .single();

    if (!sb)       return corsResponse({ error: "Benefício agendado não encontrado." }, 404);
    if (!sb.active) return corsResponse({ error: "Benefício agendado inativo." }, 400);

    // Verifica vagas
    const vagasOcupadas = sb.reservations_count || 0;
    const maxVagas      = sb.max_activations || 9999;
    if (vagasOcupadas >= maxVagas) {
      return corsResponse({ error: "Sem vagas disponíveis para este benefício." }, 400);
    }

    // Busca dados do usuário
    const { data: dbUser } = await supabase
      .from("users")
      .select("id, name, photo_url, role, referred_by")
      .eq("id", user.id)
      .single();

    if (!dbUser) return corsResponse({ error: "Usuário não encontrado." }, 404);

    // Impede reserva duplicada
    const { data: jaReservou } = await supabase
      .from("reservations")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("scheduled_benefit_id", scheduled_benefit_id)
      .not("status", "eq", "cancelled");

    if (jaReservou && jaReservou.length > 0) {
      return corsResponse({
        error:              "Você já possui uma reserva para este benefício.",
        reservation_existing: jaReservou[0],
      }, 409);
    }

    // Cria reserva
    const { data: reservation, error: rErr } = await supabase
      .from("reservations")
      .insert({
        scheduled_benefit_id,
        bar_id,
        bar_name,
        user_id:       user.id,
        user_name:     dbUser.name,
        user_photo:    dbUser.photo_url || null,
        user_role:     dbUser.role,
        benefit_date,
        benefit_title,
        status:        "pending",
        paid:          false,
        amount:        activation_type === "advance_night" ? 10 : 5,
        promoter_id:   promoter_id || dbUser.referred_by || null,
        activation_type,
        created_at:    Date.now(),
      })
      .select()
      .single();

    if (rErr) {
      console.error("[confirmar-reserva] Erro ao criar reserva:", rErr);
      return corsResponse({ error: "Erro ao criar reserva." }, 500);
    }

    // Incrementa reservations_count
    await supabase
      .from("scheduled_benefits")
      .update({
        reservations_count: vagasOcupadas + 1,
        updated_at:         new Date().toISOString(),
      })
      .eq("id", scheduled_benefit_id);

    return corsResponse({ success: true, reservation }, 201);
  }

  // ════════════════════════════════════════════════════════════════════════
  // AÇÃO: confirmar
  // ════════════════════════════════════════════════════════════════════════
  if (action === "confirmar") {
    const { reservation_id } = body as { reservation_id: string };

    if (!reservation_id) return corsResponse({ error: "reservation_id é obrigatório." }, 400);

    // Busca reserva
    const { data: reservation } = await supabase
      .from("reservations")
      .select("*")
      .eq("id", reservation_id)
      .single();

    if (!reservation) return corsResponse({ error: "Reserva não encontrada." }, 404);
    if (reservation.user_id !== user.id) {
      return corsResponse({ error: "Esta reserva não pertence ao usuário autenticado." }, 403);
    }
    if (reservation.status === "confirmado") {
      return corsResponse({ message: "Reserva já confirmada.", reservation }, 200);
    }
    if (reservation.status === "cancelled") {
      return corsResponse({ error: "Reserva cancelada — não pode ser confirmada." }, 400);
    }

    const agora = new Date().toISOString();

    // Atualiza status da reserva
    const { data: updatedReservation, error: uErr } = await supabase
      .from("reservations")
      .update({
        status:       "confirmado",
        confirmed_at: agora,
        paid:         true,
        updated_at:   agora,
      })
      .eq("id", reservation_id)
      .select()
      .single();

    if (uErr) {
      console.error("[confirmar-reserva] Erro ao atualizar reserva:", uErr);
      return corsResponse({ error: "Erro ao confirmar reserva." }, 500);
    }

    // Busca dados do usuário
    const { data: dbUser } = await supabase
      .from("users")
      .select("id, name, activations_count, total_saved")
      .eq("id", user.id)
      .single();

    // Cria ativação vinculada
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const qrCode = `RESERVA-${reservation_id}-${Date.now()}`;

    const { data: activation } = await supabase
      .from("activations")
      .insert({
        user_id:      user.id,
        user_name:    dbUser?.name || "",
        bar_id:       reservation.bar_id,
        bar_name:     reservation.bar_name,
        type:         "individual",
        amount:       AMOUNT_RESERVA,   // R$5 fixo
        qr_code:      qrCode,
        expires_at:   expiry,
        promoter_id:  reservation.promoter_id || null,
        status:       "active",
        origin:       "reserva",
        origin_act_id: reservation_id,
        created_at:   agora,
      })
      .select()
      .single();

    // Atualiza contadores do usuário
    if (dbUser) {
      await supabase
        .from("users")
        .update({
          activations_count: (dbUser.activations_count || 0) + 1,
          total_saved:       (dbUser.total_saved || 0) + AMOUNT_RESERVA,
          updated_at:        agora,
        })
        .eq("id", user.id);
    }

    // Incrementa activations_count do scheduled_benefit
    const { data: sb } = await supabase
      .from("scheduled_benefits")
      .select("id, activations_count")
      .eq("id", reservation.scheduled_benefit_id)
      .single();

    if (sb) {
      await supabase
        .from("scheduled_benefits")
        .update({
          activations_count: (sb.activations_count || 0) + 1,
          updated_at:        agora,
        })
        .eq("id", sb.id);
    }

    return corsResponse({
      success:     true,
      reservation: updatedReservation,
      activation,
    }, 200);
  }

  // ════════════════════════════════════════════════════════════════════════
  // AÇÃO: cancelar
  // ════════════════════════════════════════════════════════════════════════
  if (action === "cancelar") {
    const { reservation_id } = body as { reservation_id: string };

    if (!reservation_id) return corsResponse({ error: "reservation_id é obrigatório." }, 400);

    const { data: reservation } = await supabase
      .from("reservations")
      .select("*")
      .eq("id", reservation_id)
      .single();

    if (!reservation) return corsResponse({ error: "Reserva não encontrada." }, 404);
    if (reservation.user_id !== user.id) {
      return corsResponse({ error: "Esta reserva não pertence ao usuário autenticado." }, 403);
    }
    if (reservation.status === "cancelled") {
      return corsResponse({ message: "Reserva já cancelada.", reservation }, 200);
    }

    const agora = new Date().toISOString();

    // Cancela reserva
    const { data: cancelled } = await supabase
      .from("reservations")
      .update({ status: "cancelled", updated_at: agora })
      .eq("id", reservation_id)
      .select()
      .single();

    // Decrementa reservations_count
    const { data: sb } = await supabase
      .from("scheduled_benefits")
      .select("id, reservations_count")
      .eq("id", reservation.scheduled_benefit_id)
      .single();

    if (sb) {
      const novoCount = Math.max(0, (sb.reservations_count || 0) - 1);
      await supabase
        .from("scheduled_benefits")
        .update({ reservations_count: novoCount, updated_at: agora })
        .eq("id", sb.id);
    }

    return corsResponse({ success: true, reservation: cancelled }, 200);
  }

  return corsResponse({ error: `Ação desconhecida: '${action}'. Use 'criar', 'confirmar' ou 'cancelar'.` }, 400);
});
