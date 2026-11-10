import { createHash, randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function configured() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
export async function db(path, options = {}, accessToken = null) {
  if (!configured()) throw Object.assign(new Error('Database cloud belum dikonfigurasi.'), { status: 503 });
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options, signal: AbortSignal.timeout(12000), headers: {
      apikey: accessToken ? (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) : process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken || process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers
    }
  });
  const text = await response.text();
  let result; try { result = text ? JSON.parse(text) : null; } catch { result = null; }
  if (!response.ok) throw Object.assign(new Error(response.status === 409 ? 'Slug sudah digunakan.' : 'Operasi database gagal. Periksa konfigurasi dan migrasi schema.'), { status: response.status === 409 ? 409 : 502 });
  return result;
}
export function admin(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = process.env.ADMIN_TOKEN;
  if (!token && configured()) { res.status(503).json({ error: 'Atur ADMIN_TOKEN di server sebelum menggunakan cloud.' }); return false; }
  if (token && req.headers.authorization !== `Bearer ${token}`) { res.status(401).json({ error: 'Token admin diperlukan. Masukkan melalui Pengaturan.' }); return false; }
  return true;
}
export function fail(res, error) { return res.status(error.status || 500).json({ error: error.message || 'Terjadi kesalahan server.' }); }
export async function findLink(slug,host) {const owner=await domainOwner(host);if(owner===false)return undefined;return (await db(`links?slug=eq.${encodeURIComponent(slug)}${owner?'&user_id=eq.'+encodeURIComponent(owner):''}&limit=1`))?.[0];}
export async function recordClick(req, link) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  const visitor = createHash('sha256').update(`${ip}|${ua}|${process.env.ADMIN_TOKEN || ''}`).digest('hex').slice(0, 32);
  const qr = req.query.src === 'qr' || req.query.qr === '1' || req.query.utm_source === 'qr';
  // The SQL function inserts the event and increments the counter in one transaction.
  await db('rpc/record_click', { method: 'POST', body: JSON.stringify({ p_link_id: link.id, p_visitor_id: visitor, p_is_qr: qr,
    p_referer: qr ? 'QR Code Scan' : (req.headers.referer || 'Direct'), p_country: req.headers['x-vercel-ip-country'] || 'Unknown',
    p_city: req.headers['x-vercel-ip-city'] || 'Unknown', p_user_agent: ua }) });
}
export { randomUUID };

export function hashPassword(password) {
  if (!password) return null;
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  if (!stored.startsWith('scrypt$')) {
    const a = Buffer.from(password), b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b); // Legacy installations.
  }
  const [, salt, hash] = stored.split('$');
  const actual = scryptSync(password, salt, 32), expected = Buffer.from(hash || '', 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function managedLink(link) {
  const { password, ...safe } = link;
  return { ...safe, has_password: Boolean(password) };
}

export function userDb(user,path,options={}) {return db(path,options,user.legacy?null:user.accessToken);}
export function userScope(user) {return user.legacy?'':`&user_id=eq.${encodeURIComponent(user.id)}`;}
export function platformHost(host) {
  const clean=String(host||'').toLowerCase().split(':')[0];
  return !clean||clean==='localhost'||clean==='127.0.0.1'||clean.endsWith('.vercel.app')||(process.env.PLATFORM_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).includes(clean);
}
export async function domainOwner(host) {
  if(platformHost(host))return null;
  return (await db(`user_domains?domain=eq.${encodeURIComponent(String(host).toLowerCase().split(':')[0])}&verified=eq.true&select=user_id&limit=1`))?.[0]?.user_id||false;
}
