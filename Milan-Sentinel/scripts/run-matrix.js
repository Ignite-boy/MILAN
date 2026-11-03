'use strict';

const fs = require('fs');
const path = require('path');
const { run: executeCase } = require('./execute-case');

const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenarios', 'test-matrix.json'), 'utf8'));
const dims = [
  ['environment', matrix.dimensions.environment],
  ['scenario', matrix.dimensions.scenario],
  ['action', matrix.dimensions.action],
  ['device', matrix.dimensions.device],
  ['state', matrix.dimensions.state],
  ['locale', matrix.dimensions.locale]
];
const product = dims.reduce((n, [, values]) => n * values.length, 1);
if (product !== matrix.caseCount) throw new Error(`Matrix count mismatch: ${product} != ${matrix.caseCount}`);

function caseAt(oneBased) {
  if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > product) throw new Error(`Case must be 1..${product}`);
  let n = oneBased - 1;
  const out = {};
  for (let i = dims.length - 1; i >= 0; i--) {
    const [name, values] = dims[i];
    const index = n % values.length;
    n = Math.floor(n / values.length);
    out[name] = values[index];
  }
  out.caseId = String(oneBased).padStart(8, '0');
  return out;
}

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function caseIdFor({ environment, scenario, action, device, state, locale }) {
  const values = { environment, scenario, action, device, state, locale };
  let n = 0;
  for (const [name, dimension] of dims) {
    const index = dimension.findIndex(value => {
      if (name === 'scenario') return value.id === values.scenario.id || value.name === values.scenario.name;
      return value === values[name];
    });
    if (index < 0) throw new Error(`Unknown ${name} value in representative case`);
    n = n * dimension.length + index;
  }
  return n + 1;
}

function supportedCaseIds() {
  const { ADAPTERS } = require('./execute-case');
  const ids = [];

  for (const scenario of matrix.dimensions.scenario) {
    const adapter = ADAPTERS[scenario.name];
    if (!adapter) continue;

    if (scenario.name === 'dwn-health' && !process.env.DWN_URL?.trim()) continue;
    if (['travel-health', 'travel-request'].includes(scenario.name) && !process.env.TRAVEL_URL?.trim()) continue;

    const devices = adapter.responsive
      ? matrix.dimensions.device
      : ['desktop-1440'];

    for (const device of devices) {
      ids.push(caseIdFor({
        environment: adapter.environment,
        scenario,
        action: adapter.action,
        device,
        state: 'fresh',
        locale: 'en-IN'
      }));
    }
  }

  if (new Set(ids).size !== ids.length) {
    throw new Error('Supported Sentinel suite contains duplicate case IDs.');
  }
  return ids;
}

async function execute(c) {
  const startedAt = new Date().toISOString();
  try {
    const evidence = await executeCase(c);
    if (evidence && evidence.__status === 'SKIP') {
      return { ...c, status: 'SKIP', reason: String(evidence.reason || 'Adapter not implemented'), startedAt, finishedAt: new Date().toISOString() };
    }
    return { ...c, status: 'PASS', startedAt, finishedAt: new Date().toISOString(), evidenceRequired: true, evidence };
  } catch (error) {
    return { ...c, status: 'FAIL', startedAt, finishedAt: new Date().toISOString(), evidenceRequired: true, error: String(error?.message || error) };
  }
}

async function runBatch({ start = 1, count = 100, stride = 1, explicitIds = null, mode = 'sample' }) {
  const ids = explicitIds || Array.from({ length: count }, (_, i) => start + i * stride).filter(id => id <= product);
  const results = [];
  let failed = 0, passed = 0, skipped = 0;
  for (const id of ids) {
    const result = await execute(caseAt(id));
    results.push(result);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status === 'FAIL') failed++;
    else if (result.status === 'SKIP') skipped++;
    else if (result.status === 'PASS') passed++;
  }
  const reportPath = path.join(__dirname, '..', 'reports', 'latest-results.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    matrixCaseCount: product,
    execution: { mode, start: explicitIds ? null : start, requestedCount: explicitIds ? explicitIds.length : count, executedCount: results.length, stride: explicitIds ? null : stride },
    passed, failed, skipped, results
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, matrixCaseCount: product, executed: results.length, passed, failed, skipped }, null, 2));
  return { results, passed, failed, skipped };
}

