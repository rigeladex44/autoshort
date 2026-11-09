import { admin, configured, db, fail } from '../lib/db.js';
import { normalizeDomain, savedDomain, verifyDomain } from '../lib/domains.js';
import { integrationToken, listDomains, addDomain, domainDetails, removeDomain, clearDomainRedirect } from '../lib/vercel-domains.js';
export default async function handler(req, res) {
  if (!admin(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ error: 'Custom domain membutuhkan backend cloud. Mode lokal memakai alamat browser.' });
  try {
    if (req.method === 'GET') {
      const connected = Boolean(await integrationToken());
      if (req.query?.domain) {
        const name = normalizeDomain(req.query.domain);
        return res.status(200).json({ domain: await domainDetails(name) });
      }
      return res.status(200).json({ customDomain: await savedDomain(), connected, managedByServer: Boolean(process.env.VERCEL_DOMAINS_TOKEN), domains: connected ? await listDomains() : [] });
    }
    if (req.method === 'DELETE') {
      if (req.query?.domain) {
        const name = normalizeDomain(req.query.domain);
        if (name === await savedDomain() || name === req.headers.host?.split(':')[0] || name.endsWith('.vercel.app')) return res.status(409).json({ error: 'Domain utama, alamat dashboard yang sedang dibuka, dan domain bawaan tidak dapat dilepas. Ganti domain utama atau buka dashboard dari alamat lain terlebih dahulu.' });
        await removeDomain(name);
        return res.status(200).json({ removed: name });
      }
      await db('app_settings?key=eq.custom_domain', { method: 'DELETE' });
      return res.status(200).json({ customDomain: '' });
    }
    const action = req.body?.action || 'activate';
    if (!['add', 'check', 'activate', 'clear_redirect'].includes(action)) return res.status(400).json({ error: 'Tindakan domain tidak valid.' });
    const name = normalizeDomain(req.body?.domain);
    if (action === 'clear_redirect') return res.status(200).json({ domain: await clearDomainRedirect(name) });
    if (action === 'add') return res.status(200).json({ domain: await addDomain(name) });
    if (action === 'check') {
      const domain = await domainDetails(name, { verify: true });
      domain.httpsReady = false;
      if (domain.verified && !domain.misconfigured && !domain.redirect) {
        try { await verifyDomain(name); domain.httpsReady = true; }
        catch (error) { domain.readinessError = error.message; }
      }
      return res.status(200).json({ domain });
    }
    const domain = await verifyDomain(name);
    await db('app_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ key: 'custom_domain', value: domain }) });
    return res.status(200).json({ customDomain: domain, verified: true });
  } catch (error) { return fail(res, error); }
}
