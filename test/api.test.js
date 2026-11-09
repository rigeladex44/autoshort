import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import links from '../api/links.js';
import redirect from '../api/redirect.js';
import analytics from '../api/analytics.js';
import config from '../api/config.js';
import domains from '../api/domains.js';
import integration from '../api/domain-integration.js';
import { encryptToken, decryptToken, domainDetails } from '../lib/vercel-domains.js';
import { normalizeDomain, verifyDomain, domainProof, publicIPv4 } from '../lib/domains.js';
import { verifyPassword, hashPassword } from '../lib/db.js';
import { normalizeUrl, normalizeSlug, csvCell } from '../lib/validation.js';
const realFetch = globalThis.fetch;
function req(method = 'GET', body, query = {}) { return { method, body, query, headers: { authorization: 'Bearer test-token', host: 'short.example', 'user-agent': 'Mobile Test' } }; }
function response() { return { code: 200, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }, writeHead(n,h) { this.code=n; for (const [k,v] of Object.entries(h)) this.setHeader(k,v); }, end(v) { this.body=v; } }; }
const record = { id: 'one', slug: 'hello', destination_url: 'https://example.com/', is_active: true, clicks: 0 };
let calls;
beforeEach(() => { process.env.SUPABASE_URL = 'https://db.example'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only'; process.env.ADMIN_TOKEN = 'test-token'; process.env.AUTOSHORT_VERCEL_PROJECT_ID='prj_Test'; process.env.AUTOSHORT_VERCEL_TEAM_ID='team_Test'; calls=[]; });
afterEach(() => { globalThis.fetch = realFetch; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ADMIN_TOKEN; delete process.env.AUTOSHORT_VERCEL_PROJECT_ID; delete process.env.AUTOSHORT_VERCEL_TEAM_ID; delete process.env.VERCEL_DOMAINS_TOKEN; });
function mock(fn) { globalThis.fetch = async (url, options) => { calls.push({url:String(url), options}); return fn(String(url), options); }; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
test('URL validation rejects executable schemes; slugs reject reserved routes', () => {
  assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'https://user:pass@example.com', 'http://']) assert.throws(() => normalizeUrl(value));
  for (const value of ['api','redirect','a','has space']) assert.throws(() => normalizeSlug(value));
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"'); assert.equal(csvCell('a,"b'), '"a,""b"');
});
test('config never discloses database credentials', async () => { mock(() => json([{value:'go.example.com'}])); const res=response(); await config(req(),res); assert.equal(res.body.configured,true); assert.ok(!JSON.stringify(res.body).includes('server-only')); });
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
  calls=[]; const bot=req('GET',null,{slug:'hello'}); bot.headers['user-agent']='WhatsApp'; const preview=response(); await redirect(bot,preview); assert.equal(preview.code,200); assert.match(preview.body,/og:title/); assert.equal(calls.length,2);
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

test('domains reject malformed hostnames and private or reserved addresses', async () => {
  assert.equal(normalizeDomain('https://GO.example.com/'), 'go.example.com');
  for (const host of ['localhost','127.0.0.1','https://example.com/path','example.com:443','user@example.com','-bad.example.com','http://example.com','example..com','metadata.google.internal/private']) assert.throws(() => normalizeDomain(host));
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','224.0.0.1','::1']) assert.equal(publicIPv4(ip), false);
  let probed = false;
  await assert.rejects(verifyDomain('go.example.com', {resolve:async()=>['127.0.0.1'],probe:async()=>{probed=true;}}), /publik/);
  assert.equal(probed,false);
});
test('domain verification requires DNS, HTTPS and a proof from this backend', async () => {
  const resolve=async()=>['8.8.8.8'];
  assert.equal(await verifyDomain('go.example.com', {resolve,probe:async(host,ip,challenge)=>({configured:true,domainProof:domainProof(challenge)})}), 'go.example.com');
  await assert.rejects(verifyDomain('go.example.com', {resolve,probe:async()=>({configured:true,domainProof:'wrong'})}), /backend AutoShort/);
  await assert.rejects(verifyDomain('go.example.com', {resolve:async()=>{throw new Error('NXDOMAIN');}}), /DNS/);
  await assert.rejects(verifyDomain('go.example.com', {resolve,probe:async()=>{throw new Error('certificate expired');}}), /certificate expired/);
});
test('domain management requires admin and cloud; reset deletes only the domain setting', async () => {
  const denied=req('DELETE');denied.headers.authorization='Bearer wrong';const res=response();await domains(denied,res);assert.equal(res.code,401);assert.equal(calls.length,0);
  mock(()=>json(null));const reset=response();await domains(req('DELETE'),reset);assert.equal(reset.code,200);assert.equal(reset.body.customDomain,'');assert.match(calls[0].url,/app_settings\?key=eq.custom_domain$/);assert.equal(calls[0].options.method,'DELETE');
  calls=[];const invalid=response();await domains(req('POST',{domain:'127.0.0.1'}),invalid);assert.equal(invalid.code,400);assert.equal(calls.length,0);
  delete process.env.SUPABASE_URL;const local=response();await domains(req('POST',{domain:'go.example.com'}),local);assert.equal(local.code,503);
});
test('public config shares the saved domain and exposes only a valid challenge proof', async () => {
  mock(()=>json([{value:'go.example.com'}]));const res=response();await config(req(),res);assert.equal(res.body.customDomain,'go.example.com');
  const challenge='a'.repeat(48);const proof=response();await config(req('GET',null,{domain_challenge:challenge}),proof);assert.equal(proof.body.domainProof,domainProof(challenge));assert.ok(!JSON.stringify(proof.body).includes('server-only'));
  const bad=response();await config(req('GET',null,{domain_challenge:'bad'}),bad);assert.equal(bad.code,400);
  mock(()=>json({},500));const failed=response();await config(req(),failed);assert.equal(failed.code,502);
});

test('Vercel secret encryption rejects tampering and is never returned to dashboard', async () => {
  const token='secret-vercel-token-for-test';const sealed=encryptToken(token);
  assert.ok(!sealed.includes(token));assert.equal(decryptToken(sealed),token);
  const parts=sealed.split('.');parts[2]=Buffer.from('tampered').toString('base64');assert.throws(()=>decryptToken(parts.join('.')));
  mock(()=>json([{encrypted_token:sealed}]));const state=response();await integration(req(),state);assert.deepEqual(state.body,{connected:true,managedByServer:false});assert.ok(!JSON.stringify(state.body).includes(token));
});
test('dashboard connection validates the existing project before encrypting token', async () => {
  const token='private-vercel-token-test';
  mock(url=>json(url.includes('domain_credentials')?null:url.includes('/domains')?{domains:[]}:{id:'prj_Test',name:'autoshort'}));
  const res=response();await integration(req('POST',{token}),res);assert.equal(res.code,200);assert.equal(res.body.connected,true);
  const saved=calls.find(c=>c.url.includes('domain_credentials'));assert.ok(saved);assert.ok(!saved.options.body.includes(token));assert.equal(decryptToken(JSON.parse(saved.options.body).encrypted_token),token);
  calls=[];mock(()=>json({error:{code:'forbidden',message:token}},403));const denied=response();await integration(req('POST',{token}),denied);assert.equal(denied.code,502);assert.ok(!JSON.stringify(denied.body).includes(token));assert.ok(!calls.some(c=>c.url.includes('domain_credentials')));
});
test('domain add registers in the configured existing project and returns actual DNS recommendations', async () => {
  process.env.VERCEL_DOMAINS_TOKEN='server-vercel-token';
  mock(url=>json(url.includes('/config')?{misconfigured:true,nameservers:['ns.provider.example'],recommendedCNAME:[{value:'specific.vercel-dns.com.'}]}:url.includes('/domains?')?{domains:[]}:{name:'go.example.com',apexName:'example.com',verified:false,verification:[{type:'TXT',domain:'_vercel.example.com',value:'ownership-test'}]}));
  const res=response();await domains(req('POST',{action:'add',domain:'go.example.com'}),res);assert.equal(res.code,200);assert.equal(res.body.domain.misconfigured,true);
  assert.deepEqual(res.body.domain.dns,[{type:'CNAME',name:'go',value:'specific.vercel-dns.com.',purpose:'routing'},{type:'TXT',name:'_vercel.example.com',value:'ownership-test',purpose:'ownership'}]);
  const add=calls.find(c=>c.options.method==='POST');assert.match(add.url,/v10\/projects\/prj_Test\/domains/);assert.deepEqual(JSON.parse(add.options.body),{name:'go.example.com'});assert.ok(calls.every(c=>!c.url.includes('app_settings')));
});
test('domain status confirms membership, checks Vercel verification and does not activate pending DNS', async () => {
  process.env.VERCEL_DOMAINS_TOKEN='server-vercel-token';
  mock(url=>json(url.includes('/config')?{misconfigured:true,recommendedIPv4:[{value:['8.8.8.8']}]}:{name:'example.com',apexName:'example.com',verified:false}));
  const res=response();await domains(req('POST',{action:'check',domain:'example.com'}),res);assert.equal(res.code,200);assert.equal(res.body.domain.httpsReady,false);assert.equal(res.body.domain.dns[0].type,'A');assert.ok(calls.some(c=>c.url.includes('/verify')));assert.ok(!calls.some(c=>c.url.includes('app_settings')));
  calls=[];mock(()=>json({error:{code:'not_found'}},404));await assert.rejects(domainDetails('other.example.com'));assert.equal(calls.length,1);assert.ok(!calls[0].url.includes('/config'));
});
test('domain removal protects primary/current/platform domains and removes only selected hostname', async () => {
  process.env.VERCEL_DOMAINS_TOKEN='server-vercel-token';
  mock(url=>json(url.includes('app_settings')?[{value:'primary.example.com'}]:{}));
  for(const domain of ['primary.example.com','short.example','project.vercel.app']){const r=response();await domains(req('DELETE',null,{domain}),r);assert.equal(r.code,409);}
  calls=[];const removed=response();await domains(req('DELETE',null,{domain:'test.example.com'}),removed);assert.equal(removed.code,200);assert.equal(removed.body.removed,'test.example.com');assert.ok(calls.some(c=>c.url.includes('/domains/test.example.com')&&c.options.method==='DELETE'));assert.ok(!calls.some(c=>c.url.includes('/links')));
});

test('missing Vercel ownership TXT remains an actionable pending status with DNS instructions', async () => {
  process.env.VERCEL_DOMAINS_TOKEN='server-vercel-token';
  mock(url=>url.includes('/verify?')?json({error:{code:'missing_txt_record'}},400):json(url.includes('/config')?{misconfigured:true,recommendedCNAME:[{value:'target.vercel-dns.com'}]}:{name:'go.example.com',apexName:'example.com',verified:false,verification:[{type:'TXT',domain:'_vercel.example.com',value:'ownership-check'}]}));
  const res=response();await domains(req('POST',{action:'check',domain:'go.example.com'}),res);assert.equal(res.code,200);assert.equal(res.body.domain.verified,false);assert.ok(res.body.domain.dns.some(d=>d.type==='TXT'&&d.value==='ownership-check'));
});

test('dashboard can clear a domain redirect without changing unrelated domain settings', async () => {
  process.env.VERCEL_DOMAINS_TOKEN='server-vercel-token';
  mock(url=>json(url.includes('/config')?{misconfigured:false}:{name:'example.com',apexName:'example.com',verified:true,redirect:null}));
  const res=response();await domains(req('POST',{action:'clear_redirect',domain:'example.com'}),res);assert.equal(res.code,200);
  const patch=calls.find(c=>c.options.method==='PATCH');assert.match(patch.url,/projects\/prj_Test\/domains\/example.com/);assert.deepEqual(JSON.parse(patch.options.body),{redirect:null});
});
