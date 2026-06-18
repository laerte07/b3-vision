
-- 1. Profiles: rebind policies to authenticated role
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 2. admin_activity_logs: explicit deny-all policy for clients (service_role bypasses RLS)
CREATE POLICY "No client access to admin logs"
  ON public.admin_activity_logs FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- 3. handle_new_user is a trigger function; revoke EXECUTE from API roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
