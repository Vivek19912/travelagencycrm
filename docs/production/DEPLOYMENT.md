# Deployment Runbook

How to deploy Interscale Travel CRM to a secure production environment. The
stack is three independent deploy units: **API** (Node), **Web** (static SPA),
and the **reminder worker** (a scheduled one-shot job).

> Cloud-neutral: AWS is the reference, but any equivalent (GCP, Azure, Fly,
> Render, a VPS + reverse proxy) works. Substitute the managed equivalents.

---

## 1. Required services

| Concern         | Reference (AWS)               | Neutral requirement                         |
| --------------- | ----------------------------- | ------------------------------------------- |
| Database        | RDS/Aurora PostgreSQL 16      | Managed PostgreSQL 16, private networking    |
| Object storage  | S3 (private bucket)           | S3-compatible, private, SSE enabled          |
| Email           | SES (SMTP)                    | SMTP relay with domain auth (SPF/DKIM/DMARC) |
| API runtime     | ECS Fargate / App Runner      | Container platform running `node`            |
| Web hosting     | S3 + CloudFront / Amplify     | Static host + CDN with SPA fallback          |
| Worker schedule | EventBridge Scheduler         | Cron / scheduled task invoking the job       |
| Secrets         | Secrets Manager / SSM         | A secrets store; never a committed file      |
| TLS             | ACM                           | Valid certificate, HTTPS end-to-end          |
| DNS             | Route 53                      | Any DNS provider                             |

Optional (deferred, see MONITORING.md): centralized logs, error monitoring,
a shared rate-limit store (Redis) — only needed before horizontal scaling.

## 2. Build artifacts

- API image: `docker build -f apps/api/Dockerfile -t <registry>/interscale-api:<tag> .`
  - Produces `apps/api/dist/server.js` (HTTP API) and
    `apps/api/dist/process-reminders.js` (worker) inside one image.
- Web image: `docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t <registry>/interscale-web:<tag> .`
  - Or build the static bundle directly (`npm run build:web`) and upload
    `apps/web/dist/` to the static host/CDN.

## 3. Required environment variables

See `.env.example` (top block) for the authoritative list enforced by
`apps/api/src/config/env.ts`. Minimum for the API/worker in production:

```
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB
SESSION_SECRET=<openssl rand -base64 48>
TOKEN_PEPPER=<openssl rand -base64 48>
API_URL=https://api.example.com
WEB_URL=https://app.example.com
EMAIL_PROVIDER=smtp
EMAIL_FROM="Interscale Travel CRM <no-reply@example.com>"
SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASSWORD=...
STORAGE_PROVIDER=s3
AWS_REGION=ap-south-1
AWS_S3_BUCKET=interscale-prod
DATA_ENCRYPTION_KEY=<openssl rand -base64 32>
DATA_ENCRYPTION_KEY_VERSION=v1
```

Web build needs `VITE_API_URL=https://api.example.com` at build time.

## 4. Secrets management

- Store `SESSION_SECRET`, `TOKEN_PEPPER`, `DATA_ENCRYPTION_KEY`, DB and SMTP
  credentials in a secrets manager; inject as environment variables at deploy.
- Never bake secrets into an image or commit them. `.env` is git-ignored and
  `.dockerignore`-excluded.
- Rotating `TOKEN_PEPPER` invalidates all active sessions, pending OTPs and
  reset/public links (they stop verifying). `DATA_ENCRYPTION_KEY` rotation is
  versioned via `DATA_ENCRYPTION_KEY_VERSION`.

## 5. Database provisioning

- Create a PostgreSQL 16 instance on a private subnet; allow inbound only from
  the API/worker security group. Enable automated backups + PITR (see
  BACKUP_AND_RESTORE.md). Set a connection pooler (RDS Proxy / PgBouncer) and a
  sane `connection_limit` in `DATABASE_URL` for the number of app instances.

## 6. S3 provisioning

