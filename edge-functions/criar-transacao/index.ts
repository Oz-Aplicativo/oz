// Edge Function: criar-transacao
// OZ App - Supabase Edge Function
//
// NOVO FLUXO SEGURO:
//   1. Cria a ativacao no banco com status='pending_payment'
//   2. Cria pagamento PIX no Mercado Pago
//   3. Retorna { activation_id, pix_copy_paste, pix_qr_code, transaction_id } para o frontend
//   4. O webhook-pagamento e o unico responsavel por colocar status='active' e distribuir comissoes
//
// O frontend NAO ativa beneficio diretamente — apenas exibe o PIX e faz polling de status.
//
// Body: {
//   type: 'activation' | 'night',
//   bar_id, bar_name, qr_code, expires_at,
//   promoter_id?, promoter_code?, pick_promoter?,  // para individual
//   night_session?, night_pick_promoter?            // para noite toda
// }
// Header: Authorization: Bearer <jwt>
// Secret: MP_ACCESS_TOKEN

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constantes financeiras (definidas APENAS no servidor)
// ---------------------------------------------------------------------------

const AMOUNTS: Record<string, number> = {
  activation: 5.00,   // R$5  — individual
  night:      10.00,  // R$10 — noite toda
};

const DESCRICOES: Record<string, string> = {
  activation: "OZ App - Ativacao Individual",
  night:      "OZ App - Noite Toda",
};

// ---------------------------------------------------------------------------
// Cria pagamento PIX no Mercado Pago
// ---------------------------------------------------------------------------

