import { configured, fail } from '../lib/db.js';
import { savedDomain, domainProof } from '../lib/domains.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const cloud = configured();
  // The challenge route does not depend on settings availability during migration.
  const challenge = req.query?.domain_challenge;
  if (challenge !== undefined) {
    if (!cloud || !/^[a-f0-9]{48}$/.test(challenge)) return res.status(400).json({ error: 'Challenge tidak valid.' });
    return res.status(200).json({ configured: true, domainProof: domainProof(challenge) });
  }
  try {
    return res.status(200).json({ configured: cloud, backend: cloud ? 'supabase' : 'local',
      customDomain: cloud ? await savedDomain() : '', requiresAuth: Boolean(process.env.ADMIN_TOKEN) || cloud });
  } catch (error) { return fail(res, error); }
}
