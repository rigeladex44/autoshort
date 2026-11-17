-- ==========================================================
-- AUTOSHORT: DATABASE SCHEMA FOR SUPABASE (POSTGRESQL)
-- Run this script in your Supabase SQL Editor to enable Cloud Sync
-- ==========================================================

-- 1. Create table for short links
CREATE TABLE IF NOT EXISTS public.links (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  destination_url TEXT NOT NULL,
  title TEXT,
  tags TEXT[] DEFAULT '{}',
  password TEXT DEFAULT NULL,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  clicks BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_clicked_at TIMESTAMPTZ DEFAULT NULL
);

-- 2. Create table for clicks / analytics
CREATE TABLE IF NOT EXISTS public.clicks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id TEXT REFERENCES public.links(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  referer TEXT DEFAULT 'Direct',
  country TEXT DEFAULT 'Unknown',
  city TEXT DEFAULT 'Unknown',
  user_agent TEXT,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for maximum query performance
CREATE INDEX IF NOT EXISTS idx_links_slug ON public.links(slug);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON public.links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON public.clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_slug ON public.clicks(slug);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON public.clicks(clicked_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clicks ENABLE ROW LEVEL SECURITY;

-- Upgrade existing installations (idempotent), including the earlier text-ID schema.
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
ALTER TABLE public.clicks ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Unknown';
ALTER TABLE public.clicks ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Unknown';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='clicks' AND column_name='id' AND data_type='text' AND column_default IS NULL) THEN
    CREATE SEQUENCE IF NOT EXISTS public.clicks_id_seq;
    ALTER TABLE public.clicks ALTER COLUMN id SET DEFAULT ('cloud-' || nextval('public.clicks_id_seq')::text);
  END IF;
END $$;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS og_title TEXT;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS og_description TEXT;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS og_image TEXT;
ALTER TABLE public.clicks ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE public.clicks ADD COLUMN IF NOT EXISTS is_qr BOOLEAN DEFAULT FALSE;

-- Only the server's service-role credential may manage links or read analytics.
DROP POLICY IF EXISTS "Allow anon all on links" ON public.links;
DROP POLICY IF EXISTS "Allow anon all on clicks" ON public.clicks;
DROP POLICY IF EXISTS "Allow all links access" ON public.links;
DROP POLICY IF EXISTS "Allow all clicks access" ON public.clicks;
REVOKE ALL ON public.links, public.clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.links, public.clicks TO service_role;
DO $$ BEGIN
  IF to_regclass('public.clicks_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.clicks_id_seq TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_click(
  p_link_id TEXT, p_visitor_id TEXT, p_is_qr BOOLEAN, p_referer TEXT,
  p_country TEXT, p_city TEXT, p_user_agent TEXT
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_slug TEXT;
BEGIN
  UPDATE public.links SET clicks = COALESCE(clicks, 0) + 1, last_clicked_at = NOW()
    WHERE id = p_link_id AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW()) RETURNING slug INTO v_slug;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Link unavailable'; END IF;
  INSERT INTO public.clicks(link_id, slug, visitor_id, is_qr, referer, country, city, user_agent)
    VALUES(p_link_id, v_slug, p_visitor_id, p_is_qr, p_referer, p_country, p_city, p_user_agent);
END;
$$;
REVOKE ALL ON FUNCTION public.record_click(TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_click(TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT) TO service_role;
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY CHECK (key = 'custom_domain'),
  value TEXT NOT NULL
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO service_role;
NOTIFY pgrst, 'reload schema';

-- Integration credentials are encrypted by the server; no browser/database anon access.
CREATE TABLE IF NOT EXISTS public.domain_credentials (
  id TEXT PRIMARY KEY CHECK (id = 'vercel'),
  encrypted_token TEXT NOT NULL
);
ALTER TABLE public.domain_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domain_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_credentials TO service_role;
NOTIFY pgrst, 'reload schema';
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

BEGIN;
-- Metadata only: message content remains in the email provider, scoped by inbox.
CREATE TABLE IF NOT EXISTS public.email_domains (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 domain TEXT NOT NULL UNIQUE,
 provider_id TEXT UNIQUE,
 sending_ready BOOLEAN NOT NULL DEFAULT FALSE,
 receiving_ready BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS public.email_mailboxes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES auth.users(id),
 domain_id UUID NOT NULL,
 address TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL DEFAULT '',
 provider_id TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(domain_id,user_id) REFERENCES public.email_domains(id,user_id),
 UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS public.email_send_requests (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL,
 mailbox_id UUID NOT NULL,
 payload_hash TEXT NOT NULL,
 provider_message_id TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(mailbox_id,user_id) REFERENCES public.email_mailboxes(id,user_id)
);
CREATE INDEX IF NOT EXISTS email_domains_owner ON public.email_domains(user_id);
CREATE INDEX IF NOT EXISTS email_mailboxes_owner ON public.email_mailboxes(user_id);
CREATE INDEX IF NOT EXISTS email_send_quota ON public.email_send_requests(user_id,created_at);
ALTER TABLE public.email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_domains,public.email_mailboxes,public.email_send_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.email_domains,public.email_mailboxes TO authenticated;
GRANT ALL ON public.email_domains,public.email_mailboxes,public.email_send_requests TO service_role;
DROP POLICY IF EXISTS email_domains_owner ON public.email_domains;
CREATE POLICY email_domains_owner ON public.email_domains FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS email_mailboxes_owner ON public.email_mailboxes;
CREATE POLICY email_mailboxes_owner ON public.email_mailboxes FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE OR REPLACE FUNCTION public.reserve_email_domain(p_user UUID,p_domain TEXT) RETURNS public.email_domains
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.email_domains;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,412));
 SELECT * INTO result FROM email_domains WHERE domain=p_domain;
 IF FOUND THEN
  IF result.user_id<>p_user THEN RAISE EXCEPTION 'domain_unavailable'; END IF;
  RETURN result;
 END IF;
 IF (SELECT count(*) FROM email_domains WHERE user_id=p_user)>=3 THEN RAISE EXCEPTION 'domain_limit'; END IF;
 INSERT INTO email_domains(user_id,domain) VALUES(p_user,p_domain) RETURNING * INTO result;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.reserve_email_mailbox(p_user UUID,p_domain UUID,p_address TEXT,p_name TEXT) RETURNS public.email_mailboxes
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.email_mailboxes;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,412));
 IF NOT EXISTS(SELECT 1 FROM email_domains WHERE id=p_domain AND user_id=p_user AND sending_ready AND receiving_ready) THEN RAISE EXCEPTION 'domain_not_ready'; END IF;
 SELECT * INTO result FROM email_mailboxes WHERE address=p_address;
 IF FOUND THEN
  IF result.user_id<>p_user THEN RAISE EXCEPTION 'mailbox_unavailable'; END IF;
  RETURN result;
 END IF;
 IF (SELECT count(*) FROM email_mailboxes WHERE user_id=p_user)>=10 THEN RAISE EXCEPTION 'mailbox_limit'; END IF;
 INSERT INTO email_mailboxes(user_id,domain_id,address,display_name) VALUES(p_user,p_domain,p_address,p_name) RETURNING * INTO result;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.reserve_email_send(p_user UUID,p_mailbox UUID,p_request UUID,p_hash TEXT) RETURNS public.email_send_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.email_send_requests;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,412));
 IF NOT EXISTS(SELECT 1 FROM email_mailboxes WHERE id=p_mailbox AND user_id=p_user AND provider_id IS NOT NULL) THEN RAISE EXCEPTION 'mailbox_unavailable'; END IF;
 SELECT * INTO result FROM email_send_requests WHERE id=p_request;
 IF FOUND THEN
  IF result.user_id<>p_user OR result.mailbox_id<>p_mailbox OR result.payload_hash<>p_hash THEN RAISE EXCEPTION 'request_conflict'; END IF;
  IF result.state='pending' AND result.created_at<now()-interval '23 hours' THEN RAISE EXCEPTION 'request_expired'; END IF;
  RETURN result;
 END IF;
 IF (SELECT count(*) FROM email_send_requests WHERE user_id=p_user AND created_at>now()-interval '24 hours')>=100 THEN RAISE EXCEPTION 'send_limit'; END IF;
 INSERT INTO email_send_requests(id,user_id,mailbox_id,payload_hash) VALUES(p_request,p_user,p_mailbox,p_hash) RETURNING * INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_email_domain(UUID,TEXT),public.reserve_email_mailbox(UUID,UUID,TEXT,TEXT),public.reserve_email_send(UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_domain(UUID,TEXT),public.reserve_email_mailbox(UUID,UUID,TEXT,TEXT),public.reserve_email_send(UUID,UUID,UUID,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