async function criarPagamentoPix(params: {
  mpToken:        string;
  amountReais:    number;
  description:    string;
  externalRef:    string;
  userId:         string;
  userEmail:      string;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const body = {
    transaction_amount: params.amountReais,
    description:        params.description,
    payment_method_id:  "pix",
    external_reference: params.externalRef,
    date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // PIX expira em 30min
    payer: {
      email: params.userEmail || `user-${params.userId}@oz.app`,
    },
  };

  const res = await fetch("https://api.mercadopago.com/v1/payments", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "Authorization":     `Bearer ${params.mpToken}`,
      "X-Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`MP PIX erro ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Mapeia status do MP para status interno
// ---------------------------------------------------------------------------

function mapearStatusMp(mpStatus: string): string {
  const mapa: Record<string, string> = {
    pending:    "pending",
    approved:   "approved",
    authorized: "approved",
    in_process: "in_process",
    rejected:   "rejected",
    cancelled:  "cancelled",
  };
  return mapa[mpStatus] || "pending";
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return corsResponse({ error: "Authorization header ausente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mpToken     = Deno.env.get("MP_ACCESS_TOKEN");

  if (!mpToken) {
    console.error("[criar-transacao] MP_ACCESS_TOKEN nao configurado.");
    return corsResponse({ error: "Gateway de pagamento nao configurado." }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return corsResponse({ error: "Token invalido ou expirado." }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Body ──────────────────────────────────────────────────────────────────
  let body: {
    type?:                  string;
    bar_id?:                string;
    bar_name?:              string;
    qr_code?:               string;
    expires_at?:            string;
    promoter_id?:           string;
    promoter_code?:         string;
    pick_promoter?:         string;
    night_session?:         string;
    night_pick_promoter?:   string;
    benefit_date?:          string; // YYYY-MM-DD — data do benefício agendado (nulo = hoje)
    scheduled_benefit_id?:  string; // ID do scheduled_benefit (para benefícios agendados)
  };
  try {
    body = await req.json();
  } catch {
    return corsResponse({ error: "Body JSON invalido." }, 400);
  }

  const {
    type,
    bar_id, bar_name, qr_code, expires_at,
    promoter_id, promoter_code, pick_promoter,
    night_session, night_pick_promoter,
    benefit_date: benefitDateRaw,
    scheduled_benefit_id,
  } = body;

  // ── Validações básicas ────────────────────────────────────────────────────
  if (!type || !AMOUNTS[type]) {
    return corsResponse({ error: "type invalido. Use: activation | night." }, 400);
  }
  if (!bar_id)    return corsResponse({ error: "bar_id e obrigatorio." }, 400);
  if (!bar_name)  return corsResponse({ error: "bar_name e obrigatorio." }, 400);
  if (!qr_code)   return corsResponse({ error: "qr_code e obrigatorio." }, 400);
  if (!expires_at) return corsResponse({ error: "expires_at e obrigatorio." }, 400);
  // Validação de night_session feita depois do cálculo de datas (todayBRT)

  // ── Valida bar ────────────────────────────────────────────────────────────
  const { data: bar } = await supabase
    .from("bars")
    .select("id, name, active")
    .eq("id", bar_id)
    .single();

  if (!bar)        return corsResponse({ error: "Bar nao encontrado." }, 404);
  if (!bar.active) return corsResponse({ error: "Bar inativo." }, 400);

  // ── Busca usuario ─────────────────────────────────────────────────────────
  const { data: dbUser } = await supabase
    .from("users")
    .select("id, name, email, activations_count, referred_by")
    .eq("id", user.id)
    .single();

  if (!dbUser) return corsResponse({ error: "Usuario nao encontrado." }, 404);

  const userEmail = dbUser.email || user.email || `user-${user.id}@oz.app`;
  const userName  = dbUser.name || userEmail.split("@")[0];

  // ── Datas — declaradas aqui pois são usadas em idempotência, anti-duplicata e INSERT ──
  // Usa BRT (UTC-3) para coincidir com _todayStr() do frontend que usa hora local do navegador.
  // Sem isso, das 21h às 00h BRT o UTC já virou o dia seguinte e benefit_date não bate com todayStr.
  const nowBRT      = new Date(Date.now() - 3 * 60 * 60 * 1000); // desloca -3h
  const todayBRT    = nowBRT.toISOString().split("T")[0];         // YYYY-MM-DD no fuso BRT
  const benefitDate = benefitDateRaw || todayBRT;
  const isAdvance   = !!benefitDateRaw && benefitDateRaw !== todayBRT; // data futura = benefício agendado

  // Para advance_night, night_session pode ser o qr_code (reservation id) quando não enviado
  const effectiveNightSession = night_session || (type === "night" && isAdvance ? qr_code : null);
  if (type === "night" && !effectiveNightSession) {
    return corsResponse({ error: "night_session e obrigatorio para tipo night." }, 400);
  }

  // ── Idempotência: verifica se já existe ativação pending_payment com PIX ainda válido ──
  // PIX expira em 30 minutos — só reutiliza se ainda estiver dentro desse prazo.
  const PIX_TTL_MS = 30 * 60 * 1000; // 30 minutos em ms
  const agora      = Date.now();

  // Tipos correspondentes ao type recebido (activation → individual/advance_individual, night → night_link/advance_night)
  const tiposPendentes = type === "night"
    ? ["night_link", "advance_night"]
    : ["individual", "advance_individual"];

  const { data: existingAct } = await supabase
    .from("activations")
    .select("id, status, created_at, type")
    .eq("user_id", user.id)
    .eq("bar_id", bar_id)
    .eq("status", "pending_payment")
    .in("type", tiposPendentes)
    .eq("benefit_date", benefitDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existingAct) {
    const pixAge = agora - Number(existingAct.created_at);
    const pixAindaValido = pixAge < PIX_TTL_MS;

    if (pixAindaValido) {
      // PIX ainda dentro dos 30 min — busca a transação correspondente
      const { data: existingTx } = await supabase
        .from("transactions")
        .select("id, status, pix_qr_code, pix_copy_paste, pix_expires_at")
        .eq("reference_id", existingAct.id)
        .eq("user_id", user.id)
        .in("status", ["pending", "in_process"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (existingTx) {
        console.log(`[criar-transacao] Reutilizando PIX valido (${Math.floor(pixAge / 60000)}min) para ativacao ${existingAct.id}`);
        return corsResponse({
          success:       true,
          reused:        true,
          activation_id: existingAct.id,
          transaction:   {
            id:             existingTx.id,
            status:         existingTx.status,
            pix_qr_code:    existingTx.pix_qr_code,
            pix_copy_paste: existingTx.pix_copy_paste,
            pix_expires_at: existingTx.pix_expires_at,
          },
        }, 200);
      }
    } else {
      // PIX expirou — cancela a ativação pendente para liberar nova tentativa
      console.log(`[criar-transacao] PIX expirado (${Math.floor(pixAge / 60000)}min) — cancelando ativacao pendente ${existingAct.id}`);
      await supabase
        .from("activations")
        .update({ status: "cancelled", cancelled_by: "pix_expired", updated_at: agora })
        .eq("id", existingAct.id);
    }
  }

  // ── Anti-duplicata: bloqueia se já existe ativação active para o mesmo bar/data ──
  // Para benefícios agendados (isAdvance=true): compara por benefit_date (data futura).
  // Para ativações normais do dia: compara por created_at dentro do dia UTC.
  const inicioDiaMs = new Date(todayBRT + "T00:00:00.000Z").getTime();
  const fimDiaMs    = inicioDiaMs + 86_400_000;

  if (type === "activation") {
    // ── Verifica se já tem advance_night ativo para esta benefit_date ─────────
    // Libera night_checkin gratuito em qualquer bar, qualquer quantidade de benefícios,
    // desde que o advance_night esteja active para a mesma data.
    const { data: hasAdvNight } = await supabase
      .from("activations")
      .select("id, night_session")
      .eq("user_id", user.id)
      .eq("type", "advance_night")
      .eq("status", "active")
      .eq("benefit_date", benefitDate)
      .limit(1)
      .single();

    if (hasAdvNight) {
      // Evita duplicata de night_checkin no mesmo bar+data
      const { data: jaFezCheckin } = await supabase
        .from("activations")
        .select("id")
        .eq("user_id", user.id)
        .eq("bar_id", bar_id)
        .eq("type", "night_checkin")
        .eq("benefit_date", benefitDate)
        .neq("status", "cancelled")
        .limit(1)
        .single();

      if (jaFezCheckin) {
        return corsResponse({ error: "Voce ja fez check-in neste bar para esta data." }, 409);
      }

      // Cria night_checkin gratuito com status active direto
      const { data: checkin, error: chkErr } = await supabase
        .from("activations")
        .insert({
          user_id:              user.id,
          user_name:            userName,
          bar_id,
          bar_name,
          type:                 "night_checkin",
          amount:               0,
          qr_code:              qr_code,
          expires_at:           expires_at,
          benefit_date:         benefitDate,
          night_session:        hasAdvNight.night_session || hasAdvNight.id,
          status:               "active",
          promoter_id:          promoter_id  || dbUser.referred_by || null,
          promoter_code:        promoter_code || null,
          scheduled_benefit_id: scheduled_benefit_id || null,
          created_at:           Date.now(),
          updated_at:           Date.now(),
        })
        .select()
        .single();

      if (chkErr || !checkin) {
        console.error("[criar-transacao] Erro ao criar night_checkin:", chkErr);
        return corsResponse({ error: "Erro ao registrar check-in da Noite Toda." }, 500);
      }

      console.log(`[criar-transacao] night_checkin gratuito criado para ${benefitDate} bar:${bar_id} — activation ${checkin.id}`);
      return corsResponse({
        success:       true,
        free_checkin:  true,
        activation_id: checkin.id,
        transaction:   null,
      }, 200);
    }

    // Tipos a verificar: individual (ativação normal) + advance_individual (agendada)
    let dupQuery = supabase
      .from("activations")
      .select("id")
      .eq("user_id", user.id)
      .eq("bar_id", bar_id)
      .in("type", ["individual", "advance_individual"])
      .eq("status", "active");

    if (isAdvance) {
      dupQuery = dupQuery.eq("benefit_date", benefitDate);
    } else {
      dupQuery = dupQuery.gte("created_at", inicioDiaMs).lt("created_at", fimDiaMs);
    }

    const { data: jaAtivou } = await dupQuery.limit(1);
    if (jaAtivou && jaAtivou.length > 0) {
      return corsResponse({ error: "Voce ja ativou este bar para essa data." }, 409);
    }
  }

  if (type === "night") {
    const { data: jaAtivou } = await supabase
      .from("activations")
      .select("id")
      .eq("user_id", user.id)
      .in("type", ["night", "night_link", "advance_night"])
      .eq("status", "active")
      .eq(isAdvance ? "benefit_date" : "night_session", isAdvance ? benefitDate : effectiveNightSession!)
      .limit(1);

    if (jaAtivou && jaAtivou.length > 0) {
      return corsResponse({ error: "Voce ja ativou a Noite Toda para essa data." }, 409);
    }
  }

  // ── PASSO 1: Cria ativação com status 'pending_payment' ──────────────────
  // O benefício NÃO está ativo ainda — apenas reservado até o pagamento.
  // O webhook é o único que muda para 'active'.

  // Tipo da ativação:
  // - benefício agendado (advance) → advance_individual / advance_night
  // - ativação normal do dia       → individual / night_link
  let activationType: string;
  if (type === "activation") {
    activationType = isAdvance ? "advance_individual" : "individual";
  } else {
    activationType = isAdvance ? "advance_night" : "night_link";
  }

  console.log(`[criar-transacao] benefit_date:${benefitDate} | isAdvance:${isAdvance} | actType:${activationType}`);

  const activationInsert: Record<string, unknown> = {
    user_id:       user.id,
    user_name:     userName,
    bar_id,
    bar_name,
    type:          activationType,
    amount:        AMOUNTS[type],
    qr_code,
    expires_at,
    promoter_id:   promoter_id  || dbUser.referred_by || null,
    promoter_code: promoter_code || null,
    benefit_date:  benefitDate,          // ★ data correta: hoje ou data futura do benefício agendado
    status:        "pending_payment",
    created_at:    Date.now(),           // int8 — milissegundos
    updated_at:    Date.now(),           // int8 — milissegundos
  };

  if (type === "activation") {
    activationInsert.pick_promoter = pick_promoter || null;
  }
  if (type === "night") {
    activationInsert.night_session        = effectiveNightSession!;
    activationInsert.night_pick_promoter  = night_pick_promoter || null;
  }

  const { data: activation, error: aErr } = await supabase
    .from("activations")
    .insert(activationInsert)
    .select()
    .single();

  if (aErr || !activation) {
    console.error("[criar-transacao] Erro ao criar ativacao:", JSON.stringify(aErr));
    return corsResponse({
      error:   "Erro ao criar ativacao.",
      detail:  aErr?.message  || null,
      hint:    aErr?.hint     || null,
      code:    aErr?.code     || null,
    }, 500);
  }

  console.log(`[criar-transacao] Ativacao ${activation.id} criada com status pending_payment`);

  // ── PASSO 2: Cria pagamento PIX no Mercado Pago ───────────────────────────
  // external_reference = 'oz-{activation.id}' — chave para o webhook localizar a ativação
  const externalRef    = `oz-${activation.id}`;
  const idempotencyKey = `oz-${activation.id}-pix`;
  const amountReais    = AMOUNTS[type];

  let mpResponse: Record<string, unknown>;
  try {
    mpResponse = await criarPagamentoPix({
      mpToken,
      amountReais,
      description:  DESCRICOES[type],
      externalRef,
      userId:       user.id,
      userEmail,
      idempotencyKey,
    });
  } catch (err) {
    const errMsg = (err instanceof Error) ? err.message : String(err);
    console.error("[criar-transacao] Erro no Mercado Pago:", errMsg);
    // Cancela a ativação criada para não deixar lixo no banco
    await supabase
      .from("activations")
      .update({ status: "cancelled", cancelled_by: "mp_error", updated_at: Date.now() })
      .eq("id", activation.id);
    // Retorna o detalhe real do MP para facilitar diagnóstico
    return corsResponse({
      error:  "Erro ao gerar cobranca PIX. Tente novamente.",
      detail: errMsg,
    }, 502);
  }

  // ── Extrai dados do PIX ───────────────────────────────────────────────────
  const pointOfInteraction = (mpResponse.point_of_interaction as Record<string, unknown>) || {};
  const transactionData    = (pointOfInteraction.transaction_data as Record<string, unknown>) || {};

  const gatewayTxId     = String(mpResponse.id || "");
  const mpStatus        = String(mpResponse.status || "pending");
  const pixQrCodeBase64 = (transactionData.qr_code_base64 as string) || "";
  const pixCopyPaste    = (transactionData.qr_code as string) || "";
  const pixExpiresAt    = (mpResponse.date_of_expiration as string) || null;
  // Sempre trata como 'pending' aqui — o webhook é o único que ativa o benefício.
  // Mesmo que o MP retorne 'approved' imediatamente (sandbox), o fluxo correto
  // é aguardar o webhook. Isso evita ativação duplicada.
  const statusInterno   = "pending";

  // ── PASSO 3: Salva transação no banco ────────────────────────────────────
  const { data: transaction, error: tErr } = await supabase
    .from("transactions")
    .insert({
      user_id:            user.id,
      type,
      reference_id:       activation.id,  // ← vincula a ativação
      amount:             amountReais,
      status:             statusInterno,
      payment_method:     "pix",
      gateway:            "mercadopago",
      gateway_tx_id:      gatewayTxId  || null,
      external_reference: externalRef,
      gateway_payload:    mpResponse,
      pix_qr_code:        pixQrCodeBase64 || null,
      pix_copy_paste:     pixCopyPaste    || null,
      pix_expires_at:     pixExpiresAt    || null,
      paid_at:            statusInterno === "approved" ? new Date().toISOString() : null,
      created_at:         new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    })
    .select()
    .single();

  if (tErr) {
    console.error("[criar-transacao] Erro ao salvar transacao:", tErr);
    // Não falha — o PIX já foi criado no MP. Retorna sem transaction_id.
    return corsResponse({
      success:       true,
      activation_id: activation.id,
      transaction: {
        id:             null,
        status:         statusInterno,
        pix_qr_code:    pixQrCodeBase64,
        pix_copy_paste: pixCopyPaste,
        pix_expires_at: pixExpiresAt,
      },
    }, 201);
  }

  console.log(
    `[criar-transacao] Transacao ${transaction.id} | ativacao:${activation.id} | R$${amountReais} | mp_id:${gatewayTxId}`
  );

  // ── Resposta ao frontend ──────────────────────────────────────────────────
  // NUNCA retorna gateway_payload completo.
  // O frontend só precisa do PIX e do activation_id para polling.
  return corsResponse({
    success:       true,
    activation_id: activation.id,       // usado no polling de status
    transaction: {
      id:             transaction.id,
      status:         transaction.status,
      amount:         transaction.amount,
      pix_qr_code:    transaction.pix_qr_code,
      pix_copy_paste: transaction.pix_copy_paste,
      pix_expires_at: transaction.pix_expires_at,
    },
  }, 201);
});
