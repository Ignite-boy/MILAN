const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const OpenAI = require('openai');

const root = path.resolve(__dirname, '..');
const reportPath = path.resolve(root, '..', 'milan-sentinel', 'reports', 'latest-results.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
if (!report || !Array.isArray(report.results)) throw new Error('No Sentinel failure evidence found.');
const failures = report.results.filter(x => x.status === 'FAIL');
if (!failures.length) { console.log('NO_FAILURES'); process.exit(0); }
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');

function sh(cmd, cwd) {
  return cp.execSync(cmd, { cwd, shell: '/bin/bash', encoding: 'utf8', stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 });
}
function repoFor(environment) {
  if (/mini-dwn|dwn-public/.test(environment)) return 'Ignite-boy/mini-dwn';
  if (/travel-agent/.test(environment)) return 'Ignite-boy/travel-agent';
  if (/wallet/.test(environment)) return 'Ignite-boy/natively-dwn-wallet';
  if (/inventory/.test(environment)) return 'Ignite-boy/inventory';
  return 'Ignite-boy/milan-app';
}
function sourceContext(worktree) {
  let files = '';
  try { files = sh("git ls-files | grep -E '\\.(js|mjs|cjs|ts|tsx|html|css|json|yml|yaml)$' | head -n 120", worktree); } catch {}
  return files.split(/\n+/).filter(Boolean).map(f => {
    try { return `FILE ${f}\n${fs.readFileSync(path.join(worktree, f), 'utf8').slice(0, 9000)}`; } catch { return ''; }
  }).join('\n\n').slice(0, 160000);
}
function parseJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : text);
}

async function main() {
  const repo = process.env.RSI_TARGET_REPO || repoFor(failures[0].environment || 'milan-prod');
  const workRoot = path.join(os.tmpdir(), 'milan-rsi');
  const worktree = path.join(workRoot, repo.split('/')[1]);
  fs.mkdirSync(workRoot, { recursive: true });
  if (!fs.existsSync(path.join(worktree, '.git'))) sh(`git clone https://github.com/${repo}.git "${worktree}"`);
  else sh('git fetch origin && git checkout main && git reset --hard origin/main', worktree);

  const failureText = failures.slice(0, 30).map(f => JSON.stringify({ caseId:f.caseId, environment:f.environment, scenario:f.scenario, action:f.action, error:f.error })).join('\n');
  const prompt = `You are the MILAN recursive self-improvement coding agent.\nRepository: ${repo}\n\nFAILURES:\n${failureText}\n\nSOURCE:\n${sourceContext(worktree)}\n\nReturn ONLY JSON with keys summary and patch. The patch must be a valid unified git diff beginning with diff --git and may modify only this repository. Diagnose the root cause from the evidence. Make the smallest correct production-quality fix and add a regression test when practical. Do not expose or invent secrets.`;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({ model: process.env.RSI_MODEL || 'gpt-5', input: prompt });
  const result = parseJson(response.output_text.trim());
  if (!result.patch || !result.patch.includes('diff --git ')) throw new Error('No usable patch returned.');

  const patchPath = path.join(workRoot, 'repair.patch');
  fs.writeFileSync(patchPath, result.patch);
  sh(`git apply --check "${patchPath}"`, worktree);
  sh(`git apply "${patchPath}"`, worktree);
  sh('git diff --check', worktree);

  const changedJs = sh("git diff --name-only -- '*.js' '*.mjs' '*.cjs'", worktree).trim();
  for (const file of changedJs.split(/\n+/).filter(Boolean)) sh(`node --check "${file}"`, worktree);
  if (fs.existsSync(path.join(worktree, 'package.json'))) {
    try { sh('npm install --no-audit --no-fund', worktree); } catch {}
    sh('npm test', worktree);
  }

  const branch = `rsi/repair-${Date.now()}`;
  sh(`git checkout -b ${branch}`, worktree);
  sh('git add -A && git commit -m "RSI: automatic repair from Sentinel failure"', worktree);
  if (process.env.RSI_AUTO_PUSH !== 'false') sh(`git push -u origin ${branch}`, worktree);

  const evidenceDir = path.join(root, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'latest-repair.md'), `# RSI Repair\n\nRepository: ${repo}\nBranch: ${branch}\n\n${result.summary}\n`);
  console.log(JSON.stringify({ repaired:true, repository:repo, branch, failures:failures.length }));
}
main().catch(e => { console.error(e.stack || e.message || e); process.exit(1); });
