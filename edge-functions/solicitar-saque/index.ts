// Edge Function: solicitar-saque
// OZ App - Supabase Edge Function
//
// Valida e registra solicitacoes de saque (withdrawal) de promoters server-side.
// Valida: role=promoter, saldo real >= amount, 1 saque/mes, minimo R$10, pix_key obrigatoria.
// Deduz saldo e cria withdrawal atomicamente.
//
// Body: { amount: number, pix_key: string, notes?: string }
// Header: Authorization: Bearer <jwt-do-promoter>

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALOR_MINIMO = 10.00  // R$10,00 mínimo para saque

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    /* ── 1. Autenticação ─────────────────────────────────────── */
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autorizado' }, 401)

    const supabase = adminClient()
    const userSupa = userClient(authHeader)

    const { data: { user }, error: authErr } = await userSupa.auth.getUser()
    if (authErr || !user) return json({ error: 'Token inválido' }, 401)

    /* ── 2. Payload ──────────────────────────────────────────── */
    const { amount, pix_key, notes = '' } = await req.json()

    if (!amount || typeof amount !== 'number') {
      return json({ error: 'Informe um valor válido.' }, 400)
    }
    if (amount < VALOR_MINIMO) {
      return json({ error: `Valor mínimo para saque é R$${VALOR_MINIMO.toFixed(2).replace('.', ',')}.` }, 400)
    }
    if (!pix_key?.trim()) {
      return json({ error: 'Chave Pix obrigatória.' }, 400)
    }

    /* ── 3. Busca dados reais do promoter no banco ───────────── */
    const { data: promoter, error: userErr } = await supabase
      .from('users')
      .select('id, role, balance, pix_key')
      .eq('id', user.id)
      .single()

    if (userErr || !promoter) return json({ error: 'Usuário não encontrado.' }, 404)
    if (promoter.role !== 'promoter') return json({ error: 'Acesso negado: apenas promoters podem solicitar saques.' }, 403)

    /* ── 4. Valida saldo real (server-side, não confia no browser) */
    const saldoReal = promoter.balance ?? 0
    if (amount > saldoReal) {
      return json({
        error: `Saldo insuficiente. Disponível: R$${saldoReal.toFixed(2).replace('.', ',')}.`,
      }, 400)
    }

    /* ── 5. Verifica limite de 1 saque por mês ───────────────── */
    const agora     = new Date()
    const anoAtual  = agora.getFullYear()
    const mesAtual  = agora.getMonth() // 0-11
    const inicioMes = new Date(anoAtual, mesAtual, 1).getTime()
    const fimMes    = new Date(anoAtual, mesAtual + 1, 1).getTime()

    const { data: saquesDoMes } = await supabase
      .from('withdrawals')
      .select('id')
      .eq('promoter_id', user.id)
      .gte('created_at', inicioMes)
      .lt('created_at', fimMes)

    if (saquesDoMes && saquesDoMes.length > 0) {
      return json({ error: 'Você já realizou um saque este mês. Aguarde o próximo mês.' }, 409)
    }

    /* ── 6. Registra saque e deduz saldo atomicamente ─────────── */
    const novoSaldo = round2(saldoReal - amount)
    const now       = Date.now()

    // Deduz saldo
    const { error: updateErr } = await supabase
      .from('users')
      .update({ balance: novoSaldo, updated_at: now })
      .eq('id', user.id)

    if (updateErr) {
      return json({ error: 'Erro ao atualizar saldo. Tente novamente.' }, 500)
    }

    // Cria registro de saque
    const { data: withdrawal, error: wdErr } = await supabase
      .from('withdrawals')
      .insert({
        promoter_id: user.id,
        amount,
        pix_key:     pix_key.trim(),
        notes,
        status:      'solicitado',
        created_at:  now,
        updated_at:  now,
      })
      .select()
      .single()

    if (wdErr) {
      // Tenta reverter o saldo se o insert falhar
      await supabase
        .from('users')
        .update({ balance: saldoReal, updated_at: Date.now() })
        .eq('id', user.id)
      return json({ error: 'Erro ao registrar saque. Tente novamente.' }, 500)
    }

    return json({
      ok: true,
      withdrawal,
      novo_saldo: novoSaldo,
      message: `Saque de R$${amount.toFixed(2).replace('.', ',')} solicitado com sucesso!`,
    }, 201)

  } catch (err) {
    console.error('[solicitar-saque]', err)
    return json({ error: err.message ?? 'Erro interno' }, 500)
  }
})

/* ── Helpers ─────────────────────────────────────────────────── */

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function userClient(authHeader: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
