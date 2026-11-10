import { requireAccount } from '../lib/auth.js';
import { configured, userDb, userScope, fail, randomUUID, hashPassword, managedLink } from '../lib/db.js';
import { normalizeLink } from '../lib/validation.js';
export default async function handler(req, res) {
  const user=await requireAccount(req,res);if(!user)return;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return req.method === 'GET' ? res.status(200).json({ configured: false, mode: 'local', links: [] }) : res.status(503).json({ error: 'Database cloud belum dikonfigurasi.' });
  try {
    if (req.method === 'GET') {
      const links = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await userDb(user,`links?select=*${userScope(user)}&order=created_at.desc,id.desc&limit=1000&offset=${offset}`);
        links.push(...page);
        if (page.length < 1000) break;
      }
      return res.status(200).json({ configured: true, links: links.map(managedLink) });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'ID wajib diisi.' });
      const removed=await userDb(user,`links?id=eq.${encodeURIComponent(id)}${userScope(user)}`, { method: 'DELETE' });
      if(!user.legacy&&!removed?.length)return res.status(404).json({error:'Tautan tidak ditemukan.'});
      return res.status(200).json({ success: true });
    }
    const input = req.body || {};
    let record;
    try { record = normalizeLink(input); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (Object.hasOwn(input, 'password')) record.password = hashPassword(record.password);
    else if (req.method === 'PATCH') delete record.password;
    if (req.method === 'PATCH') {
      if (!input.id) return res.status(400).json({ error: 'ID wajib diisi.' });
      const updated = await userDb(user,`links?id=eq.${encodeURIComponent(input.id)}${userScope(user)}`, { method: 'PATCH', body: JSON.stringify(record) });
      if (!updated?.length) return res.status(404).json({ error: 'Tautan tidak ditemukan.' });
      return res.status(200).json({ link: managedLink(updated[0]) });
    }
    const created = await userDb(user,'links', { method: 'POST', body: JSON.stringify({ ...record, ...(!user.legacy?{user_id:user.id,user_email:user.email}:{}), id: randomUUID(), clicks: 0, created_at: new Date().toISOString() }) });
    return res.status(201).json({ link: managedLink(created[0]) });
  } catch (error) { return fail(res, error); }
}
