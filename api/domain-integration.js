import { admin, configured, db, fail } from '../lib/db.js';
import { connectVercel, integrationToken } from '../lib/vercel-domains.js';
export default async function handler(req, res) {
  if (!admin(req, res)) return;
  if (!configured()) return res.status(503).json({ error: 'Integrasi Vercel membutuhkan backend cloud.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ connected: Boolean(await integrationToken()), managedByServer: Boolean(process.env.VERCEL_DOMAINS_TOKEN) });
    if (req.method === 'POST' && process.env.VERCEL_DOMAINS_TOKEN) return res.status(409).json({ error: 'Koneksi dikelola melalui secret server. Perbarui secret tersebut untuk mengganti token.' });
    if (req.method === 'POST') return res.status(200).json(await connectVercel(req.body?.token));
    if (req.method === 'DELETE') {
      if (process.env.VERCEL_DOMAINS_TOKEN) return res.status(409).json({ error: 'Koneksi dikelola melalui secret server dan tidak dapat diputus dari dashboard.' });
      await db('domain_credentials?id=eq.vercel', { method: 'DELETE' });
      return res.status(200).json({ connected: false });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) { return fail(res, error); }
}
