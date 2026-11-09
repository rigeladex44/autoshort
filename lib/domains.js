import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import https from 'node:https';
import { db } from './db.js';

export function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (raw.length > 253 || !raw.includes('.') || /[^a-z0-9.-]/.test(raw) || isIP(raw) || raw.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/[a-z]/.test(raw.split('.').at(-1))) {
    throw Object.assign(new Error('Masukkan hostname publik seperti go.contoh.com, tanpa port, path, atau alamat IP.'), { status: 400 });
  }
  return raw;
}
export async function savedDomain() {
  return (await db('app_settings?key=eq.custom_domain&select=value&limit=1'))?.[0]?.value || '';
}
export function domainProof(challenge) {
  return createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY).update('autoshort-domain:' + challenge).digest('hex');
}
const privateAddresses = new BlockList();
for (const [network, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) privateAddresses.addSubnet(network,prefix);
export const publicIPv4 = ip => isIP(ip) === 4 && !privateAddresses.check(ip);

// Pin the checked DNS address for this HTTPS request to prevent DNS rebinding.
export function probeDomain(host, address, challenge) {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: host, path: '/api/config?domain_challenge=' + challenge,
      servername: host, family: 4, agent: false,
      lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
      headers: { 'User-Agent': 'AutoShort-Domain-Verification', Accept: 'application/json' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 16384) response.destroy(new Error('Respons domain terlalu besar.')); });
      response.on('error', reject);
      response.on('end', () => {
        try { if (response.statusCode !== 200) throw new Error(); resolve(JSON.parse(body)); }
        catch { reject(new Error('Domain belum menyajikan aplikasi ini melalui HTTPS tanpa pengalihan.')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('Pemeriksaan HTTPS melewati batas waktu.')), 10000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
export async function verifyDomain(value, { resolve = resolve4, probe = probeDomain } = {}) {
  const host = normalizeDomain(value);
  let addresses;
  try { addresses = await resolve(host); } catch { throw Object.assign(new Error('DNS domain belum tersedia. Hubungkan domain di Vercel dan ikuti nilai DNS yang ditampilkan di sana.'), { status: 422 }); }
  if (!addresses.length || addresses.some(ip => !publicIPv4(ip))) throw Object.assign(new Error('Domain harus mengarah ke alamat IPv4 publik.'), { status: 422 });
  const challenge = randomBytes(24).toString('hex');
  try {
    const result = await probe(host, addresses[0], challenge);
    const expected = Buffer.from(domainProof(challenge));
    const received = Buffer.from(typeof result.domainProof === 'string' ? result.domainProof : '');
    if (!result.configured || expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Domain tidak terhubung ke backend AutoShort yang sama.');
  } catch (error) { throw Object.assign(new Error('Verifikasi gagal: ' + error.message + ' Periksa domain, DNS, dan sertifikat di Vercel.'), { status: 422 }); }
  return host;
}
