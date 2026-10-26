-- ============================================================
--  OZ App — Prepara tabela activations para o novo fluxo de pagamento
--  Execute no Supabase Dashboard -> SQL Editor
-- ============================================================
--
--  O novo fluxo cria ativações com status='pending_payment' antes
--  do pagamento ser confirmado. O webhook-pagamento é o único que
--  muda para status='active'.
--
--  Este script garante que:
--    1. A coluna status aceita o valor 'pending_payment'
--    2. Existe índice para o polling de status ser rápido
--    3. RLS permite que o usuário leia apenas suas próprias ativações
-- ============================================================


-- 1. Remove constraint antiga de status (se existir) e recria aceitando pending_payment
ALTER TABLE public.activations
  DROP CONSTRAINT IF EXISTS activations_status_check;

ALTER TABLE public.activations
  ADD CONSTRAINT activations_status_check
  CHECK (status IN (
    'pending_payment',   -- aguardando pagamento (novo)
    'active',            -- benefício ativo (pago ou grátis)
    'cancelled',         -- cancelado (pagamento falhou ou bar cancelou)
    'confirmado',        -- alias legado de active
    'usado',             -- alias legado de active
    'failed'             -- pagamento rejeitado
  ));


-- 2. Garante que a coluna cancelled_by existe (usada pelo webhook em caso de falha)
ALTER TABLE public.activations
  ADD COLUMN IF NOT EXISTS cancelled_by text;

ALTER TABLE public.activations
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;


-- 3. Índice para o polling de status (get-activation-status consulta por id + user_id)
CREATE INDEX IF NOT EXISTS idx_activations_id_user_id
  ON public.activations (id, user_id);

-- Índice para o webhook localizar ativações pending_payment rapidamente
CREATE INDEX IF NOT EXISTS idx_activations_status
  ON public.activations (status)
  WHERE status = 'pending_payment';


-- 4. RLS — usuário lê apenas suas ativações
--    (necessário para get-activation-status funcionar via anon key)
ALTER TABLE public.activations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activation_select_own"  ON public.activations;
DROP POLICY IF EXISTS "activation_insert_own"  ON public.activations;
DROP POLICY IF EXISTS "admin_full_access"       ON public.activations;

-- SELECT: usuário vê apenas as próprias ativações
CREATE POLICY "activation_select_own"
  ON public.activations
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- INSERT: usuário cria apenas as próprias ativações (fluxo grátis pelo frontend)
CREATE POLICY "activation_insert_own"
  ON public.activations
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- UPDATE: bloqueado para usuários comuns — apenas service_role (Edge Functions) pode atualizar
-- O webhook-pagamento usa service_role key, então passa por cima do RLS
DROP POLICY IF EXISTS "activation_update_block" ON public.activations;
CREATE POLICY "activation_update_block"
  ON public.activations
  FOR UPDATE
  USING (FALSE);  -- nenhum usuário atualiza diretamente — só Edge Functions com service_role

-- Admin tem acesso total
CREATE POLICY "admin_full_access"
  ON public.activations
  FOR ALL
  USING (auth.jwt() ->> 'email' = 'admin@oz.com');


-- 5. Confirma resultado
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'activations'
  AND table_schema = 'public'
  AND column_name IN ('status', 'cancelled_by', 'cancelled_at')
ORDER BY column_name;

SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'activations' AND schemaname = 'public'
ORDER BY policyname;
