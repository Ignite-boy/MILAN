'use strict';

const express = require('express');
const crypto = require('crypto');
const { DidKey } = require('@web5/dids');
const jwt = require('jsonwebtoken');

process.env.CBOR_NATIVE_ACCELERATION_DISABLED =
  process.env.CBOR_NATIVE_ACCELERATION_DISABLED || 'true';

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const auth = require('../middleware/auth');
const {
  readJson,
  writeJson,
  findUserById
} = require('../utils/store');

const {
  ensureUserDwn,
  makeDidDwnService,
  getDwnInfo
} = require('../services/cloudDwnRegistry');

const milanDb = require('../services/milanDb');
const JWT_SECRET = require('../utils/jwtSecret');

const router = express.Router();

const RP_NAME = 'MILAN';

function webauthnConfig(req) {
  const production =
    process.env.VERCEL ||
    process.env.NODE_ENV === 'production';

  let origin =
    process.env.WEBAUTHN_ORIGIN ||
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_PUBLIC_URL ||
    '';

  if (!origin && production) {
    origin = 'https://milanlife.in';
  }

  if (!origin) {
    const proto =
      String(req.headers['x-forwarded-proto'] || 'http')
        .split(',')[0]
        .trim();

    const host =
      req.headers.host ||
      'localhost:5000';

    origin = `${proto}://${host}`;
  }

  origin = String(origin).replace(/\/+$/, '');

  let hostname;

  try {
    hostname = new URL(origin).hostname;
  } catch {
    hostname = 'milanlife.in';
    origin = 'https://milanlife.in';
  }

  const rpID =
    process.env.WEBAUTHN_RP_ID ||
    hostname;

  return {
    rpName: RP_NAME,
    rpID,
    origin
  };
}

function webAuthnUserId(userId) {
  const hex =
    String(userId || '')
      .replace(/-/g, '')
      .trim();

  if (/^[0-9a-f]{32}$/i.test(hex)) {
    return Buffer.from(hex, 'hex');
  }

  return Buffer.from(
    crypto
      .createHash('sha256')
      .update(String(userId || ''))
      .digest()
  );
}

function webAuthnUserIdStored(userId) {
  return webAuthnUserId(userId).toString('base64url');
}

function challengeExpiresAt() {
  return new Date(
    Date.now() + 2 * 60 * 1000
  ).toISOString();
}

function readWebAuthnChallenge(body, expectedType) {
  try {
    const encoded = body?.response?.clientDataJSON;
    if (typeof encoded !== 'string' || !encoded) return null;

    const clientData = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );

    if (clientData?.type !== expectedType) return null;
    if (typeof clientData.challenge !== 'string' ||
        !clientData.challenge) return null;

    return clientData.challenge;
  } catch (_) {
    return null;
  }
}

async function consumeWebAuthnChallenge(id) {
  const consumedAt = new Date();
  try {
    const result = await milanDb.query(
      `UPDATE public.webauthn_challenges
       SET used_at = $2
       WHERE id = $1 AND used_at IS NULL AND expires_at > $2
       RETURNING id`,
      [id, consumedAt]
    );
    return result.rowCount === 1;
  } catch (error) {
    console.error('WebAuthn challenge consumption failed:', error.message);
    return false;
  }
}


function issueJwt(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn:
        process.env.JWT_EXPIRES_IN || '7d'
    }
  );
}

/* =========================================================
   Existing DID endpoints
   ========================================================= */

router.get('/current', auth, (req, res) => {
  const users =
    readJson(global.usersFile, {});

  const found =
    findUserById(users, req.userId);

  if (!found) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  ensureUserDwn(
    found.user,
    found.email
  );

  users[found.email] = found.user;
  writeJson(global.usersFile, users);

  res.json({
    did: found.user.did,
    email: found.email,
    dwn: getDwnInfo(found.user),
    created_at: found.user.created_at
  });
});

