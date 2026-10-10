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
  const found = process.argv.find(v => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function execute(c) {
  const startedAt = new Date().toISOString();
  try {
    const evidence = await executeCase(c);
    return { ...c, status: 'PASS', startedAt, finishedAt: new Date().toISOString(), evidenceRequired: true, evidence };
  } catch (error) {
    return { ...c, status: 'FAIL', startedAt, finishedAt: new Date().toISOString(), evidenceRequired: true, error: String(error?.message || error) };
  }
}

async function runBatch(start, count) {
  const results = [];
  let failed = 0;
  for (let i = start; i < start + count && i <= product; i++) {
    const result = await execute(caseAt(i));
    results.push(result);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status === 'FAIL') failed++;
  }
  fs.mkdirSync(path.join(__dirname, '..', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'reports', 'latest-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), caseCount: product, start, count: results.length, failed, results }, null, 2));
  return { results, failed };
}

async function main() {
  const mode = process.argv.includes('--validate') ? 'validate'
    : process.argv.includes('--smoke') ? 'smoke'
    : process.argv.includes('--continuous') ? 'continuous'
    : process.argv.includes('--list') ? 'list'
    : 'run';

  if (mode === 'validate') {
    console.log(JSON.stringify({ caseCount: product, expected: matrix.caseCount, valid: product === matrix.caseCount }, null, 2));
    return;
  }
  if (mode === 'list') {
    const start = Number(arg('start', '1')); const count = Number(arg('count', '20'));
    for (let i = start; i < start + count && i <= product; i++) console.log(JSON.stringify(caseAt(i)));
    return;
  }

  const count = Number(arg('count', mode === 'smoke' ? '100' : '100'));
  let start = Number(arg('start', '1'));
  const interval = Number(arg('interval', '300000'));

  do {
    const batch = await runBatch(start, count);
    if (batch.failed > 0) process.exitCode = 2;
    if (mode !== 'continuous') break;
    start = start + count > product ? 1 : start + count;
    await sleep(interval);
  } while (true);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
