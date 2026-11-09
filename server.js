// Local runner with the same API handlers and shortlink routes as Vercel.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('./', import.meta.url);
const apis = Object.fromEntries(await Promise.all(['config', 'links', 'analytics', 'redirect', 'image'].map(async name => [name, (await import(`./api/${name}.js`)).default])));
const files = new Set(['index.html', 'app.js', 'styles.css', 'redirect.html', 'redirect.js', 'lib/validation.js', 'assets/qrcode.min.js']);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
  res.send = value => { if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(value); return res; };
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 2000000) return res.status(413).json({ error: 'File terlalu besar.' }); }
    if (body) { try { req.body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON tidak valid.' }); } }
    let name = url.pathname.slice(1) || 'index.html';
    if (name.startsWith('api/')) {
      const api = apis[name.slice(4)];
      if (api) return await api(req, res);
    }
    if (files.has(name)) {
      res.setHeader('Content-Type', types[name.split('.').pop()] || 'application/octet-stream');
      return res.end(await readFile(new URL(name, root)));
    }
    const slug = url.pathname.match(/^\/(?:r\/|s\/)?([a-zA-Z0-9_-]{2,64})$/)?.[1];
    if (slug) { req.query.slug = slug; return await apis.redirect(req, res); }
    res.status(404).send('Halaman tidak ditemukan.');
  } catch (error) { res.status(500).json({ error: 'Permintaan gagal: ' + error.message }); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('AutoShort: http://localhost:' + (process.env.PORT || 3000)));