async function main() {
  const mode = process.argv.includes('--validate') ? 'validate'
    : process.argv.includes('--list-supported') ? 'list-supported'
    : process.argv.includes('--supported') ? 'supported'
    : process.argv.includes('--smoke') ? 'smoke'
    : process.argv.includes('--continuous') ? 'continuous'
    : process.argv.includes('--list') ? 'list'
    : 'run';

  if (mode === 'validate') {
    const dimensionsValid = dims.every(([, values]) => Array.isArray(values) && values.length > 0);
    if (!dimensionsValid || product !== matrix.caseCount) throw new Error('Test matrix dimensions are empty or inconsistent.');
    const supportedIds = supportedCaseIds();
    if (supportedIds.length === 0) throw new Error('No executable Sentinel cases are configured.');
    console.log(JSON.stringify({
      theoreticalCaseCount: product,
      expected: matrix.caseCount,
      executableSupportedCaseCount: supportedIds.length,
      supportedCases: supportedIds.map(id => {
        const c = caseAt(id);
        return {
          caseId: c.caseId,
          environment: c.environment,
          scenario: c.scenario.name,
          action: c.action,
          device: c.device,
          state: c.state,
          locale: c.locale
        };
      }),
      valid: true,
      fullyExecuted: false
    }, null, 2));
    return;
  }
  if (mode === 'list') {
    const start = Number(arg('start', '1'));
    const count = Number(arg('count', '20'));
    const stride = Number(arg('stride', '1'));
    for (let i = start, emitted = 0; emitted < count && i <= product; i += stride, emitted++) console.log(JSON.stringify(caseAt(i)));
    return;
  }

  if (mode === 'list-supported') {
    for (const id of supportedCaseIds()) console.log(JSON.stringify(caseAt(id)));
    return;
  }

  if (mode === 'supported') {
    const ids = supportedCaseIds();
    const shardIndex = Number(arg('shard', '0'));
    const shardCount = Number(arg('shards', '1'));

    if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) ||
        shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      throw new Error('Invalid supported-suite shard parameters.');
    }
    if (ids.length < shardCount) {
      throw new Error(`Supported suite has ${ids.length} cases for ${shardCount} shards; refusing empty shards.`);
    }

    const assignedIds = ids.filter((_, index) => index % shardCount === shardIndex);
    if (assignedIds.length === 0) throw new Error('This shard has no executable test cases.');

    const batch = await runBatch({
      explicitIds: assignedIds,
      mode: `supported-shard-${shardIndex + 1}-of-${shardCount}`
    });

    if (batch.failed > 0 || batch.skipped > 0 || batch.passed !== assignedIds.length) {
      process.exitCode = 2;
    }
    return;
  }

  if (mode === 'smoke') {
    const ids = supportedCaseIds();
    const batch = await runBatch({ explicitIds: ids, mode: 'representative-smoke' });
    if (batch.failed > 0 || batch.skipped > 0 || batch.passed !== ids.length) process.exitCode = 2;
    return;
  }

  let start = Number(arg('start', '1'));
  const count = Number(arg('count', '100'));
  const stride = Number(arg('stride', '1'));
  const interval = Number(arg('interval', '300000'));

  do {
    const batch = await runBatch({ start, count, stride, mode: mode === 'continuous' ? 'continuous-sample' : 'sample' });
    if (batch.failed > 0 || batch.passed === 0) process.exitCode = 2;
    if (mode !== 'continuous') break;
    start = start + count * stride > product ? 1 : start + count * stride;
    await sleep(interval);
  } while (true);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
