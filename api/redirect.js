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

import { savedDomain } from '../lib/domains.js';
import { configured, findLink, recordClick, fail, verifyPassword } from '../lib/db.js';
import { normalizeSlug, normalizeUrl, linkState } from '../lib/validation.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'HEAD'].includes(req.method)) return res.status(405).end();
  try {
    let cleanSlug;
    try { cleanSlug = normalizeSlug(req.query.slug); } catch { return res.status(400).send('Slug tidak valid.'); }
    const fallback = (flag = '') => { res.writeHead(302, { Location: `/redirect.html?slug=${encodeURIComponent(cleanSlug)}${req.query.src === 'qr' ? '&src=qr' : ''}${flag}` }); return res.end(); };
    if (!configured()) return fallback();
    const link = await findLink(cleanSlug,req.headers.host);
    if (!link) return fallback('&missing=true');
    const state = linkState(link);
    if (state === 'paused' || state === 'expired') return fallback(`&${state}=true`);
    if (state === 'protected' && req.method !== 'POST') return fallback('&protected=true');
    if (state === 'protected' && !verifyPassword(req.body?.password, link.password)) return res.status(403).json({ error: 'Kata sandi salah.' });
    const userAgent = req.headers['user-agent'] || '';
    const destination = normalizeUrl(link.destination_url);
    link.destination_url = destination;
    if (!isSocialBot(userAgent) && req.method !== 'HEAD') {
      try { await recordClick(req, link); } catch { console.error('Click tracking failed for link', link.id); }
    }
    if (req.method === 'POST') return res.status(200).json({ destination_url: destination });
      // Check if social preview metadata exists
      const previewTitle = link.og_title || link.title || cleanSlug;
      const previewDesc = link.og_description || '';
      const host = (req.headers['host']).replace(/^https?:\/\//, '').replace(/\/$/, '');
      const shortUrl = `https://${host}/${cleanSlug}`;

      let previewImageUrl = link.og_image || '';
      if (previewImageUrl.startsWith('data:image/')) {
        previewImageUrl = `https://${host}/api/image?slug=${encodeURIComponent(cleanSlug)}`;
      }

      // If social bot (WhatsApp, Telegram, Facebook, etc.), return HTML with OpenGraph tags
      if (isSocialBot(userAgent)) {
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

  <!-- Automatic Redirect -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(link.destination_url)}">
</head>
<body style="font-family:sans-serif; background:#090d16; color:#fff; text-align:center; padding:50px 20px;">
  <p>Mengalihkan Anda ke <a href="${escapeHtml(link.destination_url)}" style="color:#38bdf8;">${escapeHtml(link.destination_url)}</a>...</p>

</body>
</html>`);
      }


    res.writeHead(307, { Location: destination });
    return res.end();
  } catch (error) { return fail(res, error); }
}
