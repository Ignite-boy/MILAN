'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const sentinelRoot = path.resolve(root, '..', 'Milan-Sentinel');
const reportPath = process.env.RSI_EVIDENCE_PATH
  ? path.resolve(process.env.RSI_EVIDENCE_PATH)
  : path.join(sentinelRoot, 'reports', 'latest-results.json');

// One invocation is one bounded analysis cycle; retries require a fresh workflow run.
const max = 1;

function sh(cmd) {
  return cp.execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
}

function readReport() {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Sentinel evidence is missing at ${reportPath}; refusing to use stale or guessed evidence.`);
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`Sentinel evidence is not valid JSON: ${error.message}`);
  }
  if (!report || !Array.isArray(report.results)) {
    throw new Error('Sentinel evidence must contain a results array.');
  }
  return report;
}

async function cycle(n) {
  console.log(`\n=== MILAN RSI CYCLE ${n}/${max} ===`);

  // A workflow_run failure must be diagnosed from that exact run's downloaded artifacts.
  // Do not run today's smoke suite first: that could hide a failure in a scheduled shard.
  if (process.env.RSI_TRIGGERED_BY_SENTINEL_FAILURE === 'true') {
    const report = readReport();
    const failures = report.results.filter(row => row && row.status === 'FAIL');
    if (failures.length === 0) {
      throw new Error('Sentinel workflow failed, but its downloaded evidence contains no FAIL rows. Refusing to claim repair success.');
    }

    console.log(`RSI SOURCE EVIDENCE: ${failures.length} failure(s); source run ${report.sourceRunId || process.env.GITHUB_RUN_ID || 'unknown'}.`);
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required to analyze the triggering Sentinel failures.');
    }

    sh('node scripts/repair.js');
    console.error('RSI TEST GATE: RED — the triggering Sentinel run failed; its candidate repair is isolated and has not been applied to main.');
    return false;
  }

  try {
    sh('npm run validate --prefix ../Milan-Sentinel');
    sh('npm run smoke --prefix ../Milan-Sentinel');
    console.log('RSI TEST GATE: GREEN');
    return true;
  } catch (error) {
    console.error('RSI TEST GATE: RED');
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for autonomous repair after a failed local test gate.');
    }
    sh('node scripts/repair.js');
    console.error('RSI TEST GATE: RED — repair proposal generated in an isolated worktree; this checkout remains unverified.');
    return false;
  }
}

(async () => {
  for (let cycleNo = 1; cycleNo <= max; cycleNo++) {
    const green = await cycle(cycleNo);
    if (green) {
      console.log('RSI RESULT: GREEN');
      process.exitCode = 0;
      return;
    }

    console.error('RSI RESULT: RED — unresolved source/test gate; a proposal is not a production fix.');
    process.exitCode = 1;
    return;
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
