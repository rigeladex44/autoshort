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
