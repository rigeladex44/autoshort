import { account, publicUser, siteOrigin } from '../lib/auth.js';
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
    return res.status(200).json({configured:true,domainProof:domainProof(challenge)});
  }
  try {
    const user=cloud?await account(req,res,{optional:true}):null;
    return res.status(200).json({ user:user?.legacy?null:publicUser(user),googleEnabled:process.env.AUTH_GOOGLE_ENABLED==='true',platformDomain:new URL(siteOrigin()).host,configured: cloud, backend: cloud ? 'supabase' : 'local',
      customDomain: cloud && user ? await savedDomain(user) : '', requiresAuth: Boolean(process.env.ADMIN_TOKEN) || cloud });
  } catch (error) { return fail(res, error); }
}
