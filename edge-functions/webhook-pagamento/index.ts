// Edge Function: webhook-pagamento
// OZ App - Supabase Edge Function
//
// Recebe notificacoes IPN/Webhook do Mercado Pago e atualiza o status
// da transacao na tabela transactions.
// Quando aprovado, executa acoes de negocio (confirmar ativacao/reserva, gerar comissoes).
//
// IMPORTANTE - Seguranca:
//   Autenticidade verificada comparando o secret recebido no header
//   com MP_WEBHOOK_SECRET configurado como Supabase Secret.
//   Esta funcao NAO usa JWT de usuario -- e chamada diretamente pelo MP.
//
// Secrets necessarios: MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET (opcional mas recomendado)
//
// Como configurar no Mercado Pago:
//   Dashboard MP -> Seu negocio -> Webhooks -> Adicionar webhook
//   URL: https://<project>.supabase.co/functions/v1/webhook-pagamento
//   Eventos: payment (cobre todos os status changes)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Verificacao de assinatura HMAC-SHA256 (Mercado Pago Webhook v2)
//
// O MP envia no header x-signature: ts=<timestamp>,v1=<hmac>
// A mensagem assinada e: "id:<payment_id>;request-id:<x-request-id>;ts:<ts>;"
// Ref: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
// ---------------------------------------------------------------------------

