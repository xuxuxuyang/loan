# API Mongo Consistency Safe Deployment Checklist

> Scope: code deployment, health checks, read-only verification, and code-only rollback. This checklist does not authorize any data operation.

## Deployment Candidate

- [ ] On the release candidate, run `git rev-parse HEAD`, record its output as the deployment SHA, and verify the deployed code matches it.
- [ ] Confirm the server runs exactly one PM2 API instance. If more than one instance is running, stop the deployment and evaluate the cross-instance write model before continuing.
- [ ] Read and confirm, without editing them: `MONGO_REFRESH_MODE=version`, `MONGODB_REQUIRED=true`, and `ALLOW_JSON_FALLBACK=false`.

## Deploy And Restart

- [ ] Deploy only the recorded application code and restart the API service.
- [ ] Do not run Mongo shell commands, imports, migrations, repair scripts, resets, deletions, cleanups, backfills, or any other Mongo data operation.
- [ ] Confirm the API responds after restart using only the audited requests below.

## Read-Only Service Verification

Use an HTTP client without browser navigation, cookies, or an Authorization header. Send both `x-tenant-id: default` and `x-workspace-type: tenant` explicitly for each request, with no query parameters. Confirm the response scope headers match those values. Do not substitute a tenant hostname or a non-default tenant header for this procedure.

- [ ] `GET /api/health`: confirm `data.status` is `up`, `data.persistence` is `mongodb`, and inspect the returned Mongo health information for errors. This route now skips snapshot hydration and only reads diagnostic counts/metadata; it cannot enter empty-scope seed persistence during this request.
- [ ] `GET /api/payment/lakala/config`: confirm the expected enabled/mock/channel configuration. This route skips hydration and reads configuration only; it neither queries payment status nor creates or settles a payment.

Both requests use public routes and the explicit default scope. `ensureTenantRegistered` returns immediately for `default`, before mutating metadata. A first request for another tenant can write `app_meta` even when its handler uses GET, so these checks do not authorize arbitrary tenant GET requests. The default-scope requests establish service availability; they do not verify another tenant's billing state.

Do not open the shop billing page: its mount hook can POST `/payment/lakala/sync-pending` and settle payments. Products, admin repayment-record pages, authenticated UI navigation, payment status, sync-pending, notifications, and test payments are outside this read-only checklist. Any tenant-specific business verification needs a separately audited procedure. No frontend source change is needed for these checks.

## Code-Only Rollback

- [ ] If rollback is required, roll back application code only and restart the API service. Never roll back, overwrite, or delete Mongo data.
