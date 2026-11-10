import { configured, db, fail } from '../lib/db.js';
// Vercel Serverless Function: Image Serving Endpoint for Uploaded Thumbnails
// Serves image binaries directly so WhatsApp, Telegram & Facebook scrapers can fetch them

export default async function handler(req, res) {
  const { slug, id } = req.query;

  if (!slug && !id) {
    return res.status(400).send('Slug or ID is required');
  }

  const cleanSlug = String(slug || '').trim();
  let link = null;
  if (configured()) {
    try {
      const query = id ? `id=eq.${encodeURIComponent(id)}` : `slug=eq.${encodeURIComponent(cleanSlug)}`;
      link = (await db(`links?${query}&select=og_image&limit=1`))?.[0];
    } catch (error) { return fail(res, error); }
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
      <text x="50%" y="46%" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle">AutoShort</text>
      <text x="50%" y="58%" font-family="system-ui, -apple-system, sans-serif" font-size="32" fill="#06b6d4" text-anchor="middle">/${escapeXml(cleanSlug)}</text>
    </svg>`);
  }

  // If it's a Base64 Data URL (uploaded from device)
  if (/^data:image\/(png|jpeg|webp);base64,/.test(rawImage)) {
    const matches = rawImage.match(/^data:(image\/[a-zA-Z0-9-+.]+);base64,(.+)$/);
    if (matches) {
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Content-Length', buffer.length);
      return res.end(buffer);
    }
  }

  // If it's a standard HTTP/HTTPS URL, redirect directly to it
  if (/^https?:\/\//i.test(rawImage)) {
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
