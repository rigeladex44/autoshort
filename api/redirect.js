// Vercel Serverless Function: Redirect Engine with Social Media Preview Support
// (WhatsApp, Telegram, Facebook, Twitter/X, Discord Open Graph cards)

function isSocialBot(userAgent) {
  const ua = (userAgent || '').toLowerCase();
  return (
    ua.includes('whatsapp') ||
    ua.includes('facebookexternalhit') ||
    ua.includes('facebot') ||
    ua.includes('telegrambot') ||
    ua.includes('twitterbot') ||
    ua.includes('linkedinbot') ||
    ua.includes('discordbot') ||
    ua.includes('slackbot') ||
    ua.includes('pinterest') ||
    ua.includes('googlebot')
  );
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug) {
    res.writeHead(302, { Location: '/' });
    return res.end();
  }

  const cleanSlug = String(slug).trim().toLowerCase();
  const userAgent = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || req.headers['referrer'] || 'Direct';
  const country = req.headers['x-vercel-ip-country'] || 'Unknown';
  const city = req.headers['x-vercel-ip-city'] || 'Unknown';

  const supabaseUrl = process.env.SUPABASE_URL || 'https://miipmgzjxpyokchrctdj.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paXBtZ3pqeHB5b2tjaHJjdGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjYyMjMsImV4cCI6MjEwNjE0MjIyM30.SfEbfXimbA7VTZrRYzgJLezH6fv64QWR6yYuHnbHUMQ';
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  let link = null;

  // 1. Check Supabase
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/links?slug=eq.${encodeURIComponent(cleanSlug)}&select=*`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      if (response.ok) {
        const links = await response.json();
        if (links && links.length > 0) link = links[0];
      }
    } catch (e) {
      console.error('Supabase lookup error:', e);
    }
  }

  // 2. Check Upstash Redis
  if (!link && upstashUrl && upstashToken) {
    try {
      const upstashResp = await fetch(`${upstashUrl}/get/link:${encodeURIComponent(cleanSlug)}`, {
        headers: { Authorization: `Bearer ${upstashToken}` }
      });
      const data = await upstashResp.json();
      if (data && data.result) {
        link = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      }
    } catch (e) {
      console.error('Upstash lookup error:', e);
    }
  }

  // If link found from cloud DB
  if (link && link.destination_url) {
    // Check if paused
    if (link.is_active === false) {
      res.writeHead(302, { Location: `/redirect.html?slug=${encodeURIComponent(cleanSlug)}&paused=true` });
      return res.end();
    }

    // Log click if not a crawler bot
    if (!isSocialBot(userAgent)) {
      if (supabaseUrl && supabaseKey && link.id) {
        fetch(`${supabaseUrl}/rest/v1/links?id=eq.${link.id}`, {
          method: 'PATCH',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clicks: (link.clicks || 0) + 1, last_clicked_at: new Date().toISOString() })
        }).catch(console.error);

        fetch(`${supabaseUrl}/rest/v1/clicks`, {
          method: 'POST',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link_id: link.id,
            slug: cleanSlug,
            referer: referer,
            country: country,
            city: city,
            user_agent: userAgent,
            clicked_at: new Date().toISOString()
          })
        }).catch(console.error);
      } else if (upstashUrl && upstashToken) {
        fetch(`${upstashUrl}/incr/clicks:${encodeURIComponent(cleanSlug)}`, {
          headers: { Authorization: `Bearer ${upstashToken}` }
        }).catch(console.error);
      }
    }

    // Check if social preview metadata exists (or if request is from WhatsApp/Telegram bot)
    const previewTitle = link.og_title || link.title || cleanSlug;
    const host = process.env.CUSTOM_DOMAIN || req.headers['host'] || 'rigeel.id';
    const shortUrl = `https://${host}/${cleanSlug}`;

    let previewImageUrl = link.og_image || '';
    if (previewImageUrl.startsWith('data:image/')) {
      previewImageUrl = `https://${host}/api/image?slug=${encodeURIComponent(cleanSlug)}`;
    }

    // If social bot or has custom preview, return HTML with OG tags
    if (isSocialBot(userAgent) || previewImageUrl || link.og_title) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(previewTitle)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Open Graph / WhatsApp / Facebook Preview -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(shortUrl)}">
  <meta property="og:title" content="${escapeHtml(previewTitle)}">
  <meta property="og:description" content="${escapeHtml(previewDesc)}">
  ${previewImageUrl ? `<meta property="og:image" content="${escapeHtml(previewImageUrl)}">` : ''}

  <!-- Twitter Preview -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(previewTitle)}">
  <meta name="twitter:description" content="${escapeHtml(previewDesc)}">
  ${previewImageUrl ? `<meta name="twitter:image" content="${escapeHtml(previewImageUrl)}">` : ''}

  <!-- Automatic Redirect for Human Browsers -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(link.destination_url)}">
</head>
<body style="font-family:sans-serif; background:#090d16; color:#fff; text-align:center; padding:50px 20px;">
  <p>Mengalihkan Anda ke <a href="${escapeHtml(link.destination_url)}" style="color:#38bdf8;">${escapeHtml(link.destination_url)}</a>...</p>
  <script>window.location.replace(${JSON.stringify(link.destination_url)});</script>
</body>
</html>`);
    }

    // Direct HTTP 307 Redirect for normal humans
    res.writeHead(307, {
      Location: link.destination_url,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    return res.end();
  }

  // 3. Fallback to client-side redirect page (for Local Storage / Zero-Config mode)
  res.writeHead(302, {
    Location: `/redirect.html?slug=${encodeURIComponent(cleanSlug)}`
  });
  return res.end();
}