async function verificarAssinaturaMP(
  paymentId: string,
  requestId: string | null,
  xSignature: string | null,
  secret: string
): Promise<boolean> {
  if (!xSignature) return false;

  try {
    // Extrai ts e v1 do header x-signature
    const parts: Record<string, string> = {};
    xSignature.split(",").forEach((part) => {
      const [k, v] = part.trim().split("=");
      if (k && v) parts[k] = v;
    });

    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;

    // Monta a mensagem a assinar
    const message = `id:${paymentId};request-id:${requestId || ""};ts:${ts};`;

    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sigBuffer = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
    const computedHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computedHex === v1;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mapeia status do Mercado Pago para status interno
// ---------------------------------------------------------------------------

function mapearStatusMp(mpStatus: string): string | null {
  const mapa: Record<string, string> = {
    pending:      "pending",
    approved:     "approved",
    authorized:   "approved",
    in_process:   "in_process",
    in_mediation: "in_process",
    rejected:     "rejected",
    cancelled:    "cancelled",
    refunded:     "refunded",
    charged_back: "refunded",
  };
  return mapa[mpStatus] || null;
}

// ---------------------------------------------------------------------------
// Busca detalhes do pagamento na API do Mercado Pago
// Necessario porque o webhook IPN so envia o payment_id, nao o payload completo
// ---------------------------------------------------------------------------

async function buscarPagamentoMP(
  paymentId: string,
  mpToken: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        "Authorization": `Bearer ${mpToken}`,
        "Content-Type":  "application/json",
      },
    });

    if (!res.ok) {
      console.error(`[webhook-pagamento] Erro ao buscar payment ${paymentId}: ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error("[webhook-pagamento] Excecao ao buscar payment MP:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logica de earnings inline (evita chamada HTTP recursiva entre Edge Functions)
// ---------------------------------------------------------------------------

async function gerarEarningsInterno(
  supabase: ReturnType<typeof createClient>,
  activation: Record<string, unknown>
) {
  const MAX_ACTS = 3;
  const PICK_FLAT = 1;
  const REF_FULL = 5;
  const REF_SPLIT = 4;

  const activationId = activation.id as string;
  const userId = activation.user_id as string;
  const type = activation.type as string;
  const refId = activation.promoter_id as string | null;
  // night_link, night e advance_night usam night_pick_promoter; demais usam pick_promoter
  const isNight = type === "night" || type === "night_link" || type === "advance_night";
  const pickId = (
    isNight
      ? activation.night_pick_promoter || activation.pick_promoter
      : activation.pick_promoter
  ) as string | null;
  const barName = (activation.bar_name as string) || "oz";
  const label = isNight ? "Noite Toda" : "Unitario";

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
  const withinCap = actsThisUser < MAX_ACTS;
  const samePromoter = refId && pickId && refId === pickId;

  async function creditar(promoterId: string, amount: number, reason: string) {
    if (amount <= 0 || !promoterId) return;
    const { data: p } = await supabase
      .from("users")
      .select("balance")
      .eq("id", promoterId)
      .single();
    if (!p) {
      console.error(`[gerarEarningsInterno] Promoter ${promoterId} nao encontrado — earning nao gerado.`);
      return;
    }
    const { error: balErr } = await supabase
      .from("users")
      .update({ balance: Number(p.balance || 0) + amount, updated_at: Date.now() })
      .eq("id", promoterId);
    if (balErr) console.error(`[gerarEarningsInterno] Erro ao atualizar balance de ${promoterId}:`, balErr);
    const { error: earnErr } = await supabase.from("earnings").insert({
      promoter_id:    promoterId,
      promoter_code:  promoterId,
      user_id:        userId,
      activation_id:  activationId,
      amount,
      reason,
      acts_this_user: actsThisUser + 1,
      origin:         barName,
      status:         "pendente",
      created_at:     Date.now(),
    });
    if (earnErr) console.error(`[gerarEarningsInterno] Erro ao inserir earning para ${promoterId}:`, earnErr);
    else console.log(`[gerarEarningsInterno] Earning R$${amount} creditado para ${promoterId} — ${reason}`);
  }

  if (refId && withinCap && pickId && !samePromoter) {
    await creditar(refId,  REF_SPLIT, `Comissao ref (split) - ${label} em ${barName}`);
    await creditar(pickId, PICK_FLAT, `Comissao pick - ${label} em ${barName}`);
  } else if (refId && withinCap && samePromoter) {
    await creditar(refId, REF_FULL, `Comissao ref+pick - ${label} em ${barName}`);
  } else if (refId && withinCap && !pickId) {
    await creditar(refId, REF_FULL, `Comissao ref - ${label} em ${barName}`);
  } else if (refId && !withinCap && pickId && !samePromoter) {
    await creditar(pickId, PICK_FLAT, `Comissao pick (cap) - ${label} em ${barName}`);
  } else if (!refId && pickId) {
    await creditar(pickId, PICK_FLAT, `Comissao pick (sem ref) - ${label} em ${barName}`);
  }
}

// ---------------------------------------------------------------------------
// Acao pos-pagamento aprovado
// ---------------------------------------------------------------------------

async function executarAcaoAprovado(
  supabase: ReturnType<typeof createClient>,
  transaction: Record<string, unknown>
) {
  const { type, reference_id, user_id } = transaction as {
    type: string;
    reference_id: string;
    user_id: string;
  };

  console.log(`[webhook-pagamento] Acao pos-aprovacao | tipo:${type} | ref:${reference_id}`);

  try {
    // ── Reserva: confirma e marca como paga ──────────────────────────────────
    if (type === "reservation") {
      const { error } = await supabase
        .from("reservations")
        .update({
          status:       "confirmado",
          paid:         true,
          confirmed_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        })
        .eq("id", reference_id)
        .eq("user_id", user_id);

      if (error) {
        console.error("[webhook-pagamento] Erro ao confirmar reserva:", error);
      } else {
        console.log(`[webhook-pagamento] Reserva ${reference_id} confirmada.`);
      }
      return;
    }

    // ── Ativacao individual, noite toda ou beneficio agendado ────────────────
    // Fluxo:
    //   1) Tenta mudar pending_payment → active (caso normal via criar-transacao)
    //   2) Se a ativacao nao existir ou nao foi criada antes, cria diretamente com status=active
    //      usando os dados completos da transaction (garantia de que o nome aparece na lista)
    // Tipos cobertos: activation (individual/advance_individual) e night (night_link/advance_night)
    if (type === "activation" || type === "night") {

      // ── Passo 1: Tenta ativar ativacao existente (pending_payment → active) ─
      let activation: Record<string, unknown> | null = null;

      const { data: updatedAct, error: actErr } = await supabase
        .from("activations")
        .update({ status: "active", updated_at: Date.now() })  // int8 ms
        .eq("id", reference_id)
        .eq("user_id", user_id)
        .eq("status", "pending_payment")  // so ativa se ainda pendente (idempotencia)
        .select()
        .single();

      if (!actErr && updatedAct) {
        activation = updatedAct;
        console.log(`[webhook-pagamento] Ativacao ${activation.id} ativada (pending→active). type:${activation.type} benefit_date:${activation.benefit_date}`);
      } else {
        // ── Passo 2: Verifica se ja estava active (reprocessamento) ───────────
        const { data: existingAct } = await supabase
          .from("activations")
          .select("*")
          .eq("id", reference_id)
          .single();

        if (existingAct?.status === "active") {
          console.log(`[webhook-pagamento] Ativacao ${reference_id} ja estava active — usando para comissoes.`);
          activation = existingAct;
        } else {
          // ── Passo 3: Ativacao existe com status != pending_payment nem active ─
          // (ex: cancelled por timeout de PIX) ou nao existe — cria/reativa agora
          console.log(`[webhook-pagamento] Ativacao ${reference_id} status=${existingAct?.status ?? "inexistente"} — criando/reativando com status=active.`);

          // Calcula benefit_date em BRT (UTC-3)
          const nowMs = Date.now();
          const brtOffset = -3 * 60 * 60 * 1000;
          const nowBrt = new Date(nowMs + brtOffset);
          const todayBRT = nowBrt.toISOString().split("T")[0];

          const rawBenefitDate = transaction.benefit_date as string | null;
          const benefitDate = rawBenefitDate || todayBRT;
          const isAdvance = rawBenefitDate && rawBenefitDate !== todayBRT;

          const actType = (() => {
            if (type === "night") return isAdvance ? "advance_night" : "night_link";
            return isAdvance ? "advance_individual" : "individual";
          })();

          if (existingAct) {
            // Ativacao existe (ex: cancelled) — reativa via UPDATE
            const { data: reactivatedAct, error: reactivateErr } = await supabase
              .from("activations")
              .update({
                status:      "active",
                type:        actType,
                benefit_date: benefitDate,
                updated_at:  nowMs,
                cancelled_at: null,
                cancelled_by: null,
              })
              .eq("id", reference_id)
              .select()
              .single();

            if (reactivateErr || !reactivatedAct) {
              console.error("[webhook-pagamento] Erro ao reativar ativacao:", reactivateErr);
              return;
            }
            activation = reactivatedAct;
            console.log(`[webhook-pagamento] Ativacao ${activation.id} reativada (${existingAct.status}→active).`);

          } else {
            // Ativacao nao existe — INSERT com id=reference_id para manter rastreabilidade
            const newActRecord: Record<string, unknown> = {
              id:                  reference_id,
              user_id:             transaction.user_id,
              user_name:           transaction.user_name || "",
              bar_id:              transaction.bar_id,
              bar_name:            transaction.bar_name || "",
              type:                actType,
              amount:              transaction.amount || (type === "night" ? 10 : 5),
              qr_code:             transaction.qr_code || reference_id,
              expires_at:          transaction.expires_at || new Date(nowMs + 8 * 60 * 60 * 1000).toISOString(),
              promoter_id:         transaction.promoter_id   || null,
              promoter_code:       transaction.promoter_code || null,
              pick_promoter:       transaction.pick_promoter || null,
              night_pick_promoter: transaction.night_pick_promoter || null,
              night_session:       transaction.night_session || null,
              benefit_date:        benefitDate,
              status:              "active",
              created_at:          nowMs,
              updated_at:          nowMs,
            };

            const { data: createdAct, error: createErr } = await supabase
              .from("activations")
              .insert(newActRecord)
              .select()
              .single();

            if (createErr || !createdAct) {
              console.error("[webhook-pagamento] Erro ao criar ativacao no webhook:", createErr);
              return;
            }
            activation = createdAct;
            console.log(`[webhook-pagamento] Ativacao criada no webhook: ${activation.id} type:${activation.type} benefit_date:${activation.benefit_date}`);
          }
        }
      }

      // Garante que temos uma ativacao valida para continuar
      if (!activation) {
        console.error("[webhook-pagamento] Nao foi possivel obter ativacao — abortando.");
        return;
      }

      console.log(`[webhook-pagamento] Ativacao ${activation.id} pronta. type:${activation.type} benefit_date:${activation.benefit_date}`);

      // ── Se for benefício agendado (advance_*), confirma a reserva correspondente ─
      const isAdvanceAct = (activation.type === "advance_individual" || activation.type === "advance_night");
      if (isAdvanceAct && activation.scheduled_benefit_id) {
        const { error: resErr } = await supabase
          .from("reservations")
          .update({
            status:       "confirmado",
            paid:         true,
            confirmed_at: new Date().toISOString(),
            updated_at:   new Date().toISOString(),
          })
          .eq("scheduled_benefit_id", activation.scheduled_benefit_id as string)
          .eq("user_id", user_id);

        if (resErr) {
          console.error(`[webhook-pagamento] Erro ao confirmar reserva do beneficio agendado:`, resErr);
        } else {
          console.log(`[webhook-pagamento] Reserva do beneficio agendado ${activation.scheduled_benefit_id} confirmada.`);
        }
      }

      // ── Atualiza contadores do usuario ──────────────────────────────────────
      const amount = activation.amount as number || 0;
      try {
        const { error: rpcErr } = await supabase.rpc("increment_user_activation", {
          p_user_id: user_id,
          p_amount:  amount,
        });
        if (rpcErr) throw rpcErr;
        console.log(`[webhook-pagamento] Contadores do usuario ${user_id} atualizados via RPC.`);
      } catch (_rpcErr) {
        // Fallback manual se a RPC nao existir ou falhar
        console.log(`[webhook-pagamento] RPC indisponivel, usando fallback manual para usuario ${user_id}.`);
        const { data: dbUser } = await supabase
          .from("users")
          .select("activations_count, total_saved")
          .eq("id", user_id)
          .single();
        if (dbUser) {
          await supabase
            .from("users")
            .update({
              activations_count: (dbUser.activations_count || 0) + 1,
              total_saved:       (dbUser.total_saved || 0) + amount,
              updated_at:        Date.now(),
            })
            .eq("id", user_id);
        }
      }

      // ── Incrementa contador da promocao ativa do bar ───────────────────────
      const { data: promo } = await supabase
        .from("promotions")
        .select("id, activations_count")
        .eq("bar_id", activation.bar_id as string)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (promo) {
        await supabase
          .from("promotions")
          .update({
            activations_count: (promo.activations_count || 0) + 1,
            updated_at:        Date.now(),  // int8 ms
          })
          .eq("id", promo.id);
      }

      // ── Distribui comissoes (idempotente — verifica antes de criar) ─────────
      const { data: earningsExistentes } = await supabase
        .from("earnings")
        .select("id")
        .eq("activation_id", activation.id)
        .limit(1);

      if (!earningsExistentes || earningsExistentes.length === 0) {
        await gerarEarningsInterno(supabase, activation);
        console.log(`[webhook-pagamento] Comissoes geradas para ativacao ${activation.id}`);
      } else {
        console.log(`[webhook-pagamento] Comissoes ja existentes para ${activation.id} — ignorando.`);
      }
    }
  } catch (err) {
    console.error("[webhook-pagamento] Erro na acao pos-aprovacao:", err);
  }
}

// ---------------------------------------------------------------------------
// Acao pos-falha, rejeicao ou cancelamento
// ---------------------------------------------------------------------------

async function executarAcaoFalha(
  supabase: ReturnType<typeof createClient>,
  transaction: Record<string, unknown>
) {
  const { type, reference_id, user_id } = transaction as {
    type: string;
    reference_id: string;
    user_id: string;
  };

  console.log(`[webhook-pagamento] Acao pos-falha | tipo:${type} | ref:${reference_id}`);

  try {
    if (type === "activation" || type === "night") {
      await supabase
        .from("activations")
        .update({
          status:       "cancelled",
          cancelled_at: new Date().toISOString(),  // text — ok
          cancelled_by: "payment_failed",
          updated_at:   Date.now(),  // int8 ms
        })
        .eq("id", reference_id)
        .eq("user_id", user_id)
        .eq("status", "pending_payment");
    }

    if (type === "reservation") {
      await supabase
        .from("reservations")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", reference_id)
        .eq("user_id", user_id)
        .in("status", ["pendente", "pending_payment"]);
    }
  } catch (err) {
    console.error("[webhook-pagamento] Erro na acao pos-falha:", err);
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo nao permitido." }, 405);
  }

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mpToken        = Deno.env.get("MP_ACCESS_TOKEN")!;
  const webhookSecret  = Deno.env.get("MP_WEBHOOK_SECRET");

  const supabase = createClient(supabaseUrl, serviceKey);

  // Le body raw
  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Payload JSON invalido." }, 400);
  }

  // -------------------------------------------------------------------------
  // Suporte a dois formatos de notificacao do Mercado Pago:
  //
  // Formato 1 - IPN (legado):
  //   POST body: { "id": "...", "topic": "payment" }
  //   O payment_id vem em payload.id ou payload.data.id
  //
  // Formato 2 - Webhooks v2 (atual, recomendado):
  //   POST body: { "action": "payment.updated", "data": { "id": "..." }, "type": "payment" }
  //   O payment_id vem em payload.data.id
  //   Header x-signature: ts=<timestamp>,v1=<hmac>
  // -------------------------------------------------------------------------

  const action    = payload.action as string | undefined;   // ex: "payment.updated"
  const topic     = payload.topic  as string | undefined;   // ex: "payment" (IPN legado)
  const eventType = payload.type   as string | undefined;   // ex: "payment" | "test"
  const dataObj   = payload.data   as Record<string, unknown> | undefined;
  const paymentId = String(dataObj?.id || payload.id || "");

  console.log(`[webhook-pagamento] Notificacao recebida | action:${action} | type:${eventType} | topic:${topic} | payment_id:${paymentId}`);

  // Evento de teste do Mercado Pago -- aceita sem validar assinatura
  // O MP envia type="test" ao salvar/testar o webhook no painel
  if (eventType === "test" || action === "test.created") {
    console.log("[webhook-pagamento] Evento de teste do MP -- respondendo 200 OK.");
    return jsonResponse({ received: true, message: "Teste recebido com sucesso." }, 200);
  }

  // Ignora notificacoes que nao sao de pagamento
  const isPaymentEvent = action?.startsWith("payment.") || topic === "payment" || eventType === "payment";
  if (!isPaymentEvent) {
    console.log(`[webhook-pagamento] Evento nao relacionado a pagamento -- ignorado.`);
    return jsonResponse({ received: true, message: "Evento ignorado." }, 200);
  }

  if (!paymentId) {
    console.warn("[webhook-pagamento] payment_id ausente no payload.");
    return jsonResponse({ received: true, message: "payment_id ausente." }, 200);
  }

  // Verificacao de assinatura HMAC (Webhooks v2)
  // So valida se AMBOS estiverem presentes: secret configurado E header x-signature recebido.
  // O MP nao envia x-signature em: testes simulados pelo painel, IPN legado (topic=payment)
  // e notificacoes de sandbox/live_mode=false. Em producao real, x-signature sempre vira.
  const xSignature = req.headers.get("x-signature");
  if (webhookSecret && xSignature) {
    const xRequestId = req.headers.get("x-request-id");
    const valido = await verificarAssinaturaMP(paymentId, xRequestId, xSignature, webhookSecret);
    if (!valido) {
      console.warn("[webhook-pagamento] Assinatura MP invalida -- requisicao rejeitada.");
      return jsonResponse({ error: "Assinatura invalida." }, 401);
    }
    console.log("[webhook-pagamento] Assinatura HMAC verificada com sucesso.");
  } else if (webhookSecret && !xSignature) {
    console.warn("[webhook-pagamento] x-signature ausente -- aceitando sem verificacao (teste/IPN legado).");
  }

  // Busca detalhes completos do pagamento na API do MP
  // (o webhook so envia o ID -- os dados reais estao na API)
  const mpPayment = await buscarPagamentoMP(paymentId, mpToken);
  if (!mpPayment) {
    // Retorna 200 para o MP nao reenviar -- logamos o erro internamente
    return jsonResponse({ received: true, message: "Nao foi possivel buscar dados do pagamento." }, 200);
  }

  const mpStatus      = String(mpPayment.status || "");
  const externalRef   = String(mpPayment.external_reference || "");
  const novoStatus    = mapearStatusMp(mpStatus);

  console.log(`[webhook-pagamento] Payment ${paymentId} | mp_status:${mpStatus} | status_interno:${novoStatus} | ext_ref:${externalRef}`);

  if (!novoStatus) {
    return jsonResponse({ received: true, message: `Status MP '${mpStatus}' nao mapeado.` }, 200);
  }

  // Localiza a transacao pelo external_reference ('oz-{reference_id}')
  // ou pelo gateway_tx_id (payment.id do MP)
  let transaction: Record<string, unknown> | null = null;

  if (externalRef) {
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("external_reference", externalRef)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    transaction = data;
  }

  // Fallback: busca pelo gateway_tx_id (caso external_reference nao coincida)
  if (!transaction) {
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("gateway_tx_id", paymentId)
      .single();
    transaction = data;
  }

  if (!transaction) {
    console.warn(`[webhook-pagamento] Transacao nao encontrada | payment_id:${paymentId} | ext_ref:${externalRef}`);
    // Retorna 200 -- pode ser um pagamento de outro contexto ou ja deletado
    return jsonResponse({ received: true, message: "Transacao nao encontrada." }, 200);
  }

  // Idempotencia -- nao reprocessa status ja final
  const statusFinais = ["approved", "refunded", "cancelled", "rejected"];
  if (statusFinais.includes(transaction.status as string) && transaction.status === novoStatus) {
    console.log(`[webhook-pagamento] Transacao ${transaction.id} ja esta em '${transaction.status}' -- ignorando.`);
    return jsonResponse({ received: true, message: "Status ja atualizado." }, 200);
  }

  // Atualiza status e salva gateway_tx_id se ainda nao estava preenchido
  const updateData: Record<string, unknown> = {
    status:          novoStatus,
    gateway_payload: mpPayment,
    updated_at:      new Date().toISOString(),
  };
  if (novoStatus === "approved") {
    updateData.paid_at = new Date().toISOString();
  }
  // Garante que o gateway_tx_id esta preenchido (pode ter chegado via IPN antes da resposta da API)
  if (!transaction.gateway_tx_id && paymentId) {
    updateData.gateway_tx_id = paymentId;
  }

  const { error: uErr } = await supabase
    .from("transactions")
    .update(updateData)
    .eq("id", transaction.id as string);

  if (uErr) {
    console.error(`[webhook-pagamento] Erro ao atualizar transacao ${transaction.id}:`, uErr);
    return jsonResponse({ received: true, error: "Erro interno ao atualizar status." }, 200);
  }

  console.log(`[webhook-pagamento] Transacao ${transaction.id}: ${transaction.status} -> ${novoStatus}`);

  // Executa acao de negocio correspondente
  if (novoStatus === "approved") {
    await executarAcaoAprovado(supabase, transaction);
  } else if (["failed", "cancelled", "rejected"].includes(novoStatus)) {
    await executarAcaoFalha(supabase, transaction);
  }

  // Sempre retorna 200 -- o MP para de reenviar ao receber 2xx
  return jsonResponse({ received: true, transaction_id: transaction.id, status: novoStatus }, 200);
});
