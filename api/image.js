// Vercel Serverless Function: Image Serving Endpoint for Uploaded Thumbnails
// Serves image binaries directly so WhatsApp, Telegram & Facebook scrapers can fetch them

export default async function handler(req, res) {
  const { slug, id } = req.query;

  if (!slug && !id) {
    return res.status(400).send('Slug or ID is required');
  }

  const cleanSlug = String(slug || '').trim().toLowerCase();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  let link = null;

  // 1. Try Supabase
  if (supabaseUrl && supabaseKey) {
    try {
      const q = id ? `id=eq.${id}` : `slug=eq.${encodeURIComponent(cleanSlug)}`;
      const response = await fetch(`${supabaseUrl}/rest/v1/links?${q}&select=*`, {
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
      console.error('Supabase image lookup error:', e);
    }
  }

  // 2. Try Upstash Redis
  if (!link && upstashUrl && upstashToken && cleanSlug) {
    try {
      const upstashResp = await fetch(`${upstashUrl}/get/link:${encodeURIComponent(cleanSlug)}`, {
        headers: { Authorization: `Bearer ${upstashToken}` }
      });
      const data = await upstashResp.json();
      if (data && data.result) {
        link = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      }
    } catch (e) {
      console.error('Upstash image lookup error:', e);
    }
  }

  const rawImage = link ? link.og_image : null;

  if (!rawImage) {
    // Return a default branded SVG banner
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090d16"/>
          <stop offset="100%" stop-color="#1e1b4b"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <text x="50%" y="46%" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">rigeel.id</text>
      <text x="50%" y="58%" font-family="system-ui, -apple-system, sans-serif" font-size="32" fill="#06b6d4" text-anchor="middle">/${escapeXml(cleanSlug)}</text>
    </svg>`);
  }

  // If it's a Base64 Data URL (uploaded from device)
  if (rawImage.startsWith('data:image/')) {
    const matches = rawImage.match(/^data:(image\/[a-zA-Z0-9-+.]+);base64,(.+)$/);
    if (matches) {
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, immutable');
      res.setHeader('Content-Length', buffer.length);
      return res.end(buffer);
    }
  }

  // If it's a standard HTTP/HTTPS URL, redirect directly to it
  if (rawImage.startsWith('http')) {
    res.writeHead(302, {
      Location: rawImage,
      'Cache-Control': 'public, max-age=86400'
    });
    return res.end();
  }

  return res.status(404).send('Image format not supported');
}

function escapeXml(unsafe) {
  return String(unsafe || '').replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
