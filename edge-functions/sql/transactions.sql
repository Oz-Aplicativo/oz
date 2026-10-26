-- ============================================================
--  OZ App -- Tabela de Transacoes Financeiras
--  Gateway: Mercado Pago
--  Execute no Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Cria a tabela
CREATE TABLE IF NOT EXISTS public.transactions (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vinculo com o usuario pagador
  user_id          text          NOT NULL,

  -- Tipo da transacao:
  --   'activation'  -> ativacao individual (R$5)
  --   'night'       -> noite toda (R$10)
  --   'reservation' -> reserva antecipada (R$5)
  --   'withdrawal'  -> saque de promoter
  type             text          NOT NULL
    CHECK (type IN ('activation', 'night', 'reservation', 'withdrawal')),

  -- ID do registro vinculado (activations.id / reservations.id / withdrawals.id)
  reference_id     text,

  -- Valor em reais -- SEMPRE definido pelo servidor, nunca pelo browser
  amount           numeric(10,2) NOT NULL CHECK (amount >= 0),

  -- Status do pagamento -- atualizado APENAS pelo webhook do Mercado Pago
  --   'pending'   -> aguardando pagamento (PIX gerado, aguardando leitura)
  --   'approved'  -> pago e confirmado pelo gateway
  --   'failed'    -> falhou (cartao recusado, expirado, etc.)
  --   'refunded'  -> estornado / devolvido
  --   'cancelled' -> cancelado antes do pagamento
  --   'in_process'-> em analise (cartao com revisao manual)
  --   'rejected'  -> rejeitado pelo gateway (diferente de failed)
  status           text          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'failed', 'refunded', 'cancelled', 'in_process', 'rejected')),

  -- Metodo de pagamento (conforme Mercado Pago)
  --   'pix' | 'credit_card' | 'debit_card' | 'boleto'
  payment_method   text,

  -- Gateway utilizado (fixo: 'mercadopago')
  gateway          text          DEFAULT 'mercadopago',

  -- ID do pagamento no Mercado Pago (payment.id)
  -- Usado para consultas, estornos e suporte
  gateway_tx_id    text          UNIQUE,

  -- ID da preferencia/order no Mercado Pago (preference_id ou order_id)
  -- Diferente do gateway_tx_id -- a preferencia e criada antes, o payment depois
  gateway_order_id text,

  -- ID externo (external_reference) enviado ao Mercado Pago para idempotencia
  -- Formato: 'oz-{reference_id}' -- permite localizar a transacao pelo webhook
  external_reference text,

  -- Payload raw do Mercado Pago (resposta completa -- para auditoria)
  -- Nunca exposto ao frontend
  gateway_payload  jsonb,

  -- Dados do PIX gerado pelo Mercado Pago
  pix_qr_code      text,        -- imagem base64 do QR Code (data:image/png;base64,...)
  pix_copy_paste   text,        -- codigo copia-e-cola (EMV)
  pix_expires_at   timestamptz, -- expiracao (Mercado Pago: 24h por padrao)

  -- Timestamps
  paid_at          timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Indices para performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON public.transactions (user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON public.transactions (status);

CREATE INDEX IF NOT EXISTS idx_transactions_reference_id
  ON public.transactions (reference_id);

CREATE INDEX IF NOT EXISTS idx_transactions_gateway_tx_id
  ON public.transactions (gateway_tx_id)
  WHERE gateway_tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_external_reference
  ON public.transactions (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_created_at
  ON public.transactions (created_at DESC);

-- ============================================================
-- 3. Habilita RLS
-- ============================================================

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Politicas RLS
-- ============================================================

-- Admin tem acesso total
DROP POLICY IF EXISTS "admin_full_access" ON public.transactions;
CREATE POLICY "admin_full_access"
  ON public.transactions
  FOR ALL
  USING (auth.jwt() ->> 'email' = 'admin@oz.com');

-- Usuario autenticado ve apenas suas proprias transacoes
DROP POLICY IF EXISTS "user_select_own" ON public.transactions;
CREATE POLICY "user_select_own"
  ON public.transactions
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- Nenhum usuario pode INSERT direto -- apenas Edge Functions com service_role
DROP POLICY IF EXISTS "block_direct_insert" ON public.transactions;
CREATE POLICY "block_direct_insert"
  ON public.transactions
  FOR INSERT
  WITH CHECK (FALSE);

-- Nenhum usuario pode UPDATE direto -- apenas Edge Functions com service_role
DROP POLICY IF EXISTS "block_direct_update" ON public.transactions;
CREATE POLICY "block_direct_update"
  ON public.transactions
  FOR UPDATE
  USING (FALSE);

-- Nenhum usuario pode DELETE -- transacoes sao imutaveis
DROP POLICY IF EXISTS "block_delete" ON public.transactions;
CREATE POLICY "block_delete"
  ON public.transactions
  FOR DELETE
  USING (FALSE);

-- ============================================================
-- 5. Comentarios para documentacao
-- ============================================================

COMMENT ON TABLE  public.transactions IS
  'Registro auditavel de todas as transacoes financeiras do OZ App. Gateway: Mercado Pago. Status atualizado apenas via webhook do MP.';

COMMENT ON COLUMN public.transactions.status IS
  'pending | approved | failed | refunded | cancelled | in_process | rejected -- espelha os status do Mercado Pago';

COMMENT ON COLUMN public.transactions.gateway IS
  'Gateway de pagamento utilizado. Atualmente: mercadopago';

COMMENT ON COLUMN public.transactions.gateway_tx_id IS
  'payment.id do Mercado Pago -- unico por pagamento, usado para estornos e consultas';

COMMENT ON COLUMN public.transactions.gateway_order_id IS
  'preference_id ou merchant_order_id do Mercado Pago';

COMMENT ON COLUMN public.transactions.external_reference IS
  'Valor de external_reference enviado ao MP. Formato: oz-{reference_id}. Permite localizar a transacao via webhook sem depender do payment.id.';

COMMENT ON COLUMN public.transactions.gateway_payload IS
  'Payload raw da notificacao IPN/webhook do Mercado Pago -- nunca exposto ao frontend';

COMMENT ON COLUMN public.transactions.reference_id IS
  'ID do registro vinculado em activations, reservations ou withdrawals';

COMMENT ON COLUMN public.transactions.amount IS
  'Valor em reais -- definido pelo servidor na criacao, nunca alterado apos isso';

COMMENT ON COLUMN public.transactions.pix_qr_code IS
  'Imagem base64 do QR Code PIX gerado pelo Mercado Pago (point_of_interaction.transaction_data.qr_code_base64)';

COMMENT ON COLUMN public.transactions.pix_copy_paste IS
  'Codigo EMV copia-e-cola PIX (point_of_interaction.transaction_data.qr_code)';

COMMENT ON COLUMN public.transactions.pix_expires_at IS
  'Data de expiracao do PIX. Mercado Pago usa date_of_expiration no body da criacao do pagamento';

-- ============================================================
-- 6. Script de migracao (se a tabela ja existir com status do Pagar.me)
-- ============================================================
-- Se voce ja criou a tabela com o CHECK antigo (paid ao inves de approved),
-- execute o bloco abaixo para migrar:
--
-- ALTER TABLE public.transactions
--   DROP CONSTRAINT IF EXISTS transactions_status_check;
--
-- ALTER TABLE public.transactions
--   ADD CONSTRAINT transactions_status_check
--   CHECK (status IN ('pending', 'approved', 'failed', 'refunded', 'cancelled', 'in_process', 'rejected'));
--
-- -- Migra status 'paid' para 'approved' se houver registros antigos
-- UPDATE public.transactions SET status = 'approved' WHERE status = 'paid';
--
-- ALTER TABLE public.transactions
--   ADD COLUMN IF NOT EXISTS external_reference text;
--
-- CREATE INDEX IF NOT EXISTS idx_transactions_external_reference
--   ON public.transactions (external_reference)
--   WHERE external_reference IS NOT NULL;
