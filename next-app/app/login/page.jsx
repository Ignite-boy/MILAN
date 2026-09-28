'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // backend .env se chal raha hai - 5000 port
      const res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('milan_token', data.token || data.accessToken || '');
        localStorage.setItem('milan_user', JSON.stringify(data.user || {}));
        window.location.href = '/';
      } else {
        alert(data.message || 'Login failed - check credentials');
      }
    } catch (err) {
      alert('Backend not running on :5000 - npm start karo backend me');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: '#08080a',
      color: 'white',
      fontFamily: 'Inter, system-ui, sans-serif',
      overflow: 'hidden'
    }}>
      {/* LEFT - Brand */}
      <div style={{
        flex: 1.1,
        background: 'radial-gradient(1200px at 20% 20%, #1a1a2e 0%, #0f0f14 40%, #08080a 100%)',
        padding: '60px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative'
      }}>
        <div>
          <h1 style={{ fontSize: '42px', fontWeight: 800, letterSpacing: '-1px' }}>MILAN</h1>
          <p style={{ marginTop: '8px', color: '#a1a1aa', fontSize: '14px', letterSpacing: '2px', textTransform: 'uppercase' }}>Your Space. Your People.</p>
          
          <div style={{ marginTop: '80px' }}>
            <h2 style={{ fontSize: '38px', fontWeight: 700, lineHeight: '1.1', maxWidth: '420px' }}>
              Privacy-first<br/>social,<br/>
              <span style={{ background: 'linear-gradient(90deg,#a78bfa,#f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>owned by you.</span>
            </h2>
            <p style={{ marginTop: '20px', color: '#71717a', maxWidth: '380px', lineHeight: '1.6' }}>
              One User = One DID = One Isolated DWN Space. Your profile, your media, your keys.
            </p>
          </div>

          <div style={{ marginTop: '60px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              ['🔐', 'DID-based Identity', 'No phone, no tracking'],
              ['🗄️', 'DWN Storage', 'PostgreSQL-backed private vault'],
              ['⚡', 'Web5 Native', 'dwn.milanlife.in health: 200 OK']
            ].map(([icon, title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center' }}>{icon}</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{title}</div>
                  <div style={{ fontSize: '12px', color: '#71717a' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '12px', color: '#3f3f46' }}>© 2026 MILAN • milanlife.in • Built on Web5</div>
      </div>

      {/* RIGHT - Login Form */}
      <div style={{
        flex: 0.9,
        display: 'grid',
        placeItems: 'center',
        background: '#0f0f10',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        padding: '40px'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '360px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '24px',
          padding: '32px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
        }}>
          <h3 style={{ fontSize: '22px', fontWeight: 700 }}>Welcome back</h3>
          <p style={{ fontSize: '13px', color: '#a1a1aa', marginTop: '6px' }}>Login to your DID space</p>

          <form onSubmit={handleLogin} style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#a1a1aa' }}>Email or DID</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@milan.life"
                required
                style={{
                  marginTop: '6px',
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#a1a1aa' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  marginTop: '6px',
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  outline: 'none'
                }}
              />
            </div>

            <button
              disabled={loading}
              type="submit"
              style={{
                marginTop: '8px',
                padding: '12px',
                borderRadius: '12px',
                background: 'white',
                color: 'black',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Signing in...' : 'Sign in →'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#71717a', marginTop: '4px' }}>
              <a href="/reset-password.html" style={{ color: '#a1a1aa', textDecoration: 'none' }}>Forgot?</a>
              <a href="/index.html" style={{ color: '#a1a1aa', textDecoration: 'none' }}>Old login</a>
            </div>
          </form>

          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '11px', color: '#52525b', textAlign: 'center' }}>
            DWN record: profile-picture:&lt;your DID&gt; • Persist before trusting UI
          </div>
        </div>
      </div>
    </div>
  );
}
