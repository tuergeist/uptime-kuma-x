# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Uptime Kuma is a self-hosted monitoring tool for HTTP(s), TCP, DNS, Docker, etc. Built with Vue 3 (frontend) and Node.js/Express (backend), using Socket.IO for real-time communication.

**This fork is being transformed into a multi-tenant SaaS platform.**

**Key Documents:**
- `uptime-kuma-multitenancy-plan.md` - Architecture and design decisions
- `IMPLEMENTATION_PLAN.md` - Step-by-step implementation tracker (update regularly!)

## Multi-Tenancy Transformation

### Target Architecture
- **Approach:** Shared database, shared schema with `tenant_id` column
- **Database:** PostgreSQL (migrating from SQLite)
- **Workers:** Distributed monitor execution with Redis pub/sub
- **Billing:** Stripe integration for subscription management

### Key Changes in Progress
1. Add `tenant_id` to core tables (user, monitor, status_page, tag, notification, setting)
2. Tenant resolution middleware (subdomain, custom domain, header, JWT)
3. Socket.IO room scoping: `tenant:{id}:user:{id}`
4. TenantQuery helper class for all database queries
5. Plan limit enforcement (monitor count, check interval, retention)
6. Worker architecture for horizontal scaling

### New Tables
- `tenant` - Core tenant entity with Stripe IDs
- `tenant_domain` - Custom domain mappings
- `plan` - Subscription plans with limits
- `usage` - Per-tenant usage tracking
- `audit_log` - Compliance logging

### Key Files to Modify
| File | Purpose |
|------|---------|
| `server/server.js` | Tenant middleware, room scoping |
| `server/database.js` | PostgreSQL connection pooling |
| `server/model/monitor.js` | Tenant-aware queries |
| `src/mixins/socket.js` | Frontend tenant context |
| `server/socket-handlers/*.js` | Tenant scoping on all handlers |

### New Files to Create
- `server/middleware/tenant.js` - Tenant resolution
- `server/billing/*.js` - Stripe integration
- `server/worker/*.js` - Monitor worker processes
- `server/redis-pubsub.js` - Cross-server messaging
- `src/pages/Billing.vue` - Subscription management UI

## Build & Development Commands

### Prerequisites
- Node.js >= 20.4.0
- npm >= 9.3
- Docker & Docker Compose (for multi-tenancy development)

### Multi-Tenancy Development (Recommended)

```bash
# Start PostgreSQL + Redis + App with Docker Compose
docker-compose -f docker/docker-compose-mt.yml up -d

# Start with optional tools (pgAdmin, Redis Commander)
docker-compose -f docker/docker-compose-mt.yml --profile tools up -d

# View logs
docker-compose -f docker/docker-compose-mt.yml logs -f app

# Stop all services
docker-compose -f docker/docker-compose-mt.yml down

# Reset database (delete volumes)
docker-compose -f docker/docker-compose-mt.yml down -v
```

**Services:**
- App: http://localhost:3001 (backend) / http://localhost:3000 (frontend)
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- pgAdmin: http://localhost:5050 (optional, `--profile tools`)

### Standard Commands (Single-Tenant/SQLite)

```bash
npm ci                    # Install dependencies (NOT npm install)
npm run dev               # Start dev server (frontend:3000, backend:3001)
npm run build             # Build frontend to dist/
npm run lint              # Run ESLint + Stylelint
npm run lint:prod         # Lint with zero warnings tolerance
npm run test-backend      # Backend unit tests
npm test                  # All tests (requires build first)
npm run test-e2e          # Playwright E2E tests
```

### Running Frontend and Backend Separately

```bash
npm run start-frontend-dev    # Frontend only (port 3000)
npm run start-server-dev      # Backend only (port 3001)
```

## Architecture

### Communication Pattern
Most backend logic uses **Socket.IO** (not REST APIs). Socket handlers are in `server/socket-handlers/`. Express.js serves static files and status page APIs.

### Directory Structure

```
server/                   # Backend (Node.js/Express)
├── model/               # Database models (auto-mapped to tables)
├── monitor-types/       # Monitor implementations (dns.js, tcp.js, etc.)
├── notification-providers/  # Notification integrations (90+)
├── socket-handlers/     # Socket.IO event handlers (main backend logic)
├── routers/            # Express routers
├── server.js           # Entry point
└── uptime-kuma-server.js   # Main server class

src/                     # Frontend (Vue 3 SPA)
├── components/         # Vue components
├── pages/              # Page components
├── lang/               # i18n translations (en.json is source)
├── mixins/socket.js    # Frontend data and socket logic
└── router.js           # Vue Router config

db/knex_migrations/      # Database migrations (Knex.js)
config/                  # Build configs (vite, playwright)
```

