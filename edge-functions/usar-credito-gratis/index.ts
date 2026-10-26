// Edge Function: usar-credito-gratis
// OZ App - Supabase Edge Function
//
// Consome free_credit do usuario -> free_credit_used com validacao de ownership.
// Idempotente. Valida: JWT, ownership, tipo, status.
//
// Body: { credit_id: string }
// Header: Authorization: Bearer <jwt>
// Respostas: 201 consumido | 200 ja consumido | 400 invalido | 403 nao pertence | 404 nao encontrado

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

// ─── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return corsResponse({ error: "Authorization header ausente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Valida JWT do usuário
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return corsResponse({ error: "Token inválido ou expirado." }, 401);

  // Client com service_role para operações no banco
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: { credit_id?: string };
  try { body = await req.json(); }
  catch { return corsResponse({ error: "Body JSON inválido." }, 400); }

  const { credit_id } = body;
  if (!credit_id) return corsResponse({ error: "credit_id é obrigatório." }, 400);

  // ── Busca o crédito ───────────────────────────────────────────────────────
  const { data: credit, error: cErr } = await supabase
    .from("activations")
    .select("id, user_id, type, status")
    .eq("id", credit_id)
    .single();

  if (cErr || !credit) return corsResponse({ error: "Crédito não encontrado." }, 404);

  // ── Valida ownership — crédito deve pertencer ao usuário autenticado ──────
  if (credit.user_id !== user.id) {
    console.warn(`[usar-credito-gratis] Tentativa de consumo indevido: user ${user.id} tentou usar crédito de ${credit.user_id}`);
    return corsResponse({ error: "Este crédito não pertence ao usuário autenticado." }, 403);
  }

  // ── Idempotência — já foi consumido ──────────────────────────────────────
  if (credit.type === "free_credit_used") {
    return corsResponse({ message: "Crédito já consumido anteriormente.", credit }, 200);
  }

  // ── Valida tipo e status ──────────────────────────────────────────────────
  if (credit.type !== "free_credit") {
    return corsResponse({
      error: `Registro não é um free_credit. Tipo atual: '${credit.type}'.`,
    }, 400);
  }
  if (credit.status === "cancelled") {
    return corsResponse({ error: "Este crédito está cancelado e não pode ser consumido." }, 400);
  }

  // ── Consome o crédito ─────────────────────────────────────────────────────
  const { data: updated, error: uErr } = await supabase
    .from("activations")
    .update({
      type:       "free_credit_used",
      updated_at: Date.now(),
    })
    .eq("id", credit_id)
    .select()
    .single();

  if (uErr) {
    console.error("[usar-credito-gratis] Erro ao consumir crédito:", uErr);
    return corsResponse({ error: "Erro ao consumir crédito. Tente novamente." }, 500);
  }

  console.log(`[usar-credito-gratis] Crédito ${credit_id} consumido pelo usuário ${user.id}`);
  return corsResponse({ success: true, credit: updated }, 201);
});
