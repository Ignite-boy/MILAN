# MILAN GCP Deployment Runbook

## Target architecture

- **MILAN Web and API:** Google Cloud Run, built from the repository Dockerfile.
- **MILAN DB:** Google Cloud SQL for PostgreSQL.
- **Container build and storage:** Cloud Build and Artifact Registry through Cloud Run source deployment.
- **Secrets:** Google Secret Manager, exposed to Cloud Run as environment variables.
- **Monitoring:** GitHub Actions health monitor pointed to the deployed Cloud Run URL.

## Prerequisites

1. The Google Cloud billing account and project must both report billing enabled.
2. Enable Cloud Run, Cloud SQL Admin, Cloud Build, Artifact Registry, Secret Manager, and IAM APIs as required by the chosen deployment path.
3. Create the Cloud SQL PostgreSQL instance and database.
4. Apply the reviewed SQL migrations in `backend/migrations/` with an authorized database owner. Do not assume an empty database is ready for the application.
5. Create the `MILAN_DATABASE_URL` secret in Secret Manager using a Cloud SQL-compatible connection configuration. Grant the Cloud Run runtime service account access to that secret and the Cloud SQL instance.
6. Configure GitHub repository variables for the project ID, region, Cloud Run service name, Cloud SQL connection name, Workload Identity Federation provider, deployer service account, and `GCP_CLOUD_RUN_URL`.
7. Keep `GCP_DEPLOY_ENABLED` and `GCP_DATABASE_READY` unset or false until the database schema, secret access, and service-account permissions have been verified.

## GitHub Actions deployment

The workflow `.github/workflows/milan-gcp-cloud-run.yml` runs build, security, and readiness checks before the gated deploy job. GitHub authentication uses Workload Identity Federation; do not add long-lived service-account JSON keys to the repository.

The smoothness monitor reads `GCP_CLOUD_RUN_URL`. Set this variable only after a Cloud Run service URL exists.

## Verification checklist

Verify all of the following against the deployed service before considering the migration complete:

- `/health` and `/api/health` respond successfully.
- `/api/ready` performs the expected live PostgreSQL readiness query.
- Registration, login, session revocation, profiles, chat, payments, records, resumable uploads, media playback and byte-range requests work.
- Data persists across a Cloud Run restart or new revision.
- The Cloud Run service uses the intended Cloud SQL database and Secret Manager secret.
- No active application, workflow, dependency or configuration path requires a retired external hosting or database platform.

Do not declare the migration complete until the GCP service and its database have been tested end-to-end.
