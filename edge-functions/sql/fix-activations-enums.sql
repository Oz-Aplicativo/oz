-- ============================================================
--  OZ App — Diagnóstico e correção dos enums da tabela activations
--  Execute no Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1. Lista todos os enums usados na tabela activations
SELECT
  c.column_name,
  c.udt_name        AS enum_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_name   = 'activations'
  AND c.table_schema = 'public'
ORDER BY c.ordinal_position;

-- 2. Lista os valores atuais de TODOS os enums da tabela
SELECT
  t.typname   AS enum_name,
  e.enumlabel AS valor
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN (
  SELECT udt_name
  FROM information_schema.columns
  WHERE table_name = 'activations' AND table_schema = 'public'
)
ORDER BY t.typname, e.enumsortorder;

-- 3. Adiciona os valores que podem estar faltando nos enums
--    (IF NOT EXISTS é seguro — não quebra se já existir)

-- Status
ALTER TYPE activation_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE activation_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE activation_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE activation_status ADD VALUE IF NOT EXISTS 'failed';

-- Type  (nomes usados pela edge function criar-transacao)
ALTER TYPE activation_type ADD VALUE IF NOT EXISTS 'individual';
ALTER TYPE activation_type ADD VALUE IF NOT EXISTS 'night_link';
ALTER TYPE activation_type ADD VALUE IF NOT EXISTS 'free_used';
ALTER TYPE activation_type ADD VALUE IF NOT EXISTS 'night_checkin';
ALTER TYPE activation_type ADD VALUE IF NOT EXISTS 'free_credit';

-- 4. Confirma resultado final
SELECT
  t.typname   AS enum_name,
  e.enumlabel AS valor
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('activation_status', 'activation_type')
ORDER BY t.typname, e.enumsortorder;
