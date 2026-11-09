import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';

function project() {
  const id = process.env.AUTOSHORT_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID;
  const team = process.env.AUTOSHORT_VERCEL_TEAM_ID;
  if (!/^prj_[a-zA-Z0-9]+$/.test(id || '') || (team && !/^team_[a-zA-Z0-9]+$/.test(team))) throw Object.assign(new Error('Identitas proyek Vercel belum dikonfigurasi di server.'), { status: 503 });
  return { id, team };
}
function key() { return createHash('sha256').update('autoshort-vercel-credentials:' + process.env.SUPABASE_SERVICE_ROLE_KEY).digest(); }
export function encryptToken(token) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
export function decryptToken(value) {
  const [iv, tag, data] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
export async function integrationToken() {
  if (process.env.VERCEL_DOMAINS_TOKEN) return process.env.VERCEL_DOMAINS_TOKEN;
  const row = (await db('domain_credentials?id=eq.vercel&select=encrypted_token&limit=1'))?.[0];
  if (!row) return '';
  try { return decryptToken(row.encrypted_token); }
  catch { throw Object.assign(new Error('Koneksi Vercel perlu dihubungkan ulang setelah perubahan kunci server.'), { status: 503 }); }
}
export async function vercel(path, { token, method = 'GET', body } = {}) {
  const { team } = project();
  const credential = token || await integrationToken();
  if (!credential) throw Object.assign(new Error('Hubungkan Vercel di dashboard untuk mengelola pemasangan domain.'), { status: 503 });
  const url = new URL('https://api.vercel.com' + path);
  if (team) url.searchParams.set('teamId', team);
  let response;
  try {
    response = await fetch(url, { method, signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw Object.assign(new Error('Vercel tidak dapat dihubungi. Coba lagi.'), { status: 502 }); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data.error?.code;
    const messages = { unauthorized: 'Token Vercel tidak valid atau sudah kedaluwarsa.', forbidden: 'Token Vercel tidak memiliki akses ke proyek ini.', not_found: 'Domain atau proyek tidak ditemukan di Vercel.', domain_already_in_use: 'Domain sudah digunakan. Periksa domain yang terpasang; domain proyek lain tidak dipindahkan otomatis.', domain_already_exists: 'Domain sudah terpasang.', invalid_domain: 'Nama domain ditolak Vercel.' };
    throw Object.assign(new Error(messages[code] || (response.status === 401 || response.status === 403 ? 'Akses Vercel ditolak. Periksa token dan scope team.' : 'Operasi Vercel gagal. Periksa kepemilikan domain dan coba lagi.')), { providerCode: code, status: response.status === 429 ? 429 : response.status === 404 ? 404 : response.status === 409 ? 409 : 502 });
  }
  return data;
}
export const projectPath = () => '/v9/projects/' + project().id;
export async function connectVercel(token) {
  if (typeof token !== 'string' || token.trim().length < 10 || token.length > 4096) throw Object.assign(new Error('Masukkan token Vercel yang valid melalui kolom rahasia.'), { status: 400 });
  const clean = token.trim();
  const result = await vercel(projectPath(), { token: clean });
  if (result.id !== project().id) throw Object.assign(new Error('Token tidak terhubung ke proyek AutoShort ini.'), { status: 403 });
  await vercel(projectPath() + '/domains?limit=1', { token: clean });
  await db('domain_credentials?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'vercel', encrypted_token: encryptToken(clean) }) });
  return { connected: true, projectName: result.name };
}
export async function listDomains() {
  const domains = []; let cursor;
  do {
    const result = await vercel(projectPath() + '/domains?limit=100' + (cursor ? '&until=' + encodeURIComponent(cursor) : ''));
    domains.push(...(result.domains || []));
    const next = result.pagination?.next;
    if (!next || next === cursor) break;
    cursor = next;
    if (domains.length >= 1000) throw Object.assign(new Error('Daftar domain terlalu besar. Hubungi pengelola.'), { status: 502 });
  } while (cursor);
  return domains.map(d => ({ name: d.name, verified: d.verified === true, redirect: d.redirect || null, platform: d.name.endsWith('.vercel.app') }));
}
export async function domainDetails(name, { verify = false } = {}) {
  const path = projectPath() + '/domains/' + encodeURIComponent(name);
  let domain = await vercel(path); // Confirm project membership before any domain-level request.
  if (verify && !domain.verified) {
    try { await vercel(path + '/verify', { method: 'POST' }); domain = await vercel(path); }
    catch (error) {
      if (!['missing_txt_record', 'invalid_txt_record', 'verification_failed'].includes(error.providerCode)) throw error;
      // Missing ownership TXT is a normal pending state. Keep the original verification records visible.
    }
  }
  const config = await vercel('/v6/domains/' + encodeURIComponent(name) + '/config');
  const apex = domain.apexName || name;
  const sub = name === apex ? '@' : name.endsWith('.' + apex) ? name.slice(0, -(apex.length + 1)) : name;
  const dns = [];
  if (name === apex) {
    const ips = config.recommendedIPv4?.[0]?.value || [];
    for (const value of ips) dns.push({ type: 'A', name: '@', value, purpose: 'routing' });
  } else if (config.recommendedCNAME?.[0]?.value) dns.push({ type: 'CNAME', name: sub, value: config.recommendedCNAME[0].value, purpose: 'routing' });
  for (const v of domain.verification || []) if (v.type && v.domain && v.value) dns.push({ type: v.type, name: v.domain, value: v.value, purpose: 'ownership' });
  return { name, verified: domain.verified === true, redirect: domain.redirect || null, misconfigured: config.misconfigured !== false, nameservers: config.nameservers || [], dns, conflicts: (config.conflicts || []).map(c => ({ type: c.type, name: c.name, value: c.value })) };
}
export async function addDomain(name) {
  const existing = (await listDomains()).find(d => d.name === name);
  if (!existing) await vercel('/v10/projects/' + project().id + '/domains', { method: 'POST', body: { name } });
  return domainDetails(name);
}
export async function removeDomain(name) { return vercel(projectPath() + '/domains/' + encodeURIComponent(name), { method: 'DELETE' }); }

export async function clearDomainRedirect(name) {
  const path = projectPath() + '/domains/' + encodeURIComponent(name);
  await vercel(path);
  await vercel(path, { method: 'PATCH', body: { redirect: null } });
  return domainDetails(name);
}
