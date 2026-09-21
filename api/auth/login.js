'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function issueJwt(user) {
  const secret = String(process.env.JWT_SECRET || '');
  if (!secret) throw new Error('JWT secret is not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    userId: user.id,
    email: user.email,
    iat: now,
    exp: now + 7 * 24 * 60 * 60
  }));

  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64url');

  return `${unsigned}.${signature}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = String(process.env.SUPABASE_SERVICE_KEY || '');

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ error: 'Account database unavailable' });
    }

    const query = new URL('/rest/v1/users', supabaseUrl);
    query.searchParams.set('select', 'id,email,password_hash,name,did');
    query.searchParams.set('email', `eq.${email}`);
    query.searchParams.set('limit', '1');

    const dbResponse = await fetch(query, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json'
      }
    });

    const rows = await dbResponse.json().catch(() => []);

    if (!dbResponse.ok) {
      return res.status(500).json({
        error: 'Account database unavailable'
      });
    }

    const user = Array.isArray(rows) ? rows[0] : null;

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.status(200).json({
      token: issueJwt(user),
      id: user.id,
      email: user.email,
      name: user.name,
      did: user.did,
      profile: {},
      settings: {},
      emailVerified: true,
      twoFactorEnabled: false
    });
  } catch (error) {
    console.error('[FAST LOGIN]', error);
    return res.status(500).json({ error: 'Login failed' });
  }
};
