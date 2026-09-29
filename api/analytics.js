// Vercel Serverless Function: Analytics API
// Aggregates clicks, referrers, geographic data, and device types

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL || 'https://miipmgzjxpyokchrctdj.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paXBtZ3pqeHB5b2tjaHJjdGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjYyMjMsImV4cCI6MjEwNjE0MjIyM30.SfEbfXimbA7VTZrRYzgJLezH6fv64QWR6yYuHnbHUMQ';

  // Support POST to log real-time clicks from client
  if (req.method === 'POST') {
    const { slug, link_id, visitor_id, is_qr, referer, country, city, user_agent } = req.body || {};
    if (supabaseUrl && supabaseKey) {
      try {
        await fetch(`${supabaseUrl}/rest/v1/clicks`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            slug: slug || 'unknown',
            link_id: link_id || null,
            visitor_id: visitor_id || 'anon',
            is_qr: Boolean(is_qr),
            referer: referer || 'Direct',
            country: country || 'Unknown',
            city: city || 'Unknown',
            user_agent: user_agent || req.headers['user-agent'] || '',
            clicked_at: new Date().toISOString()
          })
        });
        return res.status(200).json({ success: true, message: 'Click logged' });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    return res.status(200).json({ success: true, mode: 'local' });
  }

  const { slug, link_id } = req.query;

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
      const dailyBreakdown = {};
      const uniqueVisitorSet = new Set();
      let qrVisitorsCount = 0;
      const devices = { Mobile: 0, Desktop: 0, Tablet: 0, Other: 0 };

      clicks.forEach(c => {
        // Unique visitor identification
        const vId = c.visitor_id || (c.user_agent ? c.user_agent + (c.country || '') : ('anon_' + Math.random()));
        uniqueVisitorSet.add(vId);

        // QR Visitor
        if (c.is_qr || (c.referer && c.referer.toLowerCase().includes('qr'))) {
          qrVisitorsCount++;
        }

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

        if (!dailyBreakdown[date]) {
          dailyBreakdown[date] = { date, visitors: 0, uniqueVisitors: 0, qrVisitors: 0, vSet: new Set() };
        }
        dailyBreakdown[date].visitors++;
        if (!dailyBreakdown[date].vSet.has(vId)) {
          dailyBreakdown[date].vSet.add(vId);
          dailyBreakdown[date].uniqueVisitors++;
        }
        if (c.is_qr || (c.referer && c.referer.toLowerCase().includes('qr'))) {
          dailyBreakdown[date].qrVisitors++;
        }

        // Device
        const ua = (c.user_agent || '').toLowerCase();
        if (/tablet|ipad/i.test(ua)) devices.Tablet++;
        else if (/mobile|iphone|android/i.test(ua)) devices.Mobile++;
        else if (/windows|macintosh|linux/i.test(ua)) devices.Desktop++;
        else devices.Other++;
      });

      // Clean daily breakdown (remove Set)
      const dailyList = Object.keys(dailyBreakdown).sort().map(d => ({
        date: d,
        visitors: dailyBreakdown[d].visitors,
        uniqueVisitors: dailyBreakdown[d].uniqueVisitors,
        qrVisitors: dailyBreakdown[d].qrVisitors
      }));

      return res.status(200).json({
        totalClicks: clicks.length,
        visitors: clicks.length,
        uniqueVisitors: uniqueVisitorSet.size,
        qrVisitors: qrVisitorsCount,
        referrers,
        countries,
        dates,
        dailyList,
        devices,
        recentClicks: clicks.slice(0, 50)
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
