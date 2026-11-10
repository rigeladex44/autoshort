import { configured, db, fail, platformHost } from '../lib/db.js';
import { requireAccount, siteOrigin } from '../lib/auth.js';
import { normalizeDomain, savedDomain, verifyDomain } from '../lib/domains.js';
import { integrationToken, listDomains, addDomain, domainDetails, removeDomain, clearDomainRedirect } from '../lib/vercel-domains.js';
async function owned(user,name) {
 if(user.legacy)return true;
 return Boolean((await db(`user_domains?domain=eq.${encodeURIComponent(name)}&user_id=eq.${encodeURIComponent(user.id)}&select=domain&limit=1`))?.length);
}
export default async function handler(req,res) {
 const user=await requireAccount(req,res);if(!user)return;
 if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!configured())return res.status(503).json({error:'Custom domain membutuhkan backend cloud.'});
 try{
  if(req.method==='GET'&&!req.query?.domain){
   const connected=Boolean(await integrationToken());
   if(user.legacy)return res.status(200).json({customDomain:await savedDomain(),connected,canManageIntegration:true,managedByServer:Boolean(process.env.VERCEL_DOMAINS_TOKEN),domains:connected?await listDomains():[]});
   const rows=await db(`user_domains?user_id=eq.${encodeURIComponent(user.id)}&select=domain,verified`);
   const provider=connected&&rows.length?await listDomains():[];
   const domains=rows.map(row=>{const d=provider.find(d=>d.name===row.domain);return {name:row.domain,verified:d?.verified||false,redirect:d?.redirect||null,platform:false};});
   domains.unshift({name:new URL(siteOrigin()).host,verified:true,platform:true,shared:true,redirect:null});
   return res.status(200).json({customDomain:await savedDomain(user),connected,canManageIntegration:user.isOperator,managedByServer:!user.isOperator||Boolean(process.env.VERCEL_DOMAINS_TOKEN),domains});
  }
  const raw=req.method==='GET'||req.method==='DELETE'?req.query?.domain:req.body?.domain;
  if(req.method==='DELETE'&&!raw){
   if(user.legacy)await db('app_settings?key=eq.custom_domain',{method:'DELETE'});
   else await db(`user_settings?user_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE'});
   return res.status(200).json({customDomain:''});
  }
  const name=normalizeDomain(raw);
  const action=req.method==='GET'?'details':req.method==='DELETE'?'remove':req.body?.action||'activate';
  if(!['details','remove','add','check','activate','clear_redirect'].includes(action))return res.status(400).json({error:'Tindakan domain tidak valid.'});
  if(!user.legacy&&platformHost(name))return res.status(403).json({error:'Domain bersama tidak dapat diubah oleh akun pengguna.'});
  let hasOwnership=await owned(user,name);
  if(action==='add'&&!hasOwnership){
   if(!Boolean(await integrationToken()))return res.status(503).json({error:'Pengelola belum mengaktifkan layanan custom domain.'});
   const existing=(await listDomains()).some(domain=>domain.name===name);
   if(existing)return res.status(409).json({error:'Domain sudah dipasang. Hubungi pengelola jika Anda pemiliknya.'});
   await db('user_domains',{method:'POST',body:JSON.stringify({domain:name,user_id:user.id,verified:false})});hasOwnership=true;
  }
  if(!hasOwnership)return res.status(404).json({error:'Domain tidak ditemukan di akun Anda.'});
  if(action==='details')return res.status(200).json({domain:await domainDetails(name)});
  if(action==='add')return res.status(200).json({domain:await addDomain(name)});
  if(action==='clear_redirect')return res.status(200).json({domain:await clearDomainRedirect(name)});
  if(action==='remove'){
   if(name===await savedDomain(user)||name===req.headers.host?.split(':')[0]||name.endsWith('.vercel.app'))return res.status(409).json({error:'Domain utama atau alamat dashboard tidak dapat dilepas. Ganti domain utama terlebih dahulu.'});
   try{await removeDomain(name);}catch(error){if(error.status!==404)throw error;}
   if(!user.legacy)await db(`user_domains?domain=eq.${encodeURIComponent(name)}&user_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE'});
   return res.status(200).json({removed:name});
  }
  const domain=await domainDetails(name,{verify:true});domain.httpsReady=false;
  if(domain.verified&&!domain.misconfigured&&!domain.redirect){try{await verifyDomain(name);domain.httpsReady=true;}catch(error){domain.readinessError=error.message;}}
  if(!user.legacy)await db(`user_domains?domain=eq.${encodeURIComponent(name)}&user_id=eq.${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({verified:domain.httpsReady})});
  if(action==='check')return res.status(200).json({domain});
  if(!domain.httpsReady)return res.status(422).json({error:domain.readinessError||'Domain belum lolos verifikasi kepemilikan, DNS, dan HTTPS.'});
  if(user.legacy)await db('app_settings?on_conflict=key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({key:'custom_domain',value:name})});
  else await db('user_settings?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:user.id,custom_domain:name})});
  return res.status(200).json({customDomain:name,verified:true});
 }catch(error){return fail(res,error);}
}
