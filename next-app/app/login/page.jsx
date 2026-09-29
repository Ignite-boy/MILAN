'use client';
import { useState } from 'react';
export default function LoginPage(){
const [tab,setTab]=useState('login');
const [email,setEmail]=useState('');const [password,setPassword]=useState('');
const [name,setName]=useState('');const [remail,setRemail]=useState('');const [rpass,setRpass]=useState('');const [rcpass,setRcpass]=useState('');
const [msg,setMsg]=useState('');const [isErr,setIsErr]=useState(true);const [loading,setLoading]=useState(false);
const show=(m,e=true)=>{setMsg(m);setIsErr(e);};
const login=async(e)=>{
  e.preventDefault();
  if(!email||!password) return show('Please enter email and password',true);
  setLoading(true);
  try{
    const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Login failed');
    if(!data.token) throw new Error('No token received');
    localStorage.setItem('milan_token',data.token);
    localStorage.setItem('milan_user',JSON.stringify(data));
    localStorage.setItem('milanLastAuthEmail',email);
    show('Login successful. Opening MILAN...',false);
    location.href='/';
  }catch(err){show(err.message||'Login failed',true);}finally{setLoading(false);}
};
const register=async(e)=>{
  e.preventDefault();
  if(rpass!==rcpass){show('Passwords mismatch',true);return;}
  if(!name||!remail||!rpass){show('Please fill all fields',true);return;}
  if(rpass.length<8){show('Password must be at least 8 characters',true);return;}
  setLoading(true);
  try{
    const res=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email:remail,password:rpass})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Registration failed');
    localStorage.setItem('milanLastAuthEmail',remail);
    // FIX: Do NOT auto-login — switch to login tab
    setTab('login');
    setEmail(remail);
    setPassword('');
    setName('');setRemail('');setRpass('');setRcpass('');
    show('✅ Account created. Please login.',false);
  }catch(err){show(err.message||'Registration failed',true);}finally{setLoading(false);}
};
return(<>
<style>{`*{margin:0;padding:0;box-sizing:border-box}html,body{height:100vh;overflow:hidden;background:#050507;color:#fff;font-family:Inter,sans-serif}
.shell{height:100vh;display:grid;grid-template-rows:54px calc(100vh - 54px)} .top{height:54px;display:flex;justify-content:space-between;align-items:center;padding:0 28px;background:rgba(8,8,10,0.75);border-bottom:1px solid rgba(255,255,255,0.07)} .body{max-width:1440px;margin:0 auto;width:100%;display:grid;grid-template-columns:1.15fr 0.85fr;height:100%} .card{width:100%;max-width:410px;background:linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.022));border:1px solid rgba(255,255,255,0.11);border-radius:26px;padding:22px} .tabs{display:flex;gap:4px;padding:4px;background:rgba(0,0,0,0.5);border-radius:10px;margin-bottom:14px} .tab{flex:1;padding:7px 10px;border-radius:8px;font-size:11.5px;font-weight:700;text-align:center;cursor:pointer;color:#71717a} .active{background:#fff;color:#000} .input{width:100%;padding:11px 12px;border-radius:10px;background:rgba(0,0,0,0.52);border:1px solid rgba(255,255,255,0.11);color:#fff;margin-bottom:10px} .btn{width:100%;padding:11.5px;border-radius:11px;background:#fff;color:#000;font-weight:800;border:none} .btn:disabled{opacity:.6}`}</style>
<div className="shell">
<div className="top"><div style={{fontWeight:800,fontFamily:'Syne'}}>MILAN</div><div style={{fontSize:'10px',color:'#9aa0a6'}}>TOP CARD • Login + Register • No Scroll • Deploy</div></div>
<div className="body">
<div style={{padding:'22px 40px',display:'flex',flexDirection:'column',justifyContent:'center',gap:'16px'}}><div style={{fontSize:'60px',fontWeight:800,lineHeight:.88,letterSpacing:'-2.8px',fontFamily:'Syne'}}>Your Space.<br/>Your People.<br/><span style={{background:'linear-gradient(90deg,#a78bfa,#f472b6,#fb7185)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Owned by you.</span></div><p style={{fontSize:'14.5px',color:'#a1a1b0',maxWidth:'440px'}}>Final desktop — whole page in one viewport — no scroll.</p></div>
<div style={{display:'grid',placeItems:'center',padding:'14px 24px'}}>
<div className="card">
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'14px'}}><h2 style={{fontSize:'18px',fontWeight:750}}>{tab==='login'?'Welcome back':'Create your DID'}</h2><div className="tabs" style={{margin:0}}><div className={`tab ${tab==='login'?'active':''}`} onClick={()=>setTab('login')}>Sign in</div><div className={`tab ${tab==='register'?'active':''}`} onClick={()=>setTab('register')}>Register</div></div></div>
{msg && <div style={{fontSize:'12.5px',color:isErr?'#e5484d':'#10b981',minHeight:'18px',marginBottom:'10px'}}>{msg}</div>}
{tab==='login'?<form onSubmit={login}><input className="input" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email or DID" required/><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required/><button className="btn" type="submit" disabled={loading}>{loading?'Logging in...':'Sign in →'}</button></form>:<form onSubmit={register}><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Full Name" required/><input className="input" value={remail} onChange={e=>setRemail(e.target.value)} placeholder="Email" required/><input className="input" type="password" value={rpass} onChange={e=>setRpass(e.target.value)} placeholder="Password" required/><input className="input" type="password" value={rcpass} onChange={e=>setRcpass(e.target.value)} placeholder="Confirm Password" required/><button className="btn" type="submit" disabled={loading}>{loading?'Creating account...':'Create DID →'}</button></form>}
</div>
</div>
</div>
</div>
</>);
}
