import { normalizeUrl, linkState } from './lib/validation.js';
const params = new URLSearchParams(location.search);
const parts = location.pathname.split('/').filter(Boolean);
const slug = (params.get('slug') || (['r','s'].includes(parts[0]) ? parts[1] : parts[0]) || '').toLowerCase();
const states = ['Loading','Protected','Expired','Paused','NotFound','Error'];
const show = name => states.forEach(state => document.getElementById('state' + state).style.display = state === name ? 'block' : 'none');
const error = message => { document.getElementById('errorMessage').textContent = message; show('Error'); };
document.getElementById('slugDisplay').textContent = '/' + slug;
document.getElementById('notFoundSlug').textContent = '/' + slug;
function localRead(key) { try { const data = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } }
let localLink;
let cloud = false;
async function openLocal(link) {
  const destination = normalizeUrl(link.destination_url);
  document.getElementById('destUrlText').textContent = destination;
  show('Loading');
  try {
    const links = localRead('autoshort_links');
    const current = links.find(l => l.id === link.id);
    if (current) { current.clicks = (Number(current.clicks) || 0) + 1; current.last_clicked_at = new Date().toISOString(); }
    localStorage.setItem('autoshort_links', JSON.stringify(links));
    let visitor = localStorage.getItem('autoshort_visitor_id');
    if (!visitor) { visitor = crypto.randomUUID(); localStorage.setItem('autoshort_visitor_id', visitor); }
    const qr = params.get('src') === 'qr' || params.get('qr') === '1' || params.get('utm_source') === 'qr';
    let ref = 'Direct'; try { if (document.referrer) ref = new URL(document.referrer).hostname; } catch {}
    const clicks = localRead('autoshort_clicks');
    clicks.push({ id: crypto.randomUUID(), link_id: link.id, slug: link.slug, visitor_id: visitor, is_qr: qr,
      referer: qr ? 'QR Code Scan' : ref, country: 'Unknown', city: 'Unknown', user_agent: navigator.userAgent, clicked_at: new Date().toISOString() });
    localStorage.setItem('autoshort_clicks', JSON.stringify(clicks.slice(-5000)));
  } catch { /* Redirect still works when browser storage is full or blocked. */ }
  location.replace(destination);
}
async function init() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Konfigurasi server gagal dimuat. Coba lagi.');
    cloud = (await response.json()).configured;
    if (cloud) {
      // Never use cached local links to bypass a cloud password, pause, or expiry.
      for (const flag of ['paused','expired','protected']) if (params.get(flag) === 'true') { show(flag[0].toUpperCase() + flag.slice(1)); return; }
      if (params.get('missing') === 'true') return show('NotFound');
      location.replace(`/api/redirect?slug=${encodeURIComponent(slug)}${params.get('src') === 'qr' ? '&src=qr' : ''}`);
      return;
    }
    localLink = localRead('autoshort_links').find(l => l.slug === slug);
    if (!localLink) return show('NotFound');
    const state = linkState(localLink);
    if (state !== 'active') return show(state[0].toUpperCase() + state.slice(1));
    await openLocal(localLink);
  } catch (err) { error(err.message); }
}
async function unlock() {
  const button = document.getElementById('btnSubmitPassword'); button.disabled = true;
  const password = document.getElementById('passwordInput').value;
  const message = document.getElementById('passwordError'); message.style.display = 'none';
  try {
    if (cloud) {
      const response = await fetch(`/api/redirect?slug=${encodeURIComponent(slug)}${params.get('src') === 'qr' ? '&src=qr' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (response.redirected) { location.replace(response.url); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Tautan tidak dapat dibuka.');
      location.replace(normalizeUrl(data.destination_url));
    } else {
      const fresh = localRead('autoshort_links').find(l => l.slug === slug);
      if (!fresh) return show('NotFound');
      const state = linkState(fresh);
      if (state === 'paused' || state === 'expired') return show(state[0].toUpperCase() + state.slice(1));
      if (fresh.password !== password) throw new Error('Kata sandi salah. Silakan coba lagi.');
      await openLocal(fresh);
    }
  } catch (err) { message.textContent = err.message; message.style.display = 'block'; }
  finally { button.disabled = false; }
}
document.getElementById('btnSubmitPassword').onclick = unlock;
document.getElementById('passwordInput').onkeydown = e => { if (e.key === 'Enter') unlock(); };
init();
