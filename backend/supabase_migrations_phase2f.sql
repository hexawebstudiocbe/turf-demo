-- ============================================================
-- TURFBOOK - PHASE 2F
-- ADMIN AUTHENTICATION MIGRATION
-- ============================================================

-- Existing admin_users currently has:
-- id, name, email, password_hash, active, created_at, updated_at
--
-- This migration changes:
-- active -> is_active
-- adds role
-- adds last_login_at
-- creates admin authentication RPCs


-- ============================================================
-- 1. RENAME active -> is_active
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admin_users'
          AND column_name = 'active'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admin_users'
          AND column_name = 'is_active'
    )
    THEN
        ALTER TABLE public.admin_users
            RENAME COLUMN active TO is_active;
    END IF;
END
$$;


-- ============================================================
-- 2. ADD ADMIN ROLE
-- ============================================================

ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'ADMIN';


-- ============================================================
-- 3. ADD LAST LOGIN TIMESTAMP
-- ============================================================

ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS last_login_at timestamptz;


-- ============================================================
-- 4. ROLE VALIDATION
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'admin_users_role_check'
          AND conrelid = 'public.admin_users'::regclass
    )
    THEN
        ALTER TABLE public.admin_users
            ADD CONSTRAINT admin_users_role_check
            CHECK (role IN ('ADMIN', 'SUPER_ADMIN'));
    END IF;
END
$$;


-- ============================================================
-- 5. EMAIL INDEX
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
    admin_users_email_lower_unique_idx
ON public.admin_users (lower(email));


-- ============================================================
-- 6. UPDATED_AT TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS trg_admin_users_updated_at
ON public.admin_users;

CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 7. ADMIN LOGIN RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_for_login(
    p_email text
)
RETURNS TABLE (
    id uuid,
    name text,
    email text,
    password_hash text,
    role text,
    is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        a.id,
        a.name,
        a.email,
        a.password_hash,
        a.role,
        a.is_active
    FROM public.admin_users a
    WHERE lower(a.email) = lower(trim(p_email))
      AND a.is_active = true
    LIMIT 1;
$$;


-- ============================================================
-- 8. RECORD ADMIN LOGIN RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_admin_login(
    p_admin_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.admin_users
    SET
        last_login_at = now(),
        updated_at = now()
    WHERE id = p_admin_id;
$$;


-- ============================================================
-- 9. FUNCTION SECURITY
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_admin_for_login(text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.get_admin_for_login(text)
TO service_role;


REVOKE ALL
ON FUNCTION public.record_admin_login(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.record_admin_login(uuid)
TO service_role;


-- ============================================================
-- 10. ENABLE RLS
-- ============================================================

ALTER TABLE public.admin_users
    ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 11. RELOAD POSTGREST SCHEMA
-- ============================================================

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- DONE
-- ============================================================

SELECT
    'Phase 2F admin authentication migration completed'
    AS result;
