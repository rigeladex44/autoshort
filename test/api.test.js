import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import links from '../api/links.js';
import redirect from '../api/redirect.js';
import analytics from '../api/analytics.js';
import config from '../api/config.js';
import { verifyPassword, hashPassword } from '../lib/db.js';
import { normalizeUrl, normalizeSlug, csvCell } from '../lib/validation.js';
const realFetch = globalThis.fetch;
function req(method = 'GET', body, query = {}) { return { method, body, query, headers: { authorization: 'Bearer test-token', host: 'short.example', 'user-agent': 'Mobile Test' } }; }
function response() { return { code: 200, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, writeHead(n,h) { this.code=n; for (const [k,v] of Object.entries(h)) this.setHeader(k,v); }, end(v) { this.body=v; } }; }
const record = { id: 'one', slug: 'hello', destination_url: 'https://example.com/', is_active: true, clicks: 0 };
let calls;
beforeEach(() => { process.env.SUPABASE_URL = 'https://db.example'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only'; process.env.ADMIN_TOKEN = 'test-token'; calls=[]; });
afterEach(() => { globalThis.fetch = realFetch; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ADMIN_TOKEN; });
function mock(fn) { globalThis.fetch = async (url, options) => { calls.push({url, options}); return fn(url, options); }; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
test('URL validation rejects executable schemes; slugs reject reserved routes', () => {
  assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'https://user:pass@example.com', 'http://']) assert.throws(() => normalizeUrl(value));
  for (const value of ['api','redirect','a','has space']) assert.throws(() => normalizeSlug(value));
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"'); assert.equal(csvCell('a,"b'), '"a,""b"');
});
test('config never discloses database credentials', async () => { const res=response(); await config(req(),res); assert.equal(res.body.configured,true); assert.ok(!JSON.stringify(res.body).includes('server-only')); });
test('management rejects unauthorized access and missing server admin token', async () => {
  const request=req(); request.headers.authorization='Bearer wrong'; const res=response(); await links(request,res); assert.equal(res.code,401); assert.equal(calls.length,0);
  delete process.env.ADMIN_TOKEN; const missing=response(); await links(req(),missing); assert.equal(missing.code,503);
});
test('create preserves password expiry tags and preview; duplicate slug is reported', async () => {
  mock((url, options) => json([{ ...JSON.parse(options.body) }]));
  const res=response(); await links(req('POST',{ ...record, password:'1234', tags:['promo'], expires_at:'2030-01-01', og_image:'https://example.com/a.png' }),res);
  assert.equal(res.code,201); assert.equal(res.body.link.password,undefined); assert.equal(res.body.link.has_password,true); assert.ok(verifyPassword('1234', JSON.parse(calls[0].options.body).password)); assert.deepEqual(res.body.link.tags,['promo']);
  mock(() => json({code:'23505'},409)); const dup=response(); await links(req('POST',record),dup); assert.equal(dup.code,409);
});
test('edit updates slug and delete propagates database failures', async () => {
  mock((url, options) => json([{id:'one',...JSON.parse(options.body)}]));
  const edit=response(); await links(req('PATCH',{...record,slug:'renamed'}),edit); assert.equal(edit.body.link.slug,'renamed');
  mock(() => json({error:'failure'},400)); const res=response(); await links(req('DELETE',null,{id:'one'}),res); assert.equal(res.code,502);
});
test('paused expired and password gates never log or reveal destination', async () => {
  for (const [fields, flag] of [[{is_active:false},'paused'],[{expires_at:'2000-01-01'},'expired'],[{password:'secret'},'protected']]) {
    calls=[]; mock(() => json([{...record,...fields}]));
    const res=response(); await redirect(req('GET',null,{slug:'hello'}),res); assert.equal(res.code,302); assert.ok(res.headers.location.includes(flag+'=true')); assert.equal(calls.length,1);
  }
});
test('password unlock requires exact password and awaits one atomic click RPC', async () => {
  mock(url => url.includes('rpc/') ? json(null) : json([{...record,password:hashPassword('secret')}]));
  const denied=response(); await redirect(req('POST',{password:'wrong'},{slug:'hello'}),denied); assert.equal(denied.code,403); assert.equal(calls.length,1);
  calls=[]; const allowed=response(); await redirect(req('POST',{password:'secret'},{slug:'hello',src:'qr'}),allowed);
  assert.equal(allowed.body.destination_url, record.destination_url); assert.equal(calls.length,2); assert.ok(calls[1].url.endsWith('/rpc/record_click')); assert.equal(JSON.parse(calls[1].options.body).p_is_qr,true);
});
test('normal redirect logs once; preview bots and HEAD never log', async () => {
  mock(url => url.includes('rpc/') ? json(null) : json([record]));
  const res=response(); await redirect(req('GET',null,{slug:'hello'}),res); assert.equal(res.code,307); assert.equal(calls.length,2); assert.equal(res.headers.location,record.destination_url);
  calls=[]; const bot=req('GET',null,{slug:'hello'}); bot.headers['user-agent']='WhatsApp'; const preview=response(); await redirect(bot,preview); assert.equal(preview.code,200); assert.match(preview.body,/og:title/); assert.equal(calls.length,1);
  calls=[]; await redirect(req('HEAD',null,{slug:'hello'}),response()); assert.equal(calls.length,1);
});
test('analytics pages past database row limit and reports errors', async () => {
  mock(url => json(url.includes('offset=0') ? Array.from({length:1000}, (_,id)=>({id})) : [{id:1001}]));
  const res=response(); await analytics(req(),res); assert.equal(res.body.totalClicks,1001); assert.equal(calls.length,2);
  mock(() => json({},500)); const failed=response(); await analytics(req(),failed); assert.equal(failed.code,502);
});
test('no database uses explicit local mode and never calls a demo database', async () => {
  delete process.env.SUPABASE_URL; const res=response(); await links(req(),res); assert.equal(res.body.mode,'local'); assert.equal(calls.length,0);
  const fallback=response(); await redirect(req('GET',null,{slug:'hello'}),fallback); assert.match(fallback.headers.location,/redirect.html/);
});

test('editing other fields preserves a protected password and never exposes its hash', async () => {
  const secret = hashPassword('keep-me');
  mock((url, options) => json([{ ...record, ...JSON.parse(options.body || '{}'), password: secret }]));
  const res = response(); await links(req('PATCH', record), res);
  assert.equal(Object.hasOwn(JSON.parse(calls[0].options.body), 'password'), false);
  assert.equal(res.body.link.has_password, true); assert.equal(res.body.link.password, undefined);
});