- Private bucket, **Block Public Access = ON**, default SSE (`AES256` or KMS).
- Attach a least-privilege IAM role to the API/worker: `s3:GetObject`,
  `PutObject`, `DeleteObject`, `HeadObject` scoped to the bucket ARN. With an
  IAM role, leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` unset.
- See SECURITY_CHECKLIST.md.

## 7. SMTP / SES provisioning

- Verify the sending domain; publish SPF, DKIM, DMARC. Move SES out of sandbox.
- Use port 587 (STARTTLS) or 465 (implicit TLS). Set `SMTP_USER`/`SMTP_PASSWORD`.

## 8. Migration step (run BEFORE rolling the API)

Migrations are forward-only and never run automatically on API start.

```
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Run it from the API image's `builder` stage (it has the Prisma CLI + schema),
or the `migrate` service in `docker-compose.production.example.yml`. Take a
pre-deploy database snapshot first (ROLLBACK.md).

## 9. API deployment

- Roll the new API image. Env from the secrets store. The container exposes port
  4000 and has a `HEALTHCHECK` on `/api/health`.
- Point the load balancer health check at `/api/health` (liveness) and,
  optionally, a deeper check at `/api/health/db` (readiness).

## 10. Web deployment

- Build with the production `VITE_API_URL`, upload `apps/web/dist/` to the CDN
  (or roll the web image). Invalidate the CDN cache for `index.html`.
- Keep web + API on the same registrable domain so the `SameSite=Lax` session
  cookie is sent (`app.example.com` + `api.example.com`).

## 11. Worker scheduling

- Schedule `node apps/api/dist/process-reminders.js` every few minutes via an
  external scheduler (EventBridge Scheduler, cron, k8s CronJob). There is no
  in-process timer by design.
- Overlap-safe: a PostgreSQL advisory lock ensures only one run processes at a
  time; a concurrent run logs and exits 0. Do not schedule more frequently than
  a run typically takes.

### 11a. Weblink PDF browser (headless Chromium)

- The Weblink PDF style renders the real public quotation page in headless
  Chromium (Playwright). Classic/Stylish need no browser; Weblink fails hard
  without one, so every host that serves the API needs a compatible browser.
- Containers already install it (`playwright install --with-deps chromium` in
  `apps/api/Dockerfile`). On bare-metal/EC2 hosts install the pinned
  Playwright Chromium plus OS libs, then verify with:
  `npm run doctor:weblink-pdf --workspace @interscale/api`.
  On distros Playwright does not support (e.g. Ubuntu 26.04 with old
  Playwright), install the browser build matching the pinned driver revision
  manually and provide the system libs via apt.

## 12. Health checks

- **Liveness**: `GET /api/health` — no I/O, never depends on the database.
- **Readiness**: `GET /api/health/db` — runs a real query, returns `503` when
  the database is unreachable.
- Web: `GET /healthz` on the web container returns `200 ok`.

## 13. Smoke tests

After deploy, run:

```
API_BASE_URL=https://api.example.com WEB_BASE_URL=https://app.example.com \
  npm run smoke:prod
```

Optionally set `SMOKE_EMAIL`/`SMOKE_PASSWORD` (a low-privilege test account) to
exercise the login → `/me` → logout round-trip. The smoke test never writes
business data. See `scripts/production-smoke-test.mjs`.

## 14. Rollback

See ROLLBACK.md. In short: redeploy the previous image; restore the database
only if a migration is not backward-compatible. Always snapshot before deploy.

## 15. Common failure scenarios

| Symptom                              | Likely cause / fix                                        |
| ------------------------------------ | --------------------------------------------------------- |
| API exits immediately on boot        | Env validation failed — read the logged list; fix env.    |
| Login works, then requests 401       | Web/API cross-site — put both on one registrable domain.  |
| CSRF 403 on state-changing requests  | Missing `Origin`/CSRF header; check reverse-proxy headers.|
| Uploads fail                         | S3 IAM policy or bucket region/name; check `AWS_*`.       |
| No OTP / reset emails                 | SMTP creds, SES sandbox, or SPF/DKIM; check API logs.     |
| Reminders never fire                  | No external scheduler invoking the worker job.            |
| Rate limits behave oddly after scale  | In-memory limiter is per-instance (see MONITORING.md).    |
