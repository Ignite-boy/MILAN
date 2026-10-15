'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const OpenAI = require('openai');

const root = path.resolve(__dirname, '..');
const defaultReportPath = path.resolve(root, '..', 'Milan-Sentinel', 'reports', 'latest-results.json');
const reportPath = process.env.RSI_EVIDENCE_PATH
  ? path.resolve(process.env.RSI_EVIDENCE_PATH)
  : defaultReportPath;

function readReport() {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`No Sentinel failure evidence found at ${reportPath}; refusing to use stale evidence.`);
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`Sentinel report is invalid JSON: ${error.message}`);
  }
  if (!report || !Array.isArray(report.results)) {
    throw new Error('Sentinel report must contain a results array.');
  }
  return report;
}

const report = readReport();
const failures = report.results.filter(row => row && row.status === 'FAIL');
if (!failures.length) {
  console.error('No FAIL rows found in the selected Sentinel evidence; no repair proposal will be generated.');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY && !process.env.RSI_BASE_URL) throw new Error('Set OPENAI_API_KEY or RSI_BASE_URL for the selected repair model.');

function sh(cmd, cwd) {
  return cp.execSync(cmd, {
    cwd,
    shell: '/bin/bash',
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024
  });
}

function repoFor() {
  return 'Ignite-boy/MILAN';
}

function sourceContext(worktree) {
  let files = '';
  try {
    files = sh("git ls-files | grep -E '\\.(js|mjs|cjs|ts|tsx|html|css|json|yml|yaml)$' | head -n 120", worktree);
  } catch {}
  return files.split(/\n+/).filter(Boolean).map(file => {
    try {
      return `FILE ${file}\n${fs.readFileSync(path.join(worktree, file), 'utf8').slice(0, 9000)}`;
    } catch {
      return '';
    }
  }).join('\n\n').slice(0, 60000);
}

function parseJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : text);
}

function validatePatchPaths(patch) {
  const headers = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)];
  if (!headers.length) throw new Error('Repair patch contains no file-change headers.');

  const paths = [];
  for (const match of headers) {
    const from = match[1];
    const to = match[2];
    if (from !== to) throw new Error('Renames are not accepted in an automated repair proposal.');
    const normalized = path.posix.normalize(to);
    if (
      normalized !== to ||
      to.split('/').includes('.') ||
      !/^[A-Za-z0-9._/-]+$/.test(to) ||
      path.isAbsolute(to) ||
      to.split('/').includes('..')
    ) {
      throw new Error(`Unsafe or unsupported path in repair patch: ${to}`);
    }
    if (
      to.startsWith('.github/') ||
      to === '.gitignore' ||
      to === '.npmrc' ||
      /(^|\/)\.env(?:\.|$)/i.test(to) ||
      /(^|\/)(secrets?|credentials?)(\/|\.|$)/i.test(to) ||
      /(^|\/)package(?:-lock)?\.json$/i.test(to) ||
      to === 'Milan-RSI-Agent/scripts/repair.js' ||
      to === 'Milan-RSI-Agent/scripts/rsi-loop.js' ||
      to === 'Milan-RSI-Agent/scripts/test-rsi-loop.js' ||
      /\.(pem|key|p12|pfx)$/i.test(to)
    ) {
      throw new Error(`Repair patch is not allowed to modify a protected path: ${to}`);
    }
    if (!paths.includes(to)) paths.push(to);
  }
  return paths;
}

function writeEvidence(evidenceDir, status, details) {
  const lines = [
    '# MILAN RSI Repair Proposal',
    '',
    `Status: ${status}`,
    `Source run: ${report.sourceRunId || process.env.GITHUB_RUN_ID || 'manual/unknown'}`,
    `Failure rows: ${failures.length}`,
    `Repository: ${repoFor()}`,
    '',
    'This is a candidate in an isolated worktree. It is not applied to main and is not a production deployment.',
    '',
    details || ''
  ];
  fs.writeFileSync(path.join(evidenceDir, 'latest-repair.md'), lines.join('\n') + '\n');
}