router.get('/document', auth, async (req, res) => {
  const users = readJson(global.usersFile, {});
  const found = findUserById(users, req.userId);

  if (!found) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userDid = String(found.user.did || '').trim();
  let resolution;

  try {
    // This installed Web5 API takes the DID URI as a string.
    resolution = await DidKey.resolve(userDid);
  } catch (error) {
    console.warn('[DID] Could not resolve account DID:', error.message);
  }

  const document = resolution?.didDocument;

  if (
    !document ||
    document.id !== userDid ||
    resolution?.didResolutionMetadata?.error
  ) {
    return res.status(409).json({
      error: 'This account uses a legacy DID that cannot be resolved. Its identifier has not been changed; migration is required.',
      code: 'legacy_did_migration_required'
    });
  }

  ensureUserDwn(found.user, found.email);
  users[found.email] = found.user;
  writeJson(global.usersFile, users);

  const dwnService = makeDidDwnService(found.user);
  const services = Array.isArray(document.service)
    ? document.service.filter(item => item?.id !== dwnService.id)
    : [];

  return res.json({
    ...document,
    service: [...services, dwnService]
  });
});

/* =========================================================
   ID3 / Passkey status
   ========================================================= */

router.get(
  '/passkey/status',
  auth,
  async (req, res) => {
    let count = 0;
try {
  const result = await milanDb.query(
    'SELECT COUNT(*)::int AS count FROM public.webauthn_credentials WHERE user_id = $1',
    [req.userId]
  );
  count = Number(result.rows[0]?.count || 0);
} catch (error) {
  console.error('[ID3] credential status lookup failed:', error.message);
  return res.status(503).json({ error: 'WebAuthn credential lookup failed' });
}
    res.json({
      registered: Number(count || 0) > 0,
      count: Number(count || 0)
    });
  }
);

/* =========================================================
   ID3 / Passkey registration
   Called after normal password login.
   ========================================================= */

router.get(
  '/passkey/register/options',
  auth,
  async (req, res) => {
    let user;
try {
  const result = await milanDb.query(
    'SELECT user_id AS id, email, name, did FROM public.users WHERE user_id = $1 LIMIT 1',
    [req.userId]
  );
  user = result.rows[0] || null;
} catch (error) {
  console.error('[ID3] registration account lookup failed:', error.message);
  return res.status(503).json({ error: 'Account database unavailable' });
}
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const { rpName, rpID } =
      webauthnConfig(req);

    let existing;
try {
  const result = await milanDb.query(
    'SELECT credential_id, transports FROM public.webauthn_credentials WHERE user_id = $1',
    [user.id]
  );
  existing = result.rows;
} catch (error) {
  console.error('[ID3] existing credential lookup failed:', error.message);
  return res.status(503).json({ error: 'WebAuthn credential lookup failed' });
}
    const options =
      await generateRegistrationOptions({
        rpName,
        rpID,
        userName: user.email,
        userDisplayName:
          user.name || user.email,
        userID:
          webAuthnUserId(user.id),
        attestationType: 'none',
        excludeCredentials:
          (existing || []).map(
            credential => ({
              id: credential.credential_id,
              transports:
                credential.transports || []
            })
          ),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required'
        }
      });

    console.log('[ID3 TRACE] inserting authentication challenge');

    try {
  await milanDb.query(
    `INSERT INTO public.webauthn_challenges
       (user_id, challenge, purpose, expires_at)
     VALUES ($1, $2, 'registration', $3)`,
    [user.id, options.challenge, challengeExpiresAt()]
  );
} catch (challengeError) {
  console.error('[ID3] registration challenge insert failed:', challengeError.message);
  return res.status(503).json({ error: 'Could not store WebAuthn challenge' });
}
    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.json(options);
  }
);

