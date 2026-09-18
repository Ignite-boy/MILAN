require('dotenv').config();
const Redis = require('ioredis');

const redisUrl = String(process.env.KV_URL_REDIS_URL || '').trim();
const redis = redisUrl ? new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  retryStrategy(times){ if(times>2) return null; return 200; }
}) : null;

if (redis) {
  redis.on('connect', ()=> console.log('Redis connecting...'));
  redis.on('ready', ()=> console.log('Redis ready!'));
} else {
  console.log('[redis] KV_URL_REDIS_URL not configured; Redis sync disabled.');
}

async function saveLoginEmail(email, extra={}){
  const data = { email, ...extra, loginAt: new Date().toISOString() };
  if (!redis) return data;
  await redis.hset('users', email, JSON.stringify(data));
  return data;
}
async function getAllLogins(){
  if (!redis) return [];
  const all = await redis.hgetall('users');
  return Object.keys(all);
}
module.exports = { saveLoginEmail, getAllLogins, redis };
