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

-- 5. Policies allowing anon key access (or service role)
DROP POLICY IF EXISTS "Allow anon all on links" ON public.links;
CREATE POLICY "Allow anon all on links" ON public.links
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on clicks" ON public.clicks;
CREATE POLICY "Allow anon all on clicks" ON public.clicks
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);
