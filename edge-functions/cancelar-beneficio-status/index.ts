// Edge Function: cancelar-beneficio-status
// OZ App - Supabase Edge Function
//
// Cancela em lote reservas e ativações do dia quando bar cancela promoção/benefício.
// Opcionalmente cria free_credits e envia mensagens de notificação para clientes afetados.
// Tudo feito com service_role para contornar RLS (o bar não pode inserir ativação de outro user).
//
// Body:
//   bar_id?               - validado contra bar autenticado
//   today                 - YYYY-MM-DD (obrigatório)
//   promo_id?             - ID da promoção ao vivo
//   scheduled_benefit_id? - ID do benefício agendado
//   cancel_activations    - boolean (default: false)
//   compensar_clientes    - boolean (default: false) cria free_credit + notifica
//   motivo?               - texto do motivo (para mensagem ao cliente)
//   bar_name?             - nome do bar (para mensagem)
//   promo_title?          - título do benefício cancelado
//   cutoff_ts?            - timestamp ms; ativações criadas APÓS esse momento são afetadas
//
// Resposta: 200 { success, bar_id, today, reservas_canceladas, ativacoes_canceladas,
//                 clientes_compensados, promoters_compensados, erros }

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

// Tipos que NÃO devem ser cancelados nem receber crédito
const TIPOS_EXCLUIDOS = ["free_credit", "free_credit_used", "free_used", "night_checkin"];

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

  // Service role — bypassa RLS para criar free_credits de outros usuários
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Valida role do usuário autenticado ────────────────────────────────────
  const { data: dbUser, error: uErr } = await supabase
    .from("users")
    .select("id, role, bar_id, name")
    .eq("id", user.id)
    .single();

  if (uErr || !dbUser) return corsResponse({ error: "Usuário não encontrado." }, 404);
  if (dbUser.role !== "bar") {
    return corsResponse({ error: "Apenas usuários com perfil 'bar' podem executar esta operação." }, 403);
  }

  // bar_id real do usuário autenticado (fonte da verdade — nunca do body)
  const barIdAutenticado = dbUser.bar_id || dbUser.id;

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: {
    bar_id?:                string;
    today?:                 string;
    promo_id?:              string;
    scheduled_benefit_id?:  string;
    cancel_activations?:    boolean;
    compensar_clientes?:    boolean;
    motivo?:                string;
    bar_name?:              string;
    promo_title?:           string;
    cutoff_ts?:             number | null;
  };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const {
    bar_id,
    today,
    promo_id,
    scheduled_benefit_id,
    cancel_activations  = false,
    compensar_clientes  = false,
    motivo              = "",
    bar_name            = dbUser.name || "Bar",
    promo_title         = "benefício",
    cutoff_ts           = null,
  } = body;

  // ── Valida que bar_id do body bate com o bar autenticado ──────────────────
  if (bar_id && bar_id !== barIdAutenticado) {
    console.warn(
      `[cancelar-beneficio-status] Bar ${barIdAutenticado} tentou cancelar registros do bar ${bar_id}`
    );
    return corsResponse({ error: "bar_id não corresponde ao bar autenticado." }, 403);
  }

  if (!today) return corsResponse({ error: "today (YYYY-MM-DD) é obrigatório." }, 400);

  const agora = new Date().toISOString();

  // ════════════════════════════════════════════════════════════════════════════
  // PARTE 1 — Cancela reservas do dia vinculadas ao bar autenticado
  // ════════════════════════════════════════════════════════════════════════════
  let reservasCanceladas = 0;
  const erros: { tabela: string; erro: string }[] = [];

  try {
    let queryReservas = supabase
      .from("reservations")
      .select("id, status, bar_id, scheduled_benefit_id, benefit_date")
      .eq("bar_id", barIdAutenticado)
      .eq("benefit_date", today)
      .neq("status", "cancelled");

    if (scheduled_benefit_id) {
      queryReservas = queryReservas.eq("scheduled_benefit_id", scheduled_benefit_id);
    }

    const { data: reservas, error: rErr } = await queryReservas;

    if (rErr) {
      console.error("[cancelar-beneficio-status] Erro ao buscar reservas:", rErr);
      erros.push({ tabela: "reservations", erro: rErr.message });
    } else if (reservas && reservas.length > 0) {
      const { error: rcErr, count } = await supabase
        .from("reservations")
        .update({ status: "cancelled", updated_at: agora })
        .in("id", reservas.map((r: { id: string }) => r.id))
        .eq("bar_id", barIdAutenticado);

      if (rcErr) {
        console.error("[cancelar-beneficio-status] Erro ao cancelar reservas:", rcErr);
        erros.push({ tabela: "reservations", erro: rcErr.message });
      } else {
        reservasCanceladas = count ?? reservas.length;
        console.log(`[cancelar-beneficio-status] ${reservasCanceladas} reserva(s) cancelada(s) para bar ${barIdAutenticado}`);
      }
    }
  } catch (err) {
    console.error("[cancelar-beneficio-status] Exceção ao cancelar reservas:", err);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PARTE 2 — Cancela ativações do dia (sempre executado quando cancel_activations=true)
  // ════════════════════════════════════════════════════════════════════════════
  let ativacoesCanceladas = 0;
  // Lista de IDs únicos de usuários cujas ativações foram canceladas (para compensação)
  const userIdsAfetados:     Set<string> = new Set();
  // { userId → [promoter_id, ...] } para compensar promoters
  const promoterIdsAfetados: Set<string> = new Set();

  if (cancel_activations) {
    try {
      // Cutoff: timestamp (ms) a partir do qual as ativações serão canceladas.
      // Se não fornecido, usa meia-noite UTC do dia (captura TODAS as ativações do dia).
      // O created_at na tabela é int8 (ms desde epoch).
      const inicioDia = new Date(`${today}T00:00:00.000Z`).getTime(); // meia-noite UTC
      const cutoff    = (cutoff_ts != null && cutoff_ts > 0) ? cutoff_ts : inicioDia;

      let queryActs = supabase
        .from("activations")
        .select("id, type, status, bar_id, user_id, promoter_id, promoter_code, created_at")
        .eq("bar_id", barIdAutenticado)
        .not("status", "in", "(cancelled,failed)")
        .gte("created_at", cutoff);

      console.log(`[cancelar-beneficio-status] Buscando ativações: bar=${barIdAutenticado} cutoff=${cutoff} (${new Date(cutoff).toISOString()})`);

      // Para benefício agendado, filtra por origin_act_id se disponível
      // (para promos ao vivo não filtramos por promo_id — a data/bar já é suficiente)

      const { data: ativacoes, error: aErr } = await queryActs;

      if (aErr) {
        console.error("[cancelar-beneficio-status] Erro ao buscar ativações:", aErr);
        erros.push({ tabela: "activations", erro: aErr.message });
      } else if (ativacoes && ativacoes.length > 0) {
        console.log(`[cancelar-beneficio-status] Total ativações encontradas: ${ativacoes.length}`, ativacoes.map((a: { id: string; type: string; status: string; user_id: string }) => ({ id: a.id, type: a.type, status: a.status, user_id: a.user_id })));

        // Filtra tipos não canceláveis
        const cancelaveis = ativacoes.filter(
          (a: { type: string; status: string }) => !TIPOS_EXCLUIDOS.includes(a.type)
        );

        if (cancelaveis.length > 0) {
          const { error: acErr, count, data: canceladosDados } = await supabase
            .from("activations")
            .update({
              status:       "cancelled",
              cancelled_by: barIdAutenticado,
              cancelled_at: agora,
              updated_at:   Date.now(),
            })
            .in("id", cancelaveis.map((a: { id: string }) => a.id))
            .eq("bar_id", barIdAutenticado)
            .select();

          console.log(`[cancelar-beneficio-status] Update result: count=${count}, data=${JSON.stringify(canceladosDados)}, err=${JSON.stringify(acErr)}`);

          if (acErr) {
            console.error("[cancelar-beneficio-status] Erro ao cancelar ativações:", acErr);
            erros.push({ tabela: "activations", erro: acErr.message });
          } else {
            ativacoesCanceladas = canceladosDados?.length ?? count ?? cancelaveis.length;
            console.log(`[cancelar-beneficio-status] ${ativacoesCanceladas} ativação(ões) cancelada(s) para bar ${barIdAutenticado}`);

            // Coleta usuários e promoters afetados (excluindo demo)
            // Usa 'cancelaveis' (estado ANTES do update) para identificar quem era realmente 'active'
            // canceladosDados retorna estado APÓS update (status='cancelled'), então não é útil aqui
            cancelaveis.forEach((a: { user_id?: string; promoter_id?: string; promoter_code?: string; status?: string }) => {
              // Compensação apenas para ativações que eram 'active' (o cliente já havia pago/ativado)
              // pending_payment = nunca concluiu o pagamento → sem compensação
              const statusOriginal = a.status as string;
              if (statusOriginal !== "active") return;

              if (a.user_id && !a.user_id.startsWith("demo-")) {
                userIdsAfetados.add(a.user_id);
              }
              const pid = a.promoter_id || a.promoter_code;
              if (pid && !pid.startsWith("demo-")) {
                promoterIdsAfetados.add(pid);
              }
            });
          }
        }
      }
    } catch (err) {
      console.error("[cancelar-beneficio-status] Exceção ao cancelar ativações:", err);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PARTE 3 — Compensa clientes com free_credit + notificação (service_role)
  // Só executa se compensar_clientes=true
  // ════════════════════════════════════════════════════════════════════════════
  let clientesCompensados  = 0;
  let promotersCompensados = 0;

  if (compensar_clientes && userIdsAfetados.size > 0) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // válido 30 dias
    const expiresAtStr = expiresAt.toISOString();

    const chatContent = `📢 ${bar_name} cancelou o benefício "${promo_title}".\n\nMotivo: ${motivo || "Não informado"}\n\nComo compensação, você recebeu 1 ativação grátis para usar em qualquer lista. 🎁`;

    // ── Clientes ──────────────────────────────────────────────────────────
    await Promise.allSettled([...userIdsAfetados].map(async (userId) => {
      try {
        // 1. Cria free_credit no histórico do cliente
        const { error: fcErr } = await supabase.from("activations").insert({
          user_id:       userId,
          bar_id:        barIdAutenticado,
          bar_name:      bar_name,
          type:          "free_credit",
          amount:        0,
          qr_code:       `FREE-${promo_id || scheduled_benefit_id || "promo"}-${userId}-${Date.now()}`,
          expires_at:    expiresAtStr,
          promoter_code: "",
          origin:        "bar_cancellation",
          status:        "active",
          created_at:    Date.now(),
          updated_at:    Date.now(),
        });
        if (fcErr) {
          console.error(`[cancelar-beneficio-status] Erro ao criar free_credit para ${userId}:`, fcErr);
          return;
        }

        // 2. Envia mensagem de notificação
        const { error: msgErr } = await supabase.from("chat_messages").insert({
          sender_id:     barIdAutenticado,
          sender_name:   bar_name,
          receiver_id:   userId,
          receiver_name: "",
          content:       chatContent,
          read:          false,
          created_at:    Date.now(),
        });
        if (msgErr) console.warn(`[cancelar-beneficio-status] Erro ao enviar msg para ${userId}:`, msgErr);

        // 3. Incrementa activations_count do usuário
        try {
          const { data: uData } = await supabase
            .from("users")
            .select("activations_count")
            .eq("id", userId)
            .single();
          const curCount = Number(uData?.activations_count) || 0;
          await supabase
            .from("users")
            .update({ activations_count: curCount + 1 })
            .eq("id", userId);
        } catch { /* ignora */ }

        clientesCompensados++;
        console.log(`[cancelar-beneficio-status] free_credit criado para cliente ${userId}`);
      } catch (e) {
        console.error(`[cancelar-beneficio-status] Exceção ao compensar cliente ${userId}:`, e);
      }
    }));
  }

  // ── Promoters ──────────────────────────────────────────────────────────────
  if (compensar_clientes && promoterIdsAfetados.size > 0) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const expiresAtStr = expiresAt.toISOString();

    const promoterMsg = `📢 ${bar_name} cancelou o benefício "${promo_title}".\n\nMotivo: ${motivo || "Não informado"}\n\nComo compensação, você recebeu 1 ativação grátis. 🎁`;

    await Promise.allSettled([...promoterIdsAfetados].map(async (promoterId) => {
      try {
        const { error: fcErr } = await supabase.from("activations").insert({
          user_id:       promoterId,
          bar_id:        barIdAutenticado,
          bar_name:      bar_name,
          type:          "free_credit",
          amount:        0,
          qr_code:       `FREE-PROMO-${promo_id || scheduled_benefit_id || "promo"}-${promoterId}-${Date.now()}`,
          expires_at:    expiresAtStr,
          promoter_code: "",
          origin:        "bar_cancellation",
          status:        "active",
          created_at:    Date.now(),
          updated_at:    Date.now(),
        });
        if (fcErr) {
          console.error(`[cancelar-beneficio-status] Erro ao criar free_credit para promoter ${promoterId}:`, fcErr);
          return;
        }

        await supabase.from("chat_messages").insert({
          sender_id:     barIdAutenticado,
          sender_name:   bar_name,
          receiver_id:   promoterId,
          receiver_name: "",
          content:       promoterMsg,
          read:          false,
          created_at:    Date.now(),
        });

        try {
          const { data: pData } = await supabase
            .from("users")
            .select("activations_count")
            .eq("id", promoterId)
            .single();
          const pCount = Number(pData?.activations_count) || 0;
          await supabase
            .from("users")
            .update({ activations_count: pCount + 1 })
            .eq("id", promoterId);
        } catch { /* ignora */ }

        promotersCompensados++;
        console.log(`[cancelar-beneficio-status] free_credit criado para promoter ${promoterId}`);
      } catch (e) {
        console.error(`[cancelar-beneficio-status] Exceção ao compensar promoter ${promoterId}:`, e);
      }
    }));
  }

  // ── Resposta ──────────────────────────────────────────────────────────────
  return corsResponse({
    success:               true,
    bar_id:                barIdAutenticado,
    today,
    reservas_canceladas:   reservasCanceladas,
    ativacoes_canceladas:  ativacoesCanceladas,
    clientes_compensados:  clientesCompensados,
    promoters_compensados: promotersCompensados,
    erros,
  }, 200);
});
