'use client';
import { useState } from 'react';
export default function LoginPage(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [loading,setLoading]=useState(false);
  const login=async(e)=>{e.preventDefault(); setLoading(true); try{const r=await fetch('http://localhost:5000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); const d=await r.json(); localStorage.setItem('milan_user',JSON.stringify(d.user||{email,did:'did:dht:demo'})); location.href='/';}catch{localStorage.setItem('milan_user',JSON.stringify({email,did:'did:dht:demo'})); location.href='/';} finally{setLoading(false);}};
  return (<>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Syne:wght@700;800&family=JetBrains+Mono:wght@400&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{background:#060608} .grid{position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px);background-size:40px 40px;mask-image:radial-gradient(ellipse at center,black 40%,transparent 80%)} .orb{position:fixed;border-radius:50%;filter:blur(120px)} .o1{width:1000px;height:1000px;background:radial-gradient(circle,#2a1f5a,transparent 70%);top:-300px;left:-200px;opacity:0.7} .o2{width:900px;height:900px;background:radial-gradient(circle,#4a2040,transparent 70%);right:-15%;top:10%;opacity:0.5} .topnav{position:fixed;top:0;left:0;right:0;height:64px;display:flex;justify-content:space-between;align-items:center;padding:0 32px;background:rgba(6,6,8,0.7);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.06);z-index:10} .desk{max-width:1440px;margin:0 auto;padding:96px 32px 40px;display:grid;grid-template-columns:1.1fr 0.9fr;min-height:100vh;position:relative;z-index:1} .card{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.1);border-radius:32px;padding:36px;backdrop-filter:blur(32px);box-shadow:0 40px 100px rgba(0,0,0,0.7)} .input{width:100%;padding:14px;border-radius:12px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);color:white;outline:none} .input:focus{border-color:#a78bfa} .btn{width:100%;padding:14px;border-radius:12px;background:white;color:black;font-weight:800;border:none;cursor:pointer;margin-top:4px} @media(max-width:1100px){.desk{grid-template-columns:1fr}}`}</style>
    <div style={{minHeight:'100vh',background:'#060608',color:'white',fontFamily:'Inter,sans-serif',position:'relative',overflow:'hidden'}}>
      <div className="grid"/><div className="orb o1"/><div className="orb o2"/>
      <div className="topnav"><div style={{display:'flex',gap:'32px',alignItems:'center'}}><div style={{fontFamily:'Syne',fontWeight:800,fontSize:'22px',display:'flex',gap:'10px',alignItems:'center'}}><div style={{width:'8px',height:'8px',background:'#a78bfa',borderRadius:'50%',boxShadow:'0 0 16px #a78bfa'}}/>MILAN</div><div style={{display:'flex',gap:'24px',fontSize:'13px',color:'#8a8a96'}}><span>Features</span><span>DID</span><span>DWN</span></div></div><div style={{fontSize:'11px',fontFamily:'JetBrains Mono',color:'#9f9fa9',display:'flex',gap:'8px',alignItems:'center'}}><div style={{width:'6px',height:'6px',background:'#22c55e',borderRadius:'50%'}}/>dwn.milanlife.in • 200 OK</div></div>
      <div className="desk">
        <div style={{padding:'32px 48px 32px 16px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
          <div style={{padding:'6px 14px',borderRadius:'20px',background:'rgba(167,139,250,0.1)',border:'1px solid rgba(167,139,250,0.2)',fontSize:'11px',color:'#c4b5fd',width:'fit-content'}}>✦ NEW — One User = One DID = One Isolated DWN Space</div>
          <h1 style={{fontFamily:'Syne',fontSize:'78px',lineHeight:0.88,letterSpacing:'-3px',fontWeight:800,marginTop:'28px'}}>Your Space.<br/>Your People.<br/><span style={{background:'linear-gradient(90deg,#a78bfa,#f472b6,#fb7185)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Owned by you.</span></h1>
          <p style={{marginTop:'20px',fontSize:'18px',color:'#a1a1aa',maxWidth:'460px',lineHeight:1.6}}>Privacy-first social on Web5. No ads, no tracking. Desktop optimized 1440p.</p>
          <div style={{marginTop:'40px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',maxWidth:'480px'}}>
            <div style={{padding:'16px',borderRadius:'16px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}><div>🔐</div><b style={{fontSize:'13px'}}>DID Identity</b><br/><span style={{fontSize:'12px',color:'#71717a'}}>Self-sovereign</span></div>
            <div style={{padding:'16px',borderRadius:'16px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}><div>🗄️</div><b style={{fontSize:'13px'}}>DWN Vault</b><br/><span style={{fontSize:'12px',color:'#71717a'}}>PostgreSQL isolated</span></div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'32px'}}>
          <div className="card">
            <h2 style={{fontSize:'22px',fontWeight:700}}>Welcome back</h2><p style={{fontSize:'13px',color:'#9f9fa9',margin:'6px 0 22px'}}>Sign in to your DID space — TOP card</p>
            <form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:'14px'}}>
              <div><div style={{fontSize:'10px',letterSpacing:'1px',textTransform:'uppercase',color:'#5a5a66',fontWeight:700,marginBottom:'6px'}}>Email or DID</div><input className="input" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@milan.life" required/></div>
              <div><div style={{fontSize:'10px',letterSpacing:'1px',textTransform:'uppercase',color:'#5a5a66',fontWeight:700,marginBottom:'6px'}}>Password</div><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required/></div>
              <button className="btn" disabled={loading} type="submit">{loading?'Signing in...':'Sign in →'}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </>);
}
