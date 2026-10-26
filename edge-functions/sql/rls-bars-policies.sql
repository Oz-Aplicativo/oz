-- ============================================================
--  OZ App -- RLS tabela bars
--  Execute no Supabase Dashboard -> SQL Editor
-- ============================================================
--
--  Mesmo padrao da tabela users:
--    users → id = auth.uid()
--    bars  → id = auth.uid()
--
--  SELECT  → qualquer usuario autenticado (bares sao dados publicos)
--  INSERT  → id deve ser igual ao uid do token (bar cria o proprio perfil)
--  UPDATE  → somente o proprio dono (id = auth.uid())
--  DELETE  → somente o proprio dono (id = auth.uid())
--  Admin   → acesso total
-- ============================================================


-- 0. Habilita RLS
ALTER TABLE public.bars ENABLE ROW LEVEL SECURITY;


-- 1. Remove todas as policies existentes para evitar conflito
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE tablename = 'bars' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.bars', pol.policyname);
  END LOOP;
END $$;


-- 2. SELECT: qualquer autenticado ve todos os bares
CREATE POLICY "bar_select_all"
  ON public.bars
  FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- 3. INSERT: bar so cria o proprio perfil
CREATE POLICY "bar_insert_own"
  ON public.bars
  FOR INSERT
  WITH CHECK (id = auth.uid()::text);


-- 4. UPDATE: bar so edita o proprio perfil
CREATE POLICY "bar_update_own"
  ON public.bars
  FOR UPDATE
  USING  (id = auth.uid()::text)
  WITH CHECK (id = auth.uid()::text);


-- 5. DELETE: bar so deleta o proprio perfil
CREATE POLICY "bar_delete_own"
  ON public.bars
  FOR DELETE
  USING (id = auth.uid()::text);


-- 6. Admin tem acesso total
CREATE POLICY "admin_full_access"
  ON public.bars
  FOR ALL
  USING (auth.jwt() ->> 'email' = 'admin@oz.com');


-- 7. Confirma resultado
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'bars' AND relnamespace = 'public'::regnamespace;

SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'bars' AND schemaname = 'public'
ORDER BY policyname;


-- ============================================================
--  PRE-REQUISITO: a coluna id da tabela bars deve ser o auth.uid() do bar.
--  Garanta que ao criar o bar o id enviado e o uid do usuario autenticado.
-- ============================================================
