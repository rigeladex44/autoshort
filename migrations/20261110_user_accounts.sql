-- User ownership is enforced by RLS even for direct REST requests.
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE public.links ALTER COLUMN user_id SET DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_links_owner ON public.links(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.links TO authenticated;
GRANT SELECT ON public.clicks TO authenticated;
DROP POLICY IF EXISTS links_owner_select ON public.links;
DROP POLICY IF EXISTS links_owner_insert ON public.links;
DROP POLICY IF EXISTS links_owner_update ON public.links;
DROP POLICY IF EXISTS links_owner_delete ON public.links;
DROP POLICY IF EXISTS clicks_owner_select ON public.clicks;
CREATE POLICY links_owner_select ON public.links FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY links_owner_insert ON public.links FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
CREATE POLICY links_owner_update ON public.links FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY links_owner_delete ON public.links FOR DELETE TO authenticated USING (user_id=auth.uid());
CREATE POLICY clicks_owner_select ON public.clicks FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.links WHERE links.id=clicks.link_id AND links.user_id=auth.uid()));
CREATE TABLE IF NOT EXISTS public.user_domains (
 domain TEXT PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 verified BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_domains_owner ON public.user_domains(user_id);
ALTER TABLE public.user_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_domains FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_domains TO authenticated;
GRANT ALL ON public.user_domains TO service_role;
DROP POLICY IF EXISTS domains_owner_select ON public.user_domains;
CREATE POLICY domains_owner_select ON public.user_domains FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE TABLE IF NOT EXISTS public.user_settings (
 user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 custom_domain TEXT
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
DROP POLICY IF EXISTS settings_owner_select ON public.user_settings;
DROP POLICY IF EXISTS settings_owner_insert ON public.user_settings;
DROP POLICY IF EXISTS settings_owner_update ON public.user_settings;
DROP POLICY IF EXISTS settings_owner_delete ON public.user_settings;
CREATE POLICY settings_owner_select ON public.user_settings FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY settings_owner_insert ON public.user_settings FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND (custom_domain IS NULL OR EXISTS(SELECT 1 FROM public.user_domains d WHERE d.domain=custom_domain AND d.user_id=auth.uid() AND d.verified)));
CREATE POLICY settings_owner_update ON public.user_settings FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND (custom_domain IS NULL OR EXISTS(SELECT 1 FROM public.user_domains d WHERE d.domain=custom_domain AND d.user_id=auth.uid() AND d.verified)));
CREATE POLICY settings_owner_delete ON public.user_settings FOR DELETE TO authenticated USING(user_id=auth.uid());
NOTIFY pgrst, 'reload schema';
