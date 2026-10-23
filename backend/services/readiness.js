'use strict';

async function checkDatabaseReadiness(db) {
  if (!db || typeof db.query !== 'function') {
    return { ready: false, status: 'unavailable' };
  }

  try {
    const result = await db.query('SELECT 1 AS ok');
    const value = result && result.rows && result.rows[0]
      ? result.rows[0].ok
      : undefined;
    const ready = value === 1 || value === '1';
    return { ready, status: ready ? 'ready' : 'unavailable' };
  } catch (_) {
    // Do not expose database connection details through a public health route.
    return { ready: false, status: 'unavailable' };
  }
}

function getRealDwnProtocolReadiness(persistence = {}) {
  const ready =
    persistence.realDwnProtocol === true &&
    persistence.realDwnEnginePresent === true &&
    persistence.sdkReady === true;

  let reason = null;
  if (!ready) {
    if (persistence.realDwnProtocol !== true) reason = 'protocol-not-integrated';
    else if (persistence.realDwnEnginePresent !== true) reason = 'engine-not-present';
    else reason = 'sdk-not-ready';
  }

  return {
    ready,
    status: ready ? 'ready' : 'not-integrated',
    reason
  };
}

module.exports = {
  checkDatabaseReadiness,
  getRealDwnProtocolReadiness
};
