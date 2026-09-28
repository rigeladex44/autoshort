// Vercel Serverless Function: Analytics API
// Aggregates clicks, referrers, geographic data, and device types

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug, link_id } = req.query;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      let query = `${supabaseUrl}/rest/v1/clicks?select=*&order=clicked_at.desc&limit=500`;
      if (link_id) query += `&link_id=eq.${link_id}`;
      else if (slug) query += `&slug=eq.${encodeURIComponent(slug)}`;

      const response = await fetch(query, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch analytics from Supabase' });
      }

      const clicks = await response.json();

      // Aggregate statistics
      const referrers = {};
      const countries = {};
      const dates = {};
      const devices = { Mobile: 0, Desktop: 0, Tablet: 0, Other: 0 };

      clicks.forEach(c => {
        // Referrer
        let ref = c.referer || 'Direct';
        try {
          if (ref.startsWith('http')) {
            ref = new URL(ref).hostname.replace('www.', '');
          }
        } catch {}
        referrers[ref] = (referrers[ref] || 0) + 1;

        // Country
        const country = c.country || 'Unknown';
        countries[country] = (countries[country] || 0) + 1;

        // Date (YYYY-MM-DD)
        const date = c.clicked_at ? c.clicked_at.substring(0, 10) : 'Unknown';
        dates[date] = (dates[date] || 0) + 1;

        // Device
        const ua = (c.user_agent || '').toLowerCase();
        if (/tablet|ipad/i.test(ua)) devices.Tablet++;
        else if (/mobile|iphone|android/i.test(ua)) devices.Mobile++;
        else if (/windows|macintosh|linux/i.test(ua)) devices.Desktop++;
        else devices.Other++;
      });

      return res.status(200).json({
        totalClicks: clicks.length,
        referrers,
        countries,
        dates,
        devices,
        recentClicks: clicks.slice(0, 20)
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Local / Zero-config mode
  return res.status(200).json({
    mode: 'local',
    message: 'Using local analytics storage. Pass cloud credentials in Vercel to aggregate server clicks.'
  });
}
