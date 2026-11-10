export const reservedSlugs = new Set(['api', 'index', 'redirect', 'styles', 'app', 'favicon', 'robots', 'lib', 'assets']);
export function normalizeUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) throw new Error('URL tujuan wajib diisi.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL tujuan tidak valid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Gunakan URL HTTP atau HTTPS yang valid.');
  return url.href;
}
export function normalizeSlug(value) {
  const slug = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(slug) || reservedSlugs.has(slug.toLowerCase())) throw new Error('Slug harus 2–64 huruf, angka, strip, atau garis bawah dan bukan nama sistem.');
  return slug;
}
export function normalizeLink(input) {
  const expires = input.expires_at ? new Date(input.expires_at) : null;
  if (expires && !Number.isFinite(expires.getTime())) throw new Error('Tanggal kedaluwarsa tidak valid.');
  let image = String(input.og_image || '').trim();
  if (image && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(image)) image = normalizeUrl(image);
  if (image.length > 1500000) throw new Error('Gambar terlalu besar. Maksimal 1 MB.');
  return {
    slug: normalizeSlug(input.slug), destination_url: normalizeUrl(input.destination_url),
    title: String(input.title || input.og_title || input.slug).trim().slice(0, 200),
    og_title: String(input.og_title || '').trim().slice(0, 200),
    og_description: String(input.og_description || '').trim().slice(0, 1000), og_image: image,
    password: String(input.password || '').slice(0, 128) || null,
    expires_at: expires ? expires.toISOString() : null, is_active: input.is_active !== false,
    tags: (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',')).map(t => t.trim()).filter(Boolean).slice(0, 20)
  };
}
export function linkState(link, now = Date.now()) {
  if (link.is_active === false) return 'paused';
  if (link.expires_at && new Date(link.expires_at).getTime() <= now) return 'expired';
  if (link.password || link.has_password) return 'protected';
  return 'active';
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
