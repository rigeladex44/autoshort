import { account, authRequest, checkOrigin, clearSession, cookies, publicUser, setSession, siteOrigin, startGoogle } from '../lib/auth.js';
import { fail } from '../lib/db.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  const action=req.query?.action||'me';
  try{
    if(req.method==='GET'&&action==='google'){
      if(process.env.AUTH_GOOGLE_ENABLED!=='true')return res.status(503).json({error:'Login Google belum diaktifkan.'});
      if(req.headers.host!==new URL(siteOrigin()).host){res.writeHead(302,{Location:siteOrigin()+'/api/auth?action=google'});return res.end();}
      return startGoogle(req,res);
    }
    if(req.method==='GET'&&action==='callback'){
      try{
        const verifier=cookies(req).as_pkce;
        if(!verifier||!req.query.code)throw new Error('Invalid callback');
        const session=await authRequest('token?grant_type=pkce',{method:'POST',body:{auth_code:req.query.code,code_verifier:verifier}});
        setSession(req,res,session);res.writeHead(302,{Location:siteOrigin()+'/#home'});return res.end();
      }catch{res.writeHead(302,{Location:siteOrigin()+'/?auth_error=oauth#login'});return res.end();}
    }
    if(req.method==='GET'&&action==='me'){
      const user=await account(req,res,{optional:true,allowLegacy:false});return res.status(200).json({user:publicUser(user)});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    checkOrigin(req);
    const input=req.body||{};
    if(action==='logout'){
      try{
        const user=await account(req,res,{optional:true,allowLegacy:false});
        if(user)await authRequest('logout?scope=local',{method:'POST',token:user.accessToken}).catch(()=>{});
      }finally{clearSession(req,res);}
      return res.status(200).json({success:true});
    }
    if(action==='session'){
      if(typeof input.refresh_token!=='string'||input.refresh_token.length>4096)return res.status(400).json({error:'Sesi tidak valid.'});
      const session=await authRequest('token?grant_type=refresh_token',{method:'POST',body:{refresh_token:input.refresh_token}});
      setSession(req,res,session);return res.status(200).json({user:publicUser(session.user)});
    }
    if(action==='password'){
      const user=await account(req,res,{allowLegacy:false});
      if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)return res.status(400).json({error:'Password harus 8–128 karakter.'});
      await authRequest('user',{method:'PUT',token:user.accessToken,body:{password:input.password}});return res.status(200).json({success:true});
    }
    const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return res.status(400).json({error:'Masukkan alamat email yang valid.'});
    if(action==='recover'){
      await authRequest('recover?redirect_to='+encodeURIComponent(siteOrigin()+'/#reset'),{method:'POST',body:{email}});
      return res.status(200).json({message:'Jika akun tersedia, tautan reset password akan dikirim ke email tersebut.'});
    }
    if(!['login','signup'].includes(action))return res.status(400).json({error:'Tindakan akun tidak valid.'});
    if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)return res.status(400).json({error:'Password harus 8–128 karakter.'});
    const result=await authRequest(action==='login'?'token?grant_type=password':'signup?redirect_to='+encodeURIComponent(siteOrigin()+'/#home'),{method:'POST',body:{email,password:input.password}});
    if(result.access_token&&result.refresh_token){setSession(req,res,result);return res.status(200).json({user:publicUser(result.user)});}
    return res.status(200).json({confirmationRequired:true,message:'Periksa email untuk memverifikasi akun. Jika sudah punya akun, gunakan Masuk atau Lupa password.'});
  }catch(error){return fail(res,error);}
}