router.post(
  '/passkey/register/verify',
  auth,
  async (req, res) => {
    const body = req.body || {};

    let user;
try {
  const result = await milanDb.query(
    'SELECT user_id AS id, email, name, did FROM public.users WHERE user_id = $1 LIMIT 1',
    [req.userId]
  );
  user = result.rows[0] || null;
} catch (error) {
  console.error('[ID3] registration verification account lookup failed:', error.message);
  return res.status(503).json({ error: 'Account database unavailable' });
}
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const responseChallenge = readWebAuthnChallenge(body, 'webauthn.create');
    if (!responseChallenge) {
      return res.status(400).json({
        error: 'Invalid WebAuthn registration response challenge'
      });
    }

    const challengeNow = new Date().toISOString();
let challengeRow;
try {
  const result = await milanDb.query(
    `SELECT id, challenge
       FROM public.webauthn_challenges
      WHERE user_id = $1
        AND purpose = 'registration'
        AND challenge = $2
        AND used_at IS NULL
        AND expires_at > $3
      ORDER BY created_at DESC
      LIMIT 1`,
    [user.id, responseChallenge, challengeNow]
  );
  challengeRow = result.rows[0] || null;
} catch (error) {
  console.error('[ID3] registration challenge lookup failed:', error.message);
  return res.status(503).json({ error: 'WebAuthn challenge store unavailable' });
}
if (!challengeRow) {
  return res.status(400).json({
    error: 'WebAuthn registration challenge is invalid, expired or already used. Start again.'
  });
}
    const { rpID, origin } =
      webauthnConfig(req);

    let verification;

    try {
      verification =
        await verifyRegistrationResponse({
          response: body,
          expectedChallenge:
            challengeRow.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true
        });
    } catch (error) {
      console.error(
        '[ID3] registration verification failed:',
        error.message
      );

      return res.status(400).json({
        error:
          error.message ||
          'ID3 registration verification failed'
      });
    }

    if (!verification.verified ||
        !verification.registrationInfo) {
      return res.status(400).json({
        error:
          'ID3 registration was not verified'
      });
    }

    if (!(await consumeWebAuthnChallenge(challengeRow.id))) {
      return res.status(409).json({
        error: 'Registration challenge was already used or expired. Please try again.'
      });
    }

    const {
      credential,
      credentialDeviceType,
      credentialBackedUp
    } = verification.registrationInfo;

    const publicKey =
      Buffer
        .from(credential.publicKey)
        .toString('base64url');

    const webAuthnId =
      webAuthnUserIdStored(user.id);

    let insertError = null;
try {
  await milanDb.query(
    `INSERT INTO public.webauthn_credentials
       (user_id, did, credential_id, webauthn_user_id, public_key,
        counter, transports, device_type, backed_up)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      user.id,
      user.did,
      credential.id,
      webAuthnId,
      publicKey,
      Number(credential.counter || 0),
      JSON.stringify(credential.transports || []),
      credentialDeviceType || null,
      Boolean(credentialBackedUp)
    ]
  );
} catch (error) {
  insertError = error;
}
    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({
          error:
            'This ID3 credential is already registered.'
        });
      }

      console.error(
        '[ID3] credential insert failed:',
        insertError
      );

      return res.status(500).json({
        error:
          'Could not save ID3 credential'
      });
    }

    res.json({
      verified: true,
      did: user.did,
      email: user.email,
      name: user.name
    });
  }
);

/* =========================================================
   ID3 / Passkey login options
   Discoverable credential login: no email required.
   ========================================================= */

router.get(
  '/passkey/login/options',
  async (_req, res) => {
    console.log('[ID3 TRACE] login/options START');
    let count = 0;
try {
  const result = await milanDb.query(
    'SELECT COUNT(*)::int AS count FROM public.webauthn_credentials'
  );
  count = Number(result.rows[0]?.count || 0);
} catch (error) {
  console.error('[ID3 TRACE] credential count ERROR:', error.message);
  return res.status(503).json({ error: 'ID3 authentication database unavailable' });
}
    console.log('[ID3 TRACE] credential count OK:', Number(count || 0));

    if (!Number(count || 0)) {
      return res.status(409).json({
        error:
          'ID3 is not enabled on this device yet. Sign in once with your password and enable ID3.'
      });
    }

    const { rpID } =
      webauthnConfig(_req);

    console.log('[ID3 TRACE] generating authentication options', {
      rpID
    });

    const options =
      await generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        timeout: 60000
      });

    console.log('[ID3 TRACE] authentication options generated');

    try {
  await milanDb.query(
    `INSERT INTO public.webauthn_challenges
       (user_id, challenge, purpose, expires_at)
     VALUES (NULL, $1, 'authentication', $2)`,
    [options.challenge, challengeExpiresAt()]
  );
} catch (challengeError) {
  console.error('[ID3 TRACE] challenge insert ERROR:', challengeError.message);
  return res.status(503).json({ error: 'Could not store ID3 authentication challenge' });
}
    console.log('[ID3 TRACE] login/options COMPLETE');

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    res.json(options);
  }
);

router.post(
  '/passkey/login/verify',
  async (req, res) => {
    const body = req.body || {};
    const credentialId =
      String(body.id || '');

    if (!credentialId) {
      return res.status(400).json({
        error:
          'ID3 credential is missing'
      });
    }

    let storedCredential;
try {
  const result = await milanDb.query(
    'SELECT * FROM public.webauthn_credentials WHERE credential_id = $1 LIMIT 1',
    [credentialId]
  );
  storedCredential = result.rows[0] || null;
} catch (error) {
  console.error('[ID3] credential lookup failed:', error.message);
  return res.status(503).json({ error: 'ID3 authentication database unavailable' });
}
    if (!storedCredential) {
      return res.status(401).json({
        error:
          'This ID3 credential is not registered with MILAN.'
      });
    }

    const responseChallenge = readWebAuthnChallenge(body, 'webauthn.get');
    if (!responseChallenge) {
      return res.status(400).json({
        error: 'Invalid WebAuthn authentication response challenge'
      });
    }

    const challengeNow = new Date().toISOString();
let challengeRow;
try {
  const result = await milanDb.query(
    `SELECT id, challenge
       FROM public.webauthn_challenges
      WHERE user_id IS NULL
        AND purpose = 'authentication'
        AND challenge = $1
        AND used_at IS NULL
        AND expires_at > $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [responseChallenge, challengeNow]
  );
  challengeRow = result.rows[0] || null;
} catch (error) {
  console.error('[ID3] authentication challenge lookup failed:', error.message);
  return res.status(503).json({ error: 'WebAuthn challenge store unavailable' });
}
if (!challengeRow) {
  return res.status(400).json({
    error: 'WebAuthn authentication challenge is invalid, expired or already used. Start again.'
  });
}
    const { rpID, origin } =
      webauthnConfig(req);

    let verification;

    try {
      verification =
        await verifyAuthenticationResponse({
          response: body,
          expectedChallenge:
            challengeRow.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id:
              storedCredential.credential_id,
            publicKey:
              new Uint8Array(
                Buffer.from(
                  storedCredential.public_key,
                  'base64url'
                )
              ),
            counter:
              Number(
                storedCredential.counter || 0
              ),
            transports:
              storedCredential.transports ||
              []
          },
          requireUserVerification: true
        });
    } catch (error) {
      console.error(
        '[ID3] authentication verification failed:',
        error.message
      );

      return res.status(401).json({
        error:
          'ID3 authentication failed'
      });
    }

    if (!verification.verified) {
      return res.status(401).json({
        error:
          'ID3 authentication was not verified'
      });
    }

    if (!(await consumeWebAuthnChallenge(challengeRow.id))) {
      return res.status(400).json({
        error: 'Login challenge was already used or expired. Please try again.'
      });
    }

    const newCounter =
      Number(
        verification.authenticationInfo
          ?.newCounter ??
        storedCredential.counter ??
        0
      );

    try {
  const updated = await milanDb.query(
    'UPDATE public.webauthn_credentials SET counter = $1, updated_at = NOW() WHERE id = $2',
    [newCounter, storedCredential.id]
  );
  if (updated.rowCount !== 1) {
    return res.status(503).json({ error: 'Could not update passkey authenticator counter' });
  }
} catch (error) {
  console.error('[ID3] authenticator counter update failed:', error.message);
  return res.status(503).json({ error: 'Could not update passkey authenticator counter' });
}
    let user;
try {
  const result = await milanDb.query(
    `SELECT user_id AS id, email, name, did, email_verified
       FROM public.users
      WHERE user_id = $1
      LIMIT 1`,
    [storedCredential.user_id]
  );
  user = result.rows[0] || null;
} catch (error) {
  console.error('[ID3] account lookup failed:', error.message);
  return res.status(503).json({ error: 'ID3 account lookup unavailable' });
}
if (!user) {
  return res.status(401).json({ error: 'ID3 account could not be resolved' });
}
    if (user.email_verified !== true) {
      return res.status(403).json({
        error: 'Please verify your email before using ID3 login.',
        emailVerificationRequired: true,
        email: user.email
      });
    }

    const token =
      issueJwt(user);

    console.log(
      '[ID3] login successful:',
      user.email,
      user.id,
      user.did
    );

    return res.json({
      token,
      id: user.id,
      email: user.email,
      name: user.name,
      did: user.did,
      profile: {},
      settings: {},
      emailVerified: user.email_verified === true,
      twoFactorEnabled: false,
      id3: true
    });
  }
);

module.exports = router;