### Database
- Primary: SQLite (also supports MariaDB/MySQL/PostgreSQL)
- Migrations: `db/knex_migrations/` using Knex.js
- Migration filename format validated by CI

## Infrastructure & Deployment

### Kubernetes Cluster
- **Type**: Talos Linux (self-hosted), 2 nodes (cp-1, worker-1)
- **Version**: Kubernetes v1.34.0
- **Kubeconfig**: `~/.ssh/talos-kubeconfig.yaml`
- **IMPORTANT**: Always use `kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml`

### Environments

| Environment | Namespace | URL | Image Tag | Trigger |
|-------------|-----------|-----|-----------|---------|
| Staging | `uptimehive-staging` | staging.uptimehive.com | `staging` | Push to master |
| Production | `uptimehive` | uptimehive.com | `production` | Push v* tag |

### Deployment Structure

```
k8s/
├── base/                 # Shared resources (NO hardcoded namespace)
│   ├── deployment.yaml
│   ├── worker-deployment.yaml
│   ├── postgresql.yaml
│   ├── redis.yaml
│   ├── backup-cronjob.yaml
│   └── ...
└── overlays/
    ├── staging/          # namespace, ingress, secrets for staging
    └── production/       # namespace, ingress, secrets for production
```

### Common kubectl Commands

```bash
# Check pods
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml get pods -n uptimehive-staging
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml get pods -n uptimehive

# View logs
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml logs -n uptimehive-staging deployment/uptime-kuma
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml logs -n uptimehive-staging deployment/uptime-kuma-worker

# Deploy manually (usually done by CI/CD)
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml apply -k k8s/overlays/staging/
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml apply -k k8s/overlays/production/

# Rollback
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml rollout undo deployment/uptime-kuma -n uptimehive

# Restart deployment
kubectl --kubeconfig ~/.ssh/talos-kubeconfig.yaml rollout restart deployment/uptime-kuma -n uptimehive-staging
```

### Backups

- **Storage**: AWS S3 `s3://uptimehive-backups/` (eu-central-1)
- **Prefixes**: `staging/` and `production/`
- **Schedule**: Daily at 2 AM UTC (CronJob)
- **Pre-deploy**: Automatic backup before each deployment
- **Retention**: 30 days in S3
- **IAM User**: `uptimehive-backup-writer` (write-only access)

### Secrets Management

**In Kubernetes (applied manually, NOT in git):**
- `backup-s3-secrets` - S3 credentials for backups
- `postgresql-secrets` - Database credentials
- `uptime-kuma-secrets` - App secrets (DB connection, Redis URL, APP_URL)

**In GitHub:**
- `KUBECONFIG` - Base64-encoded kubeconfig for deployments

**NEVER commit actual credentials to git.** Secret YAML files in overlays contain placeholders only.

### CI/CD Workflows

| Workflow | File | Trigger | Action |
|----------|------|---------|--------|
| Build | `docker-build.yml` | Push to master or v* tag | Build & push to ghcr.io |
| Deploy Staging | `deploy-staging.yml` | After build on master | Auto-deploy to staging |
| Deploy Production | `deploy-production.yml` | v* tag or manual | Deploy to production |

### Container Registry

- **Registry**: `ghcr.io/tuergeist/uptime-kuma-x`
- **Tags**: `master`, `staging`, `production`, `v1.0.0`, `sha-abc1234`

## Code Style

Strictly enforced by linters:
- 4 spaces indentation
- Double quotes
- Unix line endings (LF)
- Semicolons required
- JSDoc required for all functions/methods

### Naming Conventions
- JavaScript/TypeScript: camelCase
- SQLite columns: snake_case
- CSS/SCSS: kebab-case

## Adding New Features

### New Notification Provider
1. `server/notification-providers/PROVIDER_NAME.js` - Backend logic
2. `server/notification.js` - Register provider
3. `src/components/notifications/PROVIDER_NAME.vue` - Frontend UI
4. `src/components/notifications/index.js` - Register frontend
5. `src/lang/en.json` - Add translation keys

### New Monitor Type
1. `server/monitor-types/MONITOR_TYPE.js` - Backend logic
2. `server/uptime-kuma-server.js` - Register monitor type
3. `src/pages/EditMonitor.vue` - Frontend UI
4. `src/lang/en.json` - Add translation keys

## Translations

- Add keys to `src/lang/en.json` only
- Don't include other languages in PRs (managed via Weblate)
- Use `$t("key")` in Vue templates

## Known Issues

- `npm run tsc` shows 1400+ TypeScript errors - these don't affect builds
- Stylelint deprecation warnings are expected
- First run shows "db-config.json not found" - this is expected (starts setup wizard)

## Git Branches

- `master`: v2 development (default for new features)
- `1.23.X`: v1 maintenance (for v1/v2 bug fixes)
