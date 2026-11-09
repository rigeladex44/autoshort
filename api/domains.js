import { admin, configured, db, fail } from '../lib/db.js';
import { savedDomain, verifyDomain } from '../lib/domains.js';
export default async function handler(req, res) {
  if (!admin(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ error: 'Custom domain membutuhkan backend cloud. Mode lokal memakai alamat browser.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ customDomain: await savedDomain() });
    if (req.method === 'DELETE') {
      await db('app_settings?key=eq.custom_domain', { method: 'DELETE' });
      return res.status(200).json({ customDomain: '' });
    }
    const domain = await verifyDomain(req.body?.domain);
    await db('app_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ key: 'custom_domain', value: domain }) });
    return res.status(200).json({ customDomain: domain, verified: true });
  } catch (error) { return fail(res, error); }
}
