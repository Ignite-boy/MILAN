# MILAN RSI Agent

Bounded regression diagnosis and repair-proposal tooling for the consolidated `Ignite-boy/MILAN` repository.

## Safety contract

- Every invocation runs one bounded analysis cycle; it does not recursively schedule another cycle.
- When triggered by a failed `MILAN Sentinel` workflow, it downloads and merges evidence artifacts from that exact source run. Missing, malformed, or failure-free evidence is rejected instead of silently falling back to stale reports.
- Manual invocations run the Sentinel matrix validator and representative smoke checks before proposing a repair.
- Generated repairs target `Ignite-boy/MILAN`, not the deleted pre-consolidation repositories.
- A repair candidate is applied and tested only in an isolated temporary worktree. It is not merged or deployed. By default, `RSI_AUTO_PUSH=false`; a successful candidate is not the same as a green production branch.
- Automated patches that touch GitHub workflow/action definitions, environment/secret/credential files, or key/certificate files are rejected. Candidate paths are checked before patch application.
- Candidate patches and status reports are preserved as `evidence/latest-repair.patch` and `evidence/latest-repair.md`, including when candidate validation fails.
- A green matrix validator proves the theoretical test-space definition only. Review PASS/FAIL/SKIP evidence; the 10-million count is not a claim that all 10 million cases were executed.
- `OPENAI_API_KEY` is required only when an automated repair proposal is requested. It must be stored as a GitHub Actions repository secret, never in source code or logs.
- Run `npm test --prefix Milan-RSI-Agent` to test green-path, red-path, and triggering-run evidence behavior without calling the external API.

The canonical workflow is `.github/workflows/milan-rsi-agent.yml`. It can be run manually or will inspect a failed Sentinel run on `main`. The duplicate 15-minute RSI workflow is intentionally removed so a single canonical workflow owns this behavior.
