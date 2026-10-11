const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'rsi.json'), 'utf8'));
// One invocation is one bounded analysis cycle; another cycle requires a fresh trigger.\nconst max = 1;
const interval = Number(cfg.intervalMs || 60000);
function sh(cmd) { return cp.execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function cycle(n) {
  console.log(`\n=== MILAN RSI CYCLE ${n}/${max} ===`);
  try {
    sh('npm run validate --prefix ../Milan-Sentinel');
    sh('npm run smoke --prefix ../Milan-Sentinel');
    console.log('RSI TEST GATE: GREEN');
    return true;
  } catch {
    console.log('RSI TEST GATE: RED');
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for autonomous repair.');
    sh('node scripts/repair.js');
    return false;
  }
}
(async () => {
  for (let cycleNo = 1; cycleNo <= max; cycleNo++) {
    const green = await cycle(cycleNo);
    if (green) process.exit(0);
    await sleep(interval);
  }
  console.log('RSI cycle completed. This process will not schedule a recursive cycle.');
  process.exit(0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
