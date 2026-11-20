# NaijaPages Business Discovery — Cloudflare Queues & Cron Triggers (Phase 2)

This guide documents the Cloudflare Queues, Dead-Letter Queues (DLQs), Cron Triggers, and job orchestration architecture powering NaijaPages' asynchronous business discovery pipeline.

---

## 1. Queue & Dead-Letter Queue Topology

Separate queues isolate development from production so test runs never touch live data:

| Environment | Primary Queue | Dead-Letter Queue (DLQ) | Worker Binding |
| --- | --- | --- | --- |
| **Development** (`--env development`) | `naijapages-discovery-dev` | `naijapages-discovery-dev-dlq` | `DISCOVERY_QUEUE` |
| **Production** (`--env production`) | `naijapages-discovery` | `naijapages-discovery-dlq` | `DISCOVERY_QUEUE` |

- **Source of truth**: Cloudflare D1 (`discovery_jobs`) stores full job state, filters, counters, and error context.
- **Queue message payload (`schemaVersion: 1`)**: Compact pointer only (`schemaVersion`, `jobId`, `jobType`, `enqueuedAt`, `correlationId`, max 2048 bytes). Business records are **never** stored in queue messages.

---

## 2. Wrangler Configuration (`wrangler.toml`)

### Production (`[env.production]` and top-level fallback)
```toml
[[env.production.queues.producers]]
binding = "DISCOVERY_QUEUE"
queue = "naijapages-discovery"

[[env.production.queues.consumers]]
queue = "naijapages-discovery"
max_batch_size = 5
max_batch_timeout = 15
max_retries = 3
retry_delay = 60
dead_letter_queue = "naijapages-discovery-dlq"
max_concurrency = 2

# 01:00 UTC = 02:00 Africa/Lagos (WAT, UTC+1 year-round; Nigeria has no DST).
[env.production.triggers]
crons = ["0 1 * * *"]
```

### Development (`[env.development]`)
```toml
[[env.development.queues.producers]]
binding = "DISCOVERY_QUEUE"
queue = "naijapages-discovery-dev"

[[env.development.queues.consumers]]
queue = "naijapages-discovery-dev"
max_batch_size = 5
max_batch_timeout = 5
max_retries = 3
retry_delay = 30
dead_letter_queue = "naijapages-discovery-dev-dlq"
max_concurrency = 1

[env.development.triggers]
crons = ["0 1 * * *"]
```

### Cron Timezone Note (UTC vs Africa/Lagos)
Cloudflare Cron Triggers **always execute in UTC**. Nigeria observes West Africa Time (**WAT = UTC+1**) year-round with no Daylight Saving Time. Therefore:

- **`0 1 * * *`** (01:00 UTC) executes reliably at **02:00 Africa/Lagos** every day.

---

## 3. Cloudflare Resource Creation Commands

> **Note:** Cloudflare Queues requires a Workers Paid plan. Do not run production creation or deployment commands until you are ready to provision the production environment.

### Development / Staging Queues
```bash
npx wrangler queues create naijapages-discovery-dev
npx wrangler queues create naijapages-discovery-dev-dlq
```

### Production Queues (run explicitly when provisioning production)
```bash
npx wrangler queues create naijapages-discovery
npx wrangler queues create naijapages-discovery-dlq
```

Verify queues exist in your account:
```bash
npx wrangler queues list
```

---

## 4. Feature Flags & Disabling / Pausing Discovery

