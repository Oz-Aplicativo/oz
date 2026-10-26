-- ============================================================
--  OZ App — Corrige RLS da tabela activations
--  Execute no Supabase Dashboard -> SQL Editor
-- ============================================================
--
--  Problema anterior:
--    A política activation_select_own só permitia user_id = auth.uid(),
--    então o bar não conseguia ver as ativações dos clientes (bar_id ≠ auth.uid()).
--
--  Solução:
--    Adicionar política que permite ao bar ver todas as ativações do seu bar.
--    O bar_id do usuário autenticado é obtido via subquery na tabela users.
-- ============================================================

-- 1. Remove políticas antigas e recria todas
ALTER TABLE public.activations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activation_select_own"    ON public.activations;
DROP POLICY IF EXISTS "activation_insert_own"    ON public.activations;
DROP POLICY IF EXISTS "activation_update_block"  ON public.activations;
DROP POLICY IF EXISTS "activation_bar_select"    ON public.activations;
DROP POLICY IF EXISTS "admin_full_access"        ON public.activations;

-- 2. SELECT: cliente vê suas próprias ativações
CREATE POLICY "activation_select_own"
  ON public.activations
  FOR SELECT
  USING (user_id = auth.uid()::text);

-- 3. SELECT: bar vê todas as ativações do seu bar
--    (necessário para a lista ao vivo: pollBarResults)
CREATE POLICY "activation_bar_select"
  ON public.activations
  FOR SELECT
  USING (
    bar_id = (
      SELECT bar_id FROM public.users
      WHERE id = auth.uid()::text
        AND role = 'bar'
      LIMIT 1
    )
  );

-- 4. INSERT: cliente cria apenas suas próprias ativações (fluxo grátis)
--    Edge Functions com service_role ignoram RLS e podem inserir livremente
CREATE POLICY "activation_insert_own"
  ON public.activations
  FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- 5. UPDATE: bloqueado para usuários comuns
--    Apenas Edge Functions com service_role (webhook-pagamento, cancelar-ativacao, etc.)
--    podem atualizar ativações — elas usam service_role key que bypassa RLS
CREATE POLICY "activation_update_block"
  ON public.activations
  FOR UPDATE
  USING (FALSE);

-- 6. Admin tem acesso total
CREATE POLICY "admin_full_access"
  ON public.activations
  FOR ALL
  USING (auth.jwt() ->> 'email' = 'admin@oz.com');

-- 7. Confirma resultado
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'activations' AND schemaname = 'public'
ORDER BY policyname;