async function main() {
  const repo = repoFor();
  const workRoot = path.join(os.tmpdir(), 'milan-rsi');
  const worktree = path.join(workRoot, repo.split('/')[1]);
  const evidenceDir = path.join(root, 'evidence');
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const failureText = failures.slice(0, 30).map(row => JSON.stringify({
    caseId: row.caseId,
    environment: row.environment,
    scenario: row.scenario,
    action: row.action,
    error: row.error
  })).join('\n');
  const localBaseURL = process.env.RSI_BASE_URL;
  const client = new OpenAI({
    apiKey: localBaseURL ? 'ollama' : process.env.OPENAI_API_KEY,
    ...(localBaseURL ? { baseURL: localBaseURL } : {})
  });

  if (!fs.existsSync(path.join(worktree, '.git'))) {
    fs.rmSync(worktree, { recursive: true, force: true });
    sh(`git clone https://github.com/${repo}.git "${worktree}"`);
  } else {
    sh('git fetch origin && git checkout main && git reset --hard origin/main', worktree);
  }

  const prompt = `You are the MILAN recursive self-improvement coding agent.
Repository: ${repo}

SOURCE RUN: ${report.sourceRunId || 'unknown'}
FAILURES:
${failureText}

SOURCE:
${sourceContext(worktree)}

Return ONLY JSON with keys summary and patch. The patch must be a valid unified git diff with diff --git headers. Make the smallest correct production-quality fix and add a regression test when practical. Do not invent or expose secrets. Do not modify .github/workflows, .github/actions, environment/secret/credential files, keys, or certificates. A repair proposal is not a deployment.`;
  // Create evidence before the API request so quota/network/model failures are visible
  // in the workflow artifact rather than leaving an empty evidence directory.
  writeEvidence(
    evidenceDir,
    'ANALYSIS_STARTED',
    `Source evidence parsed. Preparing analysis request; failure rows: ${failures.length}.`
  );

  let response;
  try {
    response = await client.responses.create({
      model: process.env.RSI_MODEL || 'gpt-5',
      input: prompt
    });
  } catch (error) {
    const status = Number(error.status || error.statusCode || 0);
    const message = String(error.message || error).replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]').slice(0, 1200);
    writeEvidence(
      evidenceDir,
      'ANALYSIS_FAILED',
      `OpenAI request failed (HTTP ${status || 'unknown'}): ${message}\n\nNo candidate patch was generated. Check local model availability or, for OpenAI API mode, project billing, credits, permissions, and model access.`
    );
    throw error;
  }

  const result = parseJson(response.output_text.trim());
  if (typeof result.patch !== 'string' || !result.patch.includes('diff --git ')) {
    throw new Error('No usable patch returned by the model.');
  }

  const patchEvidencePath = path.join(evidenceDir, 'latest-repair.patch');
  fs.writeFileSync(patchEvidencePath, result.patch);
  writeEvidence(evidenceDir, 'PROPOSAL_GENERATED', String(result.summary || 'No summary returned by the model.'));

  try {
    const changedPaths = validatePatchPaths(result.patch);
    const patchPath = path.join(workRoot, 'repair.patch');
    fs.writeFileSync(patchPath, result.patch);
    sh(`git apply --check "${patchPath}"`, worktree);
    sh(`git apply "${patchPath}"`, worktree);
    sh('git diff --check', worktree);

    for (const file of changedPaths.filter(name => /\.(js|mjs|cjs)$/.test(name))) {
      if (fs.existsSync(path.join(worktree, file))) sh(`node --check "${file}"`, worktree);
    }

    const rootPackagePath = path.join(worktree, 'package.json');
    if (fs.existsSync(rootPackagePath)) {
      if (fs.existsSync(path.join(worktree, 'package-lock.json'))) {
        sh('npm ci --no-audit --no-fund', worktree);
      } else {
        sh('npm install --no-audit --no-fund', worktree);
      }
      const scripts = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8')).scripts || {};
      if (scripts.build) sh('npm run build', worktree);
      if (scripts.test) sh('npm test', worktree);
      if (scripts['test:chat']) sh('npm run test:chat', worktree);
    }

    if (fs.existsSync(path.join(worktree, 'Milan-Sentinel', 'package.json'))) {
      sh('npm ci --no-audit --no-fund --prefix Milan-Sentinel', worktree);
      sh('npm run validate --prefix Milan-Sentinel', worktree);
      sh('npm run smoke --prefix Milan-Sentinel', worktree);
    }

    const candidateBranch = `rsi/repair-${Date.now()}`;
    sh(`git checkout -b ${candidateBranch}`, worktree);
    sh('git config user.name "MILAN RSI Agent" && git config user.email "milan-rsi-agent@users.noreply.github.com"', worktree);
    const filesToStage = changedPaths.map(file => `"${file}"`).join(' ');
    sh(`git add -A -- ${filesToStage} && git commit -m "RSI: validated repair proposal from Sentinel evidence"`, worktree);

    let pushed = false;
    if (process.env.RSI_AUTO_PUSH === 'true') {
      const token = process.env.MILAN_GH_TOKEN;
      if (!token) throw new Error('RSI_AUTO_PUSH=true requires MILAN_GH_TOKEN; refusing an unauthenticated push.');
      const pushEnv = {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
      };
      cp.execFileSync('git', ['push', '-u', 'origin', candidateBranch], {
        cwd: worktree,
        env: pushEnv,
        stdio: 'pipe',
        maxBuffer: 20 * 1024 * 1024
      });
      pushed = true;
    }

    writeEvidence(
      evidenceDir,
      'VALIDATED_CANDIDATE',
      `Summary: ${String(result.summary || 'No summary returned by the model.')}\n\nCandidate branch: ${candidateBranch}\nAuto-pushed: ${pushed}\nValidated in isolated worktree; not merged and not deployed.`
    );
    console.log(JSON.stringify({
      proposalGenerated: true,
      proposalValidated: true,
      repository: repo,
      candidateBranch,
      failures: failures.length,
      pushed,
      appliedToMain: false
    }));
  } catch (error) {
    writeEvidence(
      evidenceDir,
      'VALIDATION_FAILED',
      `Summary: ${String(result.summary || 'No summary returned by the model.')}\n\nError: ${String(error.message || error).slice(0, 2000)}\n\nCandidate remains unmerged and undeployed.`
    );
    throw error;
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
