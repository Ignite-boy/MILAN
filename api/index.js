'use strict';

const app = require('../backend/server.js');
const startupPromise = app.locals.milanStartupPromise;

// Vercel can invoke this module before Supabase hydration/DWN initialization
// completes. Gate each request on the shared cold-start promise rather than
// serving a partially initialized app.
module.exports = async function milanApiHandler(req, res) {
  try {
    await startupPromise;
    return app(req, res);
  } catch (error) {
    console.error('[STARTUP] Vercel API initialization failed:', error && error.message);
    if (!res.headersSent) {
      return res.status(503).json({
        error: 'MILAN is temporarily unavailable while storage initializes. Please retry.'
      });
    }
  }
};
