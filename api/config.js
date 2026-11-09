import { configured } from '../lib/db.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ configured: configured(), backend: configured() ? 'supabase' : 'local',
    customDomain: process.env.CUSTOM_DOMAIN || '', requiresAuth: Boolean(process.env.ADMIN_TOKEN) || configured() });
}
