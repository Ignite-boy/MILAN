# MILAN A05: persistence failure visibility

Connection, access-request, comment, reaction and saved-post handlers now check
the result returned by `writeJsonAndSync`. Failed remote snapshot sync is reported
with HTTP 503 and `SNAPSHOT_SYNC_FAILED`, along with `localSaved: true` and
`cloudSynced: false`. Clients are advised to refresh before retrying because a
toggle can reverse a local mutation.

Local snapshots are written before remote sync. This change exposes partial
success but does not guarantee automatic retry or remote convergence. Tests use
mock responses and source contracts only; no production data is accessed.
