# MILAN RSI Agent

Bounded regression diagnosis and repair-proposal tooling for the consolidated `Ignite-boy/MILAN` repository.

## Safety contract

- Every invocation runs one analysis cycle; it does not recursively schedule another cycle.
- It reads Sentinel's latest evidence from `../Milan-Sentinel/reports/latest-results.json`.
- Generated repairs target `Ignite-boy/MILAN`, not the deleted pre-consolidation repositories.
- A repair branch is **not pushed** unless `RSI_AUTO_PUSH=true` is explicitly configured. The root GitHub Actions workflow sets it to `false`.
- A green matrix validator proves the theoretical test-space definition only. Review PASS/FAIL/SKIP evidence and run adapter-backed regressions before considering a repair verified.
- The AI key `OPENAI_API_KEY` is needed only when an automated repair proposal is requested; it must be stored as a GitHub secret.

Trigger the root workflow `.github/workflows/milan-rsi-agent.yml` manually or let it inspect a failed Sentinel run on `main`. The workflow uploads reports as artifacts and does not push code.