All discovery automation is **disabled by default** in `wrangler.toml` so deploying the Worker never starts discovery accidentally:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCOVERY_ENABLED` | `"false"` | Master kill-switch for queue job execution and scheduling. |
| `DISCOVERY_SCHEDULER_ENABLED` | `"false"` | Independent toggle for daily Cron Trigger job creation (requires `DISCOVERY_ENABLED = "true"`). |
| `DISCOVERY_DRY_RUN` | `"true"` | Runs orchestration safely without writing discovered records or calling external sources. |
| `DISCOVERY_MAX_JOBS_PER_RUN` | `"5"` | Maximum jobs created/enqueued per scheduled cron execution (clamped `1..50`). |
| `DISCOVERY_MAX_ATTEMPTS` | `"3"` | Maximum attempts per D1 job before permanent failure / dead-letter routing (clamped `1..10`). |
| `DISCOVERY_STALE_JOB_TIMEOUT_MS` | `"900000"` | Milliseconds (15 min default) after which an interrupted `running` job is recovered automatically. |
| `DISCOVERY_MAX_QUEUED_BACKLOG` | `"100"` | Maximum active (`queued` + `running`) jobs allowed before the scheduler pauses new job creation. |

### How to Disable or Pause the Scheduler Immediately
1. Set `DISCOVERY_SCHEDULER_ENABLED = "false"` (to stop new scheduled jobs while draining existing queued work) or `DISCOVERY_ENABLED = "false"` (to pause both scheduling and queue processing globally) in `wrangler.toml` or via Cloudflare Dashboard Worker Variables.
2. Redeploy (`npm run cf:deploy:prod` when deploying production) or save the variable override in the Cloudflare Dashboard.
3. No unauthenticated public HTTP endpoints exist to trigger discovery.

---

## 5. Local Testing Commands

Run the full automated unit and Miniflare D1 integration test suite (no external network requests):
```bash
npm run cf:test
```

Run only the Phase 2 queue & cron orchestration tests:
```bash
npx tsx --test worker/src/discoveryOrchestration.test.ts
```

Test the local Cron Trigger handler using Wrangler dev:
```bash
npx wrangler dev --env development --port 8787 --test-scheduled
```
In another terminal, trigger the scheduled handler locally:
```bash
curl "http://127.0.0.1:8787/__scheduled?cron=0+1+*+*+*"
```

Validate TypeScript types, Vite build, and Wrangler production dry-run:
```bash
npm run lint
npm run cf:validate
```

---

## 6. Inspecting Failures & Safely Replaying Failed Jobs

### Inspect Failed or Stale Jobs in D1
```bash
# Local D1
npx wrangler d1 execute DB --env development --local --command \
  "SELECT id, source_id, job_type, status, attempts, error_count, error_message, updated_at FROM discovery_jobs WHERE status IN ('failed', 'partially_completed', 'running') ORDER BY updated_at DESC LIMIT 25;"

# Remote Production D1 (read-only)
npx wrangler d1 execute DB --env production --remote --command \
  "SELECT id, source_id, job_type, status, attempts, error_count, error_message, updated_at FROM discovery_jobs WHERE status IN ('failed', 'partially_completed', 'running') ORDER BY updated_at DESC LIMIT 25;"
```

### Inspect Dead-Letter Queue (DLQ) Status
```bash
npx wrangler queues info naijapages-discovery-dlq
```
Or view DLQ backlog depth and consumer metrics in the Cloudflare Dashboard under **Workers & Pages → Queues → `naijapages-discovery-dlq`**.

### Safely Replay a Failed Job
1. Inspect `error_message` and `discovery_sources.permission_status` / `enabled` in D1 to confirm the underlying root cause is fixed (for example, source re-approved or transient upstream outage resolved).
2. Never edit a `failed` job directly to `completed`.
3. Use `retryDiscoveryJob(env.DB, env.DISCOVERY_QUEUE, jobId, { resetAttempts: true })` (exposed via future admin tooling) to atomically reset `status = 'queued'`, `attempts = 0`, `completed_at = NULL`, and enqueue a fresh pointer message with a new `correlationId`.
4. If a job was interrupted mid-execution by a Worker crash, `recoverStaleRunningJobs()` automatically re-queues it after `DISCOVERY_STALE_JOB_TIMEOUT_MS` (or marks it `failed` if `attempts >= DISCOVERY_MAX_ATTEMPTS`).

---

## 7. Cost & Operational Considerations

- **Workers Paid plan**: Cloudflare Queues requires Workers Paid ($5/month base), which includes 1 million queue operations per month (write + read + delete = 3 operations per message).
- **Conservative batching & concurrency**:
  - `max_batch_size = 5`, `max_concurrency = 2` (production) / `1` (development) bounds concurrent D1 writes and protects external data sources from burst traffic.
  - `DISCOVERY_MAX_JOBS_PER_RUN = "5"` and `DISCOVERY_MAX_QUEUED_BACKLOG = "100"` cap daily queue and D1 usage even if a source experiences prolonged outages.
- **No heavy work in Cron Triggers**: The scheduled handler performs only lightweight D1 reads/inserts and compact `queue.send(...)` calls, keeping CPU time well within Worker limits.
- **No secrets in logs or D1**: `sanitizeDiscoveryErrorMessage()` redacts bearer tokens, Cloudflare tokens, and key/secret parameters before writing `error_message` or emitting structured JSON logs.
