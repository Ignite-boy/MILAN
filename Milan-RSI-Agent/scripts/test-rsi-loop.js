'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const entrypoint = path.join(agentRoot, 'scripts', 'rsi-loop.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'milan-rsi-test-'));

function runCase({ mode = 'pass', sourceFailureReport = false }) {
  const mockBin = path.join(tempRoot, 'bin');
  fs.mkdirSync(mockBin, { recursive: true });
  const npmLog = path.join(tempRoot, `npm-${mode}-${sourceFailureReport}.log`);
  const mockNpm = path.join(mockBin, 'npm');
  fs.writeFileSync(mockNpm, '#!/bin/sh\necho "$*" >> "$RSI_TEST_NPM_LOG"\nif [ "$RSI_TEST_NPM_MODE" = "fail" ]; then exit 42; fi\nexit 0\n');
  fs.chmodSync(mockNpm, 0o755);

  const env = {
    ...process.env,
    PATH: `${mockBin}${path.delimiter}${process.env.PATH || ''}`,
    RSI_TEST_NPM_LOG: npmLog,
    RSI_TEST_NPM_MODE: mode
  };
  delete env.OPENAI_API_KEY;
  delete env.RSI_TRIGGERED_BY_SENTINEL_FAILURE;
  delete env.RSI_EVIDENCE_PATH;

  if (sourceFailureReport) {
    const reportPath = path.join(tempRoot, 'source-run-results.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      sourceRunId: 123456,
      results: [{ caseId: 'TEST-FAIL', status: 'FAIL', error: 'intentional fixture failure' }]
    }));
    env.RSI_TRIGGERED_BY_SENTINEL_FAILURE = 'true';
    env.RSI_EVIDENCE_PATH = reportPath;
  }

  const result = cp.spawnSync(process.execPath, [entrypoint], {
    cwd: agentRoot,
    env,
    encoding: 'utf8',
    timeout: 30000
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
    npmCalls: fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8').trim().split(/\n+/).filter(Boolean) : []
  };
}

try {
  const green = runCase({ mode: 'pass' });
  assert.strictEqual(green.status, 0, `green case should exit 0:\n${green.output}`);
  assert.match(green.output, /RSI RESULT: GREEN/);
  assert.strictEqual(green.npmCalls.length, 2, 'green case should run validate and smoke');

  const red = runCase({ mode: 'fail' });
  assert.notStrictEqual(red.status, 0, 'failed test gate must not return 0');
  assert.match(red.output, /RSI TEST GATE: RED/);
  assert.match(red.output, /OPENAI_API_KEY is required/);
  assert.doesNotMatch(red.output, /RSI RESULT: GREEN/);

  const sourceFailure = runCase({ mode: 'pass', sourceFailureReport: true });
  assert.notStrictEqual(sourceFailure.status, 0, 'failed source-run evidence must not return 0 without a repair key');
  assert.match(sourceFailure.output, /RSI SOURCE EVIDENCE: 1 failure/);
  assert.match(sourceFailure.output, /OPENAI_API_KEY is required/);
  assert.strictEqual(sourceFailure.npmCalls.length, 0, 'source-run failures must be analyzed before a fresh smoke run');

  console.log('PASS: RSI green, red, and triggering-run evidence paths behave as expected.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
