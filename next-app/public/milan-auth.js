const API_BASE = '';
async function safeJson(r){ const t=await r.text(); if(!t) throw new Error('Empty response from server'); try{return JSON.parse(t);}catch(e){throw new Error(t.slice(0,200));} }
async function milanRegister(name,email,password){ 
  const res=await fetch(API_BASE+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})}); 
  return await safeJson(res); 
}
async function milanLogin(email,password){ 
  const res=await fetch(API_BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); 
  const d=await safeJson(res); 
  if(d.token){localStorage.setItem('milan_token',d.token);localStorage.setItem('milan_did',d.did);localStorage.setItem('milan_user',JSON.stringify(d.user||d.profile||{}))}
  return d;
}