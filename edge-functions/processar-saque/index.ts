// Edge Function: processar-saque
// OZ App - Supabase Edge Function
//
// Valida e processa a solicitacao de saque de um promoter.
// Regras: 1 saque/mes, saldo >= valor, minimo R$20.
// Cria registro em withdrawals e debita balance imediatamente.
//
// Body: { amount: number, pix_key: string, notes?: string }
// Header: Authorization: Bearer <jwt-do-promoter>

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

const SAQUE_MINIMO = 20; // R$20,00

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação ────────────────────────────────────────────────────────
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
  let body: { amount?: number; pix_key?: string; notes?: string };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { amount, pix_key, notes } = body;

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return corsResponse({ error: "Campo 'amount' inválido." }, 400);
  }
  if (!pix_key || typeof pix_key !== "string" || pix_key.trim() === "") {
    return corsResponse({ error: "Campo 'pix_key' é obrigatório." }, 400);
  }
  if (amount < SAQUE_MINIMO) {
    return corsResponse({ error: `Valor mínimo de saque é R$${SAQUE_MINIMO}.` }, 400);
  }

  // ── Busca dados do promoter ─────────────────────────────────────────────
  const { data: promoter, error: pErr } = await supabase
    .from("users")
    .select("id, role, balance, pix_key")
    .eq("id", user.id)
    .single();

  if (pErr || !promoter) {
    return corsResponse({ error: "Usuário não encontrado." }, 404);
  }
  if (promoter.role !== "promoter") {
    return corsResponse({ error: "Apenas promoters podem solicitar saques." }, 403);
  }

  const balanceAtual = Number(promoter.balance || 0);
  if (balanceAtual < amount) {
    return corsResponse({
      error:    "Saldo insuficiente.",
      balance:  balanceAtual,
      solicitado: amount,
    }, 400);
  }

  // ── Verifica saque no mês corrente ──────────────────────────────────────
  const agora   = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
  const fimMes    = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const { data: saqueMes } = await supabase
    .from("withdrawals")
    .select("id, status, amount, created_at")
    .eq("promoter_id", user.id)
    .gte("created_at", inicioMes)
    .lte("created_at", fimMes)
    .not("status", "eq", "cancelado");

  if (saqueMes && saqueMes.length > 0) {
    return corsResponse({
      error:    "Já existe um saque solicitado neste mês.",
      saque_existente: saqueMes[0],
    }, 409);
  }

  // ── Debita balance e cria withdrawal ───────────────────────────────────
  const novoBalance = balanceAtual - amount;

  const { error: bErr } = await supabase
    .from("users")
    .update({ balance: novoBalance, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (bErr) {
    console.error("[processar-saque] Erro ao debitar balance:", bErr);
    return corsResponse({ error: "Erro ao atualizar saldo." }, 500);
  }

  const { data: withdrawal, error: wErr } = await supabase
    .from("withdrawals")
    .insert({
      promoter_id: user.id,
      amount,
      pix_key:     pix_key.trim(),
      notes:       notes || null,
      status:      "pendente",
      created_at:  new Date().toISOString(),
    })
    .select()
    .single();

  if (wErr) {
    // Reverte o débito em caso de falha na inserção
    console.error("[processar-saque] Erro ao criar withdrawal — revertendo balance:", wErr);
    await supabase
      .from("users")
      .update({ balance: balanceAtual, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    return corsResponse({ error: "Erro ao registrar saque. Tente novamente." }, 500);
  }

  return corsResponse({
    success:    true,
    withdrawal,
    balance_anterior: balanceAtual,
    balance_atual:    novoBalance,
  }, 201);
});
