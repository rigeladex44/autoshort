import { configured, db, fail, platformHost } from '../lib/db.js';
import { requireAccount, siteOrigin } from '../lib/auth.js';
import { normalizeDomain, savedDomain, verifyDomain } from '../lib/domains.js';
import { integrationToken, listDomains, addDomain, domainDetails, removeDomain, clearDomainRedirect } from '../lib/vercel-domains.js';
const sharedRows=()=>db('shared_domains?select=domain');
async function privateRow(name){return (await db(`user_domains?domain=eq.${encodeURIComponent(name)}&select=user_id,verified&limit=1`))?.[0];}
export function createDomainHandler({verify=verifyDomain}={}){return async function handler(req,res){
 const user=await requireAccount(req,res);if(!user)return;
 if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!configured())return res.status(503).json({error:'Custom domain membutuhkan backend cloud.'});
 try{
  const isOwner=user.legacy||user.isOperator;
  const shared=(await db('app_settings?key=eq.custom_domain&select=value&limit=1'))?.[0]?.value||new URL(siteOrigin()).host;
  const history=await sharedRows();
  const isShared=name=>name===shared||platformHost(name)||history.some(row=>row.domain===name);
  if(req.method==='GET'&&!req.query?.domain){
   const connected=Boolean(await integrationToken());
   const rows=user.legacy?[]:await db(`user_domains?user_id=eq.${encodeURIComponent(user.id)}&select=domain,verified`);
   const provider=connected?await listDomains():[];
   const permitted=new Set([shared,...history.map(r=>r.domain),...rows.map(r=>r.domain)]);
   // The owner may set up pre-existing project hosts, but never another user's private hostname.
   if(isOwner)for(const d of provider){const row=await privateRow(d.name);if(!row||row.user_id===user.id)permitted.add(d.name);}
   const domains=[...permitted].map(name=>{const p=provider.find(d=>d.name===name);const row=rows.find(d=>d.domain===name);return {name,verified:p?.verified||row?.verified||false,httpsReady:Boolean(row?.verified)||history.some(r=>r.domain===name),redirect:p?.redirect||null,shared:isShared(name),currentShared:name===shared,platform:platformHost(name)};});
   return res.status(200).json({customDomain:await savedDomain(user)||shared,sharedDomain:shared,canManageShared:isOwner,connected,managedByServer:true,domains});
  }
  const raw=req.method==='GET'||req.method==='DELETE'?req.query?.domain:req.body?.domain;
  const scope=req.body?.scope||req.query?.scope;
  if(scope==='shared'&&!isOwner)return res.status(403).json({error:'Hanya pemilik dapat mengatur domain default AutoShort.'});
  if(req.method==='DELETE'&&!raw){
   if(scope==='shared')return res.status(409).json({error:'Pilih dan verifikasi domain default pengganti. Domain lama tetap dipertahankan.'});
   if(!user.legacy)await db(`user_settings?user_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE'});
   return res.status(200).json({customDomain:shared,sharedDomain:shared});
  }
  const name=normalizeDomain(raw);
  const action=req.method==='GET'?'details':req.method==='DELETE'?'remove':req.body?.action||'activate';
  if(!['details','add','check','activate','clear_redirect','remove'].includes(action))return res.status(400).json({error:'Tindakan domain tidak valid.'});
  if(isShared(name)&&!isOwner)return res.status(403).json({error:'Domain bersama dikelola oleh pemilik AutoShort.'});
  if(isShared(name)&&action==='remove')return res.status(409).json({error:'Domain bersama tetap dipertahankan untuk tautan yang sudah dibagikan.'});
  if(isShared(name)&&action==='activate'&&scope!=='shared')return res.status(409).json({error:'Untuk memakai domain bersama, pilih Gunakan Domain Default AutoShort.'});
  let row=await privateRow(name);
  if(row&&row.user_id!==user.id&&!user.legacy)return res.status(404).json({error:'Domain tidak ditemukan di akun Anda.'});
  if(!row&&!user.legacy){
   if(!isOwner&&action!=='add')return res.status(404).json({error:'Tambahkan domain ke akun Anda terlebih dahulu.'});
   if(action==='add'){
    if(!await integrationToken())return res.status(503).json({error:'Layanan pemasangan domain belum tersedia. Hubungi pengelola.'});
    const exists=(await listDomains()).some(d=>d.name===name);
    if(exists&&!isOwner)return res.status(409).json({error:'Domain sudah terpasang. Hubungi pengelola untuk memeriksa kepemilikan.'});
   }
   // Existing project domains may be inspected by the owner. Allocate private ownership only on add/activate.
   if(!isShared(name)&&['add','activate'].includes(action)){
    await db('user_domains',{method:'POST',body:JSON.stringify({domain:name,user_id:user.id,verified:false})});row={user_id:user.id,verified:false};
   }
  }
  if(action==='details')return res.status(200).json({domain:{...await domainDetails(name),shared:isShared(name)}});
  if(action==='add')return res.status(200).json({domain:{...await addDomain(name),shared:isShared(name)}});
  if(action==='clear_redirect')return res.status(200).json({domain:{...await clearDomainRedirect(name),shared:isShared(name)}});
  if(action==='remove'){
   const references=await db(`links?short_domain=eq.${encodeURIComponent(name)}&select=id&limit=1`);
   if(references?.length||name===await savedDomain(user)||name===req.headers.host?.split(':')[0])return res.status(409).json({error:'Domain masih digunakan tautan atau akun. Domain tidak dilepas agar alamat yang sudah dibagikan tetap bekerja.'});
   try{await removeDomain(name);}catch(error){if(error.status!==404)throw error;}
   if(!user.legacy)await db(`user_domains?domain=eq.${encodeURIComponent(name)}&user_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE'});
   return res.status(200).json({removed:name});
  }
  const domain=await domainDetails(name,{verify:true});domain.httpsReady=false;
  if(domain.verified&&!domain.misconfigured&&!domain.redirect){try{await verify(name);domain.httpsReady=true;}catch(error){domain.readinessError=error.message;}}
  // A transient DNS/TLS failure must not revoke a previously verified public route.
  if(domain.httpsReady&&row)await db(`user_domains?domain=eq.${encodeURIComponent(name)}&user_id=eq.${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({verified:true})});
  if(action==='check')return res.status(200).json({domain:{...domain,shared:isShared(name)}});
  if(!domain.httpsReady)return res.status(422).json({error:domain.readinessError||'Domain belum lolos verifikasi kepemilikan, DNS, dan HTTPS.'});
  if(scope==='shared'||user.legacy){
   await db('rpc/set_shared_domain',{method:'POST',body:JSON.stringify({p_domain:name})});
   return res.status(200).json({sharedDomain:name,verified:true});
  }
  await db('user_settings?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:user.id,custom_domain:name})});
  return res.status(200).json({customDomain:name,verified:true});
 }catch(error){return fail(res,error);}
}

}
export default createDomainHandler();
