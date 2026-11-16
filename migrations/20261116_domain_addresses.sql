-- Preserve every shared hostname and each link's published address.
CREATE TABLE IF NOT EXISTS public.shared_domains (
 domain TEXT PRIMARY KEY,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shared_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_domains FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.shared_domains TO service_role;
INSERT INTO public.shared_domains(domain) SELECT lower(value) FROM public.app_settings WHERE key='custom_domain' AND value<>'' ON CONFLICT DO NOTHING;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS short_domain TEXT;
CREATE INDEX IF NOT EXISTS idx_links_short_domain ON public.links(short_domain);
CREATE OR REPLACE FUNCTION public.set_shared_domain(p_domain TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(741912);
 INSERT INTO public.shared_domains(domain) SELECT lower(value) FROM public.app_settings WHERE key='custom_domain' AND value<>'' ON CONFLICT DO NOTHING;
 INSERT INTO public.shared_domains(domain) VALUES(lower(p_domain)) ON CONFLICT DO NOTHING;
 INSERT INTO public.app_settings(key,value) VALUES('custom_domain',lower(p_domain)) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
END; $$;
REVOKE ALL ON FUNCTION public.set_shared_domain(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_shared_domain(TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.check_link_domain() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role()='authenticated' THEN
  IF TG_OP='INSERT' AND NEW.short_domain IS NULL THEN
   SELECT coalesce((SELECT s.custom_domain FROM public.user_settings s JOIN public.user_domains d ON d.domain=s.custom_domain AND d.user_id=s.user_id AND d.verified WHERE s.user_id=auth.uid()),(SELECT value FROM public.app_settings WHERE key='custom_domain')) INTO NEW.short_domain;
  END IF;
  IF TG_OP='UPDATE' AND OLD.short_domain IS DISTINCT FROM NEW.short_domain THEN
   RAISE EXCEPTION 'Published link domain cannot be changed';
  END IF;
  IF TG_OP='INSERT' AND (NEW.short_domain IS NULL OR NOT (
    EXISTS(SELECT 1 FROM public.shared_domains WHERE domain=NEW.short_domain)
    OR EXISTS(SELECT 1 FROM public.user_domains WHERE domain=NEW.short_domain AND user_id=auth.uid() AND verified)
  )) THEN RAISE EXCEPTION 'Domain is not available to this user'; END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.check_link_domain() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS links_check_domain ON public.links;
CREATE TRIGGER links_check_domain BEFORE INSERT OR UPDATE ON public.links FOR EACH ROW EXECUTE FUNCTION public.check_link_domain();
