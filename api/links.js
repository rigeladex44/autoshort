// Vercel Serverless Function: Links CRUD with Social Preview Meta

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL || 'https://miipmgzjxpyokchrctdj.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paXBtZ3pqeHB5b2tjaHJjdGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjYyMjMsImV4cCI6MjEwNjE0MjIyM30.SfEbfXimbA7VTZrRYzgJLezH6fv64QWR6yYuHnbHUMQ';
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  const isSupabase = Boolean(supabaseUrl && supabaseKey);
  const isUpstash = Boolean(upstashUrl && upstashToken);

  // GET: Fetch links
  if (req.method === 'GET') {
    if (isSupabase) {
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/links?select=*&order=created_at.desc`, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        if (response.ok) {
          const links = await response.json();
          return res.status(200).json({ configured: true, backend: 'supabase', links });
        }
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    return res.status(200).json({ configured: false, backend: 'local', links: [] });
  }

  // POST: Create Link
  if (req.method === 'POST') {
    const { destination_url, slug, title, og_title, og_description, og_image } = req.body || {};

    if (!destination_url) {
      return res.status(400).json({ error: 'URL tujuan wajib diisi' });
    }

    let validUrl = destination_url.trim();
    if (!/^https?:\/\//i.test(validUrl)) validUrl = 'https://' + validUrl;

    const finalSlug = (slug || Math.random().toString(36).substring(2, 8)).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    const linkRecord = {
      id: 'link_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      slug: finalSlug,
      destination_url: validUrl,
      title: (title || og_title || finalSlug).trim(),
      og_title: og_title ? og_title.trim() : null,
      og_description: og_description ? og_description.trim() : null,
      og_image: og_image ? og_image.trim() : null,
      is_active: true,
      clicks: 0,
      created_at: new Date().toISOString()
    };

    if (isSupabase) {
      try {
        const insertResp = await fetch(`${supabaseUrl}/rest/v1/links`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(linkRecord)
        });
        if (insertResp.ok) {
          const created = await insertResp.json();
          return res.status(201).json({ success: true, link: created[0] });
        }
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(201).json({ success: true, mode: 'local', link: linkRecord });
  }

  // PATCH: Update link & OG Preview
  if (req.method === 'PATCH') {
    const { id, slug, ...updates } = req.body || {};
    if (isSupabase && id) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/links?id=eq.${id}`, {
          method: 'PATCH',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    return res.status(200).json({ success: true, updates });
  }

  // DELETE
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (isSupabase && id) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/links?id=eq.${id}`, {
          method: 'DELETE',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
      } catch (e) {}
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
