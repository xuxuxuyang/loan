# API Mongo Consistency Safe Deployment Checklist

> Scope: code deployment, health checks, read-only verification, and code-only rollback. This checklist does not authorize any data operation.

## Deployment Candidate

- [ ] On the release candidate, run `git rev-parse HEAD`, record its output as the deployment SHA, and verify the deployed code matches it. API code baseline before this documentation commit: `b11162c1da6a99ddea293320f04c8915f7ecf3a8`.
- [ ] Confirm the server runs exactly one PM2 API instance. If more than one instance is running, stop the deployment and evaluate the cross-instance write model before continuing.
- [ ] Read and confirm, without editing them: `MONGO_REFRESH_MODE=version`, `MONGODB_REQUIRED=true`, and `ALLOW_JSON_FALLBACK=false`.

## Deploy And Restart

- [ ] Deploy only the recorded application code and restart the API service.
- [ ] Do not run Mongo shell commands, imports, migrations, repair scripts, resets, deletions, cleanups, backfills, or any other Mongo data operation.
- [ ] Confirm the API health endpoint responds successfully after the restart.

## Read-Only Service Verification

- [ ] Read the Lakala config endpoint and the products endpoint.
- [ ] Read the shop billing view and the admin repayment-record view; do not create, update, or delete business data during verification.
- [ ] Let the business owner control any test payment. Before opening full traffic, confirm API logs have no `refresh` or `persist` error.

## Rollback And Historical Exceptions

- [ ] If rollback is required, roll back application code only and restart the API service. Never roll back, overwrite, or delete Mongo data.
- [ ] For historical exceptions, produce only a read-only checklist containing `outTradeNo`, `orderId`, and current status. Do not repair, backfill, or otherwise alter historical data; any follow-up requires separate authorization.

## Sign-Off

- [ ] Deployment operator confirms every item above was completed without Mongo data operations.
- [ ] Business owner confirms the read-only UI and API verification results before full traffic is opened.
