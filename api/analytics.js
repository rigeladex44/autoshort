import { admin, configured, db, fail } from '../lib/db.js';
export default async function handler(req, res) {
  if (!admin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Klik hanya dicatat melalui redirect.' });
  if (!configured()) return res.status(200).json({ mode: 'local', recentClicks: [] });
  try {
    const filter = req.query.link_id ? `&link_id=eq.${encodeURIComponent(req.query.link_id)}` : '';
    // Page through PostgREST's default row limit instead of silently truncating at 500.
    const clicks = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await db(`clicks?select=*&order=clicked_at.desc,id.desc&limit=1000&offset=${offset}${filter}`);
      clicks.push(...page);
      if (page.length < 1000) break;
    }
    return res.status(200).json({ totalClicks: clicks.length, recentClicks: clicks });
  } catch (error) { return fail(res, error); }
}
