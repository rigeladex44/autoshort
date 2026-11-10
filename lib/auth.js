import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { configured } from './db.js';
export const ownerId = () => process.env.OWNER_USER_ID || '';
export function legacyOperator(req) {
  const expected=process.env.ADMIN_TOKEN, actual=req.headers?.authorization?.replace(/^Bearer /,'');
  if(!expected||!actual)return false;
  const a=Buffer.from(expected),b=Buffer.from(actual);return a.length===b.length&&timingSafeEqual(a,b);
}
export function checkOrigin(req) {
  const origin=req.headers?.origin;
  if(origin && origin!==`https://${req.headers.host}` && origin!==`http://${req.headers.host}`)throw Object.assign(new Error('Permintaan lintas situs ditolak.'),{status:403});
  if(req.headers?.['sec-fetch-site']==='cross-site')throw Object.assign(new Error('Permintaan lintas situs ditolak.'),{status:403});
}
export function cookies(req) {
  return Object.fromEntries((req.headers?.cookie||'').split(';').map(part=>{const i=part.indexOf('=');if(i<0)return [];try{return [part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1))];}catch{return [];}}).filter(parts=>parts.length===2));
}
function setCookie(req,res,name,value,age) {
  const secure=process.env.NODE_ENV==='production'||Boolean(process.env.VERCEL);
  const prior=res.getHeader?.('Set-Cookie')||res.headers?.['set-cookie']||[];
  res.setHeader('Set-Cookie',[...(Array.isArray(prior)?prior:[prior]),`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`]);
}
export function setSession(req,res,session) {
  setCookie(req,res,'as_access',session.access_token,session.expires_in||3600);
  setCookie(req,res,'as_refresh',session.refresh_token,60*60*24*30);
}
export function clearSession(req,res) {setCookie(req,res,'as_access','',0);setCookie(req,res,'as_refresh','',0);}
export function publicUser(user) {return user?{id:user.id,email:user.email||'',isOperator:user.id===ownerId()}:null;}
export function siteOrigin() {return (process.env.AUTH_SITE_URL||'http://localhost:3000').replace(/\/$/,'');}
export async function authRequest(path,{method='GET',body,token}={}) {
  if(!configured())throw Object.assign(new Error('Layanan akun belum tersedia.'),{status:503});
  let response;
  try{response=await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`,{method,signal:AbortSignal.timeout(15000),headers:{apikey:process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw Object.assign(new Error('Layanan akun tidak dapat dihubungi. Coba lagi.'),{status:502});}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const code=data.error_code||data.code;
    const messages={invalid_credentials:'Email atau password salah.',email_not_confirmed:'Verifikasi email Anda sebelum masuk.',over_email_send_rate_limit:'Batas pengiriman email tercapai. Coba lagi nanti atau masuk dengan Google.',over_request_rate_limit:'Terlalu banyak percobaan. Coba lagi nanti.',weak_password:'Gunakan password minimal 8 karakter yang lebih kuat.',email_address_invalid:'Alamat email tidak valid.',email_address_not_authorized:'Pengiriman email publik belum diaktifkan. Gunakan Google atau hubungi pengelola.',user_already_exists:'Jika email sudah terdaftar, gunakan Masuk atau Lupa password.',same_password:'Gunakan password yang berbeda dari sebelumnya.'};
    throw Object.assign(new Error(messages[code]||(response.status===401?'Sesi berakhir. Silakan masuk lagi.':response.status>=500?'Pengiriman email atau layanan akun belum siap. Gunakan Google atau hubungi pengelola.':'Permintaan akun ditolak. Periksa data dan coba lagi.')),{status:response.status===429?429:response.status>=500?503:response.status,authCode:code});
  }
  return data;
}
export async function account(req,res,{optional=false,allowLegacy=true}={}) {
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method))checkOrigin(req);
  if(allowLegacy&&legacyOperator(req))return {legacy:true,id:null,isOperator:true,accessToken:null};
  const jar=cookies(req);let token=req.headers?.authorization?.replace(/^Bearer /,'')||jar.as_access;
  if(token&&!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))token=null;
  if(token){
    try{const user=await authRequest('user',{token});if(!user.id)throw Object.assign(new Error('Sesi tidak valid.'),{status:401});return {...publicUser(user),accessToken:token};}
    catch(error){if(error.status!==401&&error.status!==403)throw error;}
  }
  if(jar.as_refresh){
    try{const session=await authRequest('token?grant_type=refresh_token',{method:'POST',body:{refresh_token:jar.as_refresh}});setSession(req,res,session);return {...publicUser(session.user),accessToken:session.access_token};}
    catch(error){if(error.status>=500)throw error;clearSession(req,res);}
  }
  if(optional)return null;
  throw Object.assign(new Error('Silakan masuk untuk mengelola data Anda.'),{status:401});
}
export async function requireAccount(req,res,options) {
  try{return await account(req,res,options);}catch(error){res.status(error.status||500).json({error:error.message});return null;}
}
export function startGoogle(req,res) {
  const verifier=randomBytes(32).toString('base64url'), challenge=createHash('sha256').update(verifier).digest('base64url');
  setCookie(req,res,'as_pkce',verifier,600);
  const callback=siteOrigin()+'/api/auth?action=callback';
  res.writeHead(302,{Location:`${process.env.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=s256`});res.end();
}
