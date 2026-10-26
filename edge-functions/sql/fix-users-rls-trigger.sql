-- ============================================================
--  OZ App -- Fix: RLS da tabela users + timestamps
--  Execute no Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Garante que colunas de timestamp existem
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Remove NOT NULL do campo password
--    (a senha fica no Supabase Auth, nao na tabela users)
ALTER TABLE public.users
  ALTER COLUMN password DROP NOT NULL;

-- 3. Politica RLS: permite INSERT quando id = auth.uid()
--    (o proprio usuario cria seu registro logo apos o signup)
DROP POLICY IF EXISTS "user_insert_own" ON public.users;
CREATE POLICY "user_insert_own"
  ON public.users
  FOR INSERT
  WITH CHECK (id = auth.uid()::text);

-- 4. Politica RLS: permite SELECT do proprio registro
DROP POLICY IF EXISTS "user_select_own" ON public.users;
CREATE POLICY "user_select_own"
  ON public.users
  FOR SELECT
  USING (id = auth.uid()::text);

-- 5. Politica RLS: permite UPDATE do proprio registro
DROP POLICY IF EXISTS "user_update_own" ON public.users;
CREATE POLICY "user_update_own"
  ON public.users
  FOR UPDATE
  USING (id = auth.uid()::text);

-- 6. Admin tem acesso total
DROP POLICY IF EXISTS "admin_full_access" ON public.users;
CREATE POLICY "admin_full_access"
  ON public.users
  FOR ALL
  USING (auth.jwt() ->> 'email' = 'admin@oz.com');

-- ============================================================
-- IMPORTANTE: Se ainda receber erro 400 no INSERT de users,
-- rode o bloco abaixo para verificar as constraints existentes:
-- ============================================================
-- SELECT conname, consrc
-- FROM pg_constraint
-- WHERE conrelid = 'public.users'::regclass
--   AND contype = 'c';
