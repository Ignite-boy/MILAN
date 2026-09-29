'use client'
import { useState, useEffect } from 'react'

export default function LoginPage(){
  const [tab,setTab]=useState('login')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [remail,setRemail]=useState('')
  const [rpass,setRpass]=useState('')
  const [msg,setMsg]=useState('')
  const [loading,setLoading]=useState(false)

  useEffect(()=>{
    const e=localStorage.getItem('milanLastAuthEmail')
    if(e){ setEmail(e); setRemail(e) }
  },[])

  const login=async()=>{
    setLoading(true); setMsg('')
    try{
      const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})})
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Login failed')
      localStorage.setItem('milan_token',data.token)
      localStorage.setItem('milan_user',JSON.stringify(data))
      localStorage.setItem('milanLastAuthEmail',email)
      location.href='/'
    }catch(e){ setMsg(e.message) }
    finally{ setLoading(false) }
  }

  const register=async()=>{
    setLoading(true); setMsg('')
    try{
      const res=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:remail,password:rpass})})
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Register failed')
      localStorage.setItem('milanLastAuthEmail',remail)
      setMsg('DID created! Now login.')
      setTab('login')
      setEmail(remail)
    }catch(e){ setMsg(e.message) }
    finally{ setLoading(false) }
  }

  return (
    <>
<style>{`* {margin:0;padding:0;box-sizing:border-box}
html,body{height:100dvh !important;max-height:100dvh !important;overflow:hidden !important;overscroll-behavior:none !important;background:#050507 !important;color:#fff;font-family:Inter,sans-serif;scrollbar-width:none !important}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none !important}
#__next,body>div{height:100dvh !important;max-height:100dvh !important;overflow:hidden !important}
.shell{height:100dvh !important;max-height:100dvh !important;overflow:hidden !important;display:grid;grid-template-rows:48px calc(100dvh - 48px) !important}
.top{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0}
.body{max-width:1280px;margin:0 auto;width:100%;display:grid;grid-template-columns:1.05fr 0.95fr;height:calc(100dvh - 48px) !important;max-height:calc(100dvh - 48px) !important;overflow:hidden !important;min-height:0 !important}
.left{padding:12px 28px !important;display:flex;flex-direction:column;justify-content:center;gap:10px !important;min-height:0 !important;overflow:hidden !important;max-height:100% !important}
.leftTitle{font-size:clamp(28px,3.6vw,42px) !important;font-weight:800;line-height:.92 !important;letter-spacing:-1.6px !important;font-family:Syne,sans-serif !important}
.leftSub{font-size:12.5px !important;color:#a1a1b0 !important;max-width:380px !important;line-height:1.4 !important}
.feat{padding:9px 12px !important;border-radius:12px !important;background:rgba(255,255,255,0.04) !important;border:1px solid rgba(255,255,255,0.07) !important;display:flex;gap:10px;align-items:center}
.feat b{font-size:12px} .feat span{font-size:11px;color:#9aa0a6}
.right{display:flex;align-items:center;justify-content:center;min-height:0 !important;overflow:hidden !important;max-height:100% !important;padding:8px !important}
.card{width:100%;max-width:360px;max-height:calc(100dvh - 48px - 10px) !important;overflow:hidden !important;background:linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:12px !important;display:flex;flex-direction:column;justify-content:center;flex-shrink:0}
.tabs{display:flex;gap:3px;padding:3px;background:rgba(0,0,0,0.5);border-radius:9px;margin-bottom:8px;flex-shrink:0}
.tab{flex:1;padding:5px 8px;border-radius:7px;font-size:11px;font-weight:700;text-align:center;cursor:pointer;color:#71717a}
.active{background:#fff;color:#000}
.input{width:100%;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.52);border:1px solid rgba(255,255,255,0.1);color:#fff;margin-bottom:6px;flex-shrink:0;font-size:12.5px}
.btn{width:100%;padding:8px;border-radius:9px;background:#fff;color:#000;font-weight:800;border:none;flex-shrink:0;font-size:13px}
.btn:disabled{opacity:.6}
.msg{margin-top:6px;font-size:10px;min-height:12px;flex-shrink:0;color:#fbbf24}
#milan-footer-nav,#milan-fab-top,#milan-install-btn,#milan-music-banner,.milan-app-shell,#milan-app-shell,footer{display:none !important}
@media(max-height:720px){.leftTitle{font-size:28px !important}.feat{padding:7px 10px !important}.card{padding:10px !important}.left{gap:6px !important}}
@media(max-width:900px){.body{grid-template-columns:1fr}.left{display:none}}
`}</style>
      <div className="shell">
        <div className="top"><div style={{fontWeight:800,fontFamily:'Syne'}}>MILAN</div><div style={{fontSize:'10px',color:'#9aa0a6'}}>NO SCROLL • FINAL</div></div>
        <div className="body">
          <div className="left">
            <div className="leftTitle">Your Space.<br/>Your People.<br/><span style={{background:'linear-gradient(90deg,#a78bfa,#f472b6,#fb7185)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Owned by you.</span></div>
            <p className="leftSub">One User = One DID = One Isolated DWN Space. No ads. No tracking.</p>
            <div className="feat"><div>🔐</div><div><b>DID Identity</b><br/><span>Self-sovereign — no phone required</span></div></div>
            <div className="feat"><div>🗄️</div><div><b>DWN Vault</b><br/><span>PostgreSQL + DID isolated storage</span></div></div>
            <div className="feat"><div>⚡</div><div><b>Web5 Native</b><br/><span>dwn.milanlife.in • e2e encrypted</span></div></div>
          </div>
          <div className="right">
            <div className="card">
              <div className="tabs"><div className={tab==='login'?'tab active':'tab'} onClick={()=>setTab('login')}>Sign In</div><div className={tab==='register'?'tab active':'tab'} onClick={()=>setTab('register')}>Create DID</div></div>
              {tab==='login'?(
                <>
                  <input className="input" placeholder="you@milan.life or did:dht:..." value={email} onChange={e=>setEmail(e.target.value)} />
                  <input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
                  <button className="btn" onClick={login} disabled={loading}>{loading?'Signing in...':'Sign in →'}</button>
                </>
              ):(
                <>
                  <input className="input" placeholder="you@milan.life" value={remail} onChange={e=>setRemail(e.target.value)} />
                  <input className="input" type="password" placeholder="New password" value={rpass} onChange={e=>setRpass(e.target.value)} />
                  <button className="btn" onClick={register} disabled={loading}>{loading?'Creating...':'Create new DID →'}</button>
                </>
              )}
              <div className="msg">{msg}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
