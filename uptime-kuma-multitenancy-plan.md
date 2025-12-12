# Uptime Kuma Multi-Tenancy Implementation Plan

## Executive Summary

This document outlines the comprehensive plan to transform Uptime Kuma from a single-tenant self-hosted application into a multi-tenant SaaS platform capable of serving thousands of customers at ~$0.25/monitor pricing.

**Estimated Effort:** 8-12 weeks for core multi-tenancy
**Target Architecture:** Shared database, shared schema with tenant_id column

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Multi-Tenancy Strategy](#2-multi-tenancy-strategy)
3. [Database Schema Changes](#3-database-schema-changes)
4. [Server-Side Modifications](#4-server-side-modifications)
5. [Frontend Changes](#5-frontend-changes)
6. [New Components](#6-new-components)
7. [Infrastructure Architecture](#7-infrastructure-architecture)
8. [Security Considerations](#8-security-considerations)
9. [Migration Strategy](#9-migration-strategy)
10. [Implementation Phases](#10-implementation-phases)

---

## 1. Current Architecture Analysis

### 1.1 Technology Stack
- **Backend:** Node.js + Express + Socket.io
- **Database:** SQLite (default) / MariaDB via Knex.js ORM
- **Frontend:** Vue 3 + Vite + Bootstrap 5
- **State Management:** Custom reactive mixin (`socket.js`, 880 lines)
- **Authentication:** JWT + bcrypt + TOTP 2FA

### 1.2 Current Data Model (26 Tables)

**Core Tables with User Scoping:**
| Table | user_id FK | Records |
|-------|------------|---------|
| monitor | ✅ | Primary entity |
| notification | ✅ | Alert channels |
| proxy | ✅ | HTTP proxies |
| docker_host | ✅ | Docker connections |
| api_key | ✅ | API access |
| maintenance | ✅ | Scheduled windows |

**Tables Requiring Tenant Scope:**
| Table | Current Scope | Change Needed |
|-------|---------------|---------------|
| user | Global | Add tenant_id |
| status_page | Global (by slug) | Add tenant_id |
| tag | Global | Add tenant_id |
| group | Via status_page | Implicit via status_page |
| setting | Global | Add tenant_id |
| incident | Via status_page | Implicit |

**Tables Scoped via Foreign Keys:**
- heartbeat → monitor_id → user_id (implicitly scoped)
- stat_minutely/hourly/daily → monitor_id
- monitor_notification, monitor_tag, monitor_group, etc.

### 1.3 Current Security Model

```
User authenticates → JWT issued → socket.userID set
                                       ↓
              socket.join(userID)  [Room isolation]
                                       ↓
              All queries: WHERE user_id = ?
                                       ↓
              checkOwner(userID, monitorID) on mutations
```

### 1.4 Key Files to Modify

| File | Lines | Purpose | Changes |
|------|-------|---------|---------|
| `server/server.js` | 1981 | Main server | Tenant middleware, room scoping |
| `server/database.js` | 392 | DB connection | PostgreSQL support |
| `server/model/monitor.js` | 2100+ | Monitor logic | Tenant-aware queries |
| `server/uptime-kuma-server.js` | 576 | Server singleton | Tenant context |
| `src/mixins/socket.js` | 880 | Frontend state | Tenant context |
| `db/knex_migrations/*` | 30 files | Schema | New tenant migrations |

---

## 2. Multi-Tenancy Strategy

### 2.1 Approach: Shared Schema with tenant_id

**Why This Approach:**
- Most cost-effective for small tenants ($0.25/monitor viable)
- Simpler operations (single database)
- Easier cross-tenant analytics
- Simpler backup/restore

**Trade-offs:**
- Must ensure query isolation everywhere
- Noisy neighbor risk (mitigated by worker architecture)
- Single point of failure (mitigated by PostgreSQL HA)

### 2.2 Tenant Resolution Flow

```
Request arrives
     ↓
┌────────────────────────────────┐
│ Tenant Resolution Middleware    │
│                                │
│ 1. Check subdomain             │
│    {tenant}.uptime.example.com │
│                                │
│ 2. Check custom domain         │
│    SELECT tenant_id FROM       │
│    tenant_domain WHERE domain  │
│                                │
│ 3. Check X-Tenant-ID header    │
│    (for API clients)           │
│                                │
│ 4. Extract from JWT            │
│    (for authenticated users)   │
└────────────────────────────────┘
     ↓
req.tenant = { id, slug, plan, settings }
     ↓
Proceed to route handler
```

### 2.3 Socket.io Room Structure

**Current:** `socket.join(userID)`
**New:** `socket.join(`tenant:${tenantID}:user:${userID}`)`

Additional rooms:
- `tenant:${tenantID}` - Tenant-wide broadcasts
- `tenant:${tenantID}:status-page:${slug}` - Public status page subscribers

---

## 3. Database Schema Changes

### 3.1 New Tables

```sql
-- Core tenant table
CREATE TABLE tenant (
    id              SERIAL PRIMARY KEY,
    slug            VARCHAR(63) UNIQUE NOT NULL,  -- subdomain
    name            VARCHAR(255) NOT NULL,
    status          VARCHAR(20) DEFAULT 'active', -- active, suspended, deleted
    plan_id         INTEGER REFERENCES plan(id),
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    settings        JSONB DEFAULT '{}',
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    deleted_at      TIMESTAMP
);
CREATE INDEX idx_tenant_slug ON tenant(slug);
CREATE INDEX idx_tenant_status ON tenant(status);

-- Custom domains for tenants
CREATE TABLE tenant_domain (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    domain          VARCHAR(255) UNIQUE NOT NULL,
    verified        BOOLEAN DEFAULT false,
    verification_token VARCHAR(64),
    ssl_status      VARCHAR(20) DEFAULT 'pending',
    created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_tenant_domain_domain ON tenant_domain(domain);

-- Subscription plans
CREATE TABLE plan (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(50) UNIQUE NOT NULL,
    monitor_limit   INTEGER,          -- NULL = unlimited
    check_interval_min INTEGER DEFAULT 60, -- Minimum seconds
    retention_days  INTEGER DEFAULT 30,
    status_pages_limit INTEGER DEFAULT 1,
    users_limit     INTEGER DEFAULT 1,
    price_monthly   DECIMAL(10,2),
    price_yearly    DECIMAL(10,2),
    stripe_price_id VARCHAR(255),
    features        JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true
);

-- Usage tracking for billing
CREATE TABLE usage (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenant(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    monitors_count  INTEGER DEFAULT 0,
    checks_count    BIGINT DEFAULT 0,
    notifications_sent INTEGER DEFAULT 0,
    api_calls       INTEGER DEFAULT 0,
    UNIQUE(tenant_id, period_start)
);
CREATE INDEX idx_usage_tenant_period ON usage(tenant_id, period_start);

-- Audit log for compliance
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL,
    user_id         INTEGER,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       INTEGER,
    old_values      JSONB,
    new_values      JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at DESC);
```

### 3.2 Modified Tables

```sql
-- Add tenant_id to user
ALTER TABLE user ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
ALTER TABLE user ADD COLUMN role VARCHAR(20) DEFAULT 'member'; -- owner, admin, member
CREATE INDEX idx_user_tenant ON user(tenant_id);

-- Add tenant_id to status_page
ALTER TABLE status_page ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
CREATE INDEX idx_status_page_tenant ON status_page(tenant_id);
-- Modify unique constraint: slug unique per tenant
ALTER TABLE status_page DROP CONSTRAINT status_page_slug_key;
ALTER TABLE status_page ADD CONSTRAINT status_page_tenant_slug_unique UNIQUE(tenant_id, slug);

-- Add tenant_id to tag (for tenant-specific tags)
ALTER TABLE tag ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
CREATE INDEX idx_tag_tenant ON tag(tenant_id);

-- Add tenant_id to setting (tenant-specific settings)
ALTER TABLE setting ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
-- Modify unique constraint
ALTER TABLE setting DROP CONSTRAINT setting_key_key;
ALTER TABLE setting ADD CONSTRAINT setting_tenant_key_unique UNIQUE(tenant_id, key);

-- Notification needs tenant_id for shared notification channels
ALTER TABLE notification ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
CREATE INDEX idx_notification_tenant ON notification(tenant_id);
```

### 3.3 Implicit Tenant Scoping (No Changes Needed)

These tables are already scoped via foreign keys:
- `monitor` → has user_id → user has tenant_id
- `heartbeat` → monitor_id → monitor → user → tenant
- `stat_*` → monitor_id → same chain
- `maintenance` → user_id
- `proxy`, `docker_host`, `api_key` → user_id

**However**, for query performance, add tenant_id directly:

```sql
-- Direct tenant_id for faster queries (denormalization)
ALTER TABLE monitor ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
CREATE INDEX idx_monitor_tenant ON monitor(tenant_id);
CREATE INDEX idx_monitor_tenant_active ON monitor(tenant_id, active);

ALTER TABLE heartbeat ADD COLUMN tenant_id INTEGER REFERENCES tenant(id);
CREATE INDEX idx_heartbeat_tenant_time ON heartbeat(tenant_id, time DESC);
```

### 3.4 PostgreSQL Row Level Security (Defense in Depth)

```sql
-- Enable RLS on critical tables
ALTER TABLE monitor ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;

-- Create policy (application sets current_tenant via SET)
CREATE POLICY tenant_isolation ON monitor
    USING (tenant_id = current_setting('app.current_tenant_id')::integer);

-- Application sets context before queries:
-- SET LOCAL app.current_tenant_id = '123';
```

---

## 4. Server-Side Modifications

### 4.1 Tenant Middleware

**New File:** `server/middleware/tenant.js`

```javascript
const tenantCache = new Map(); // LRU cache

async function resolveTenant(req, res, next) {
    let tenantSlug = null;

    // 1. Subdomain extraction
    const host = req.get('host');
    const subdomain = extractSubdomain(host);
    if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
        tenantSlug = subdomain;
    }

    // 2. Custom domain lookup
    if (!tenantSlug) {
        const domain = await lookupCustomDomain(host);
        if (domain) {
            req.tenant = domain.tenant;
            return next();
        }
    }

    // 3. Header (for API)
    if (!tenantSlug && req.headers['x-tenant-id']) {
        tenantSlug = req.headers['x-tenant-id'];
    }

    // 4. Load tenant
    if (tenantSlug) {
        req.tenant = await loadTenant(tenantSlug);
        if (!req.tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        if (req.tenant.status !== 'active') {
            return res.status(403).json({ error: 'Account suspended' });
        }
    }

    next();
}
```

### 4.2 Modified Query Patterns

**Current Pattern:**
```javascript
// server/client.js
let list = await R.find("monitor", " user_id = ? ", [socket.userID]);
```

**New Pattern:**
```javascript
// Create tenant-aware query helper
class TenantQuery {
    constructor(tenantId) {
        this.tenantId = tenantId;
    }

    async find(table, conditions = "", params = []) {
        const tenantCondition = `tenant_id = ?`;
        const fullCondition = conditions
            ? `${tenantCondition} AND (${conditions})`
            : tenantCondition;
        return R.find(table, fullCondition, [this.tenantId, ...params]);
    }

    async findOne(table, conditions = "", params = []) {
        const results = await this.find(table, conditions, params);
        return results[0] || null;
    }
}

// Usage in handlers
const tq = new TenantQuery(socket.tenantId);
let list = await tq.find("monitor", "user_id = ?", [socket.userID]);
```

### 4.3 Socket.io Modifications

**File:** `server/server.js`

```javascript
// Modified afterLogin function
async function afterLogin(socket, user) {
    // Load user's tenant
    const tenant = await R.findOne("tenant", " id = ? ", [user.tenant_id]);
    if (!tenant || tenant.status !== 'active') {
        throw new Error("Account not active");
    }

    socket.tenantId = tenant.id;
    socket.userID = user.id;
    socket.userRole = user.role;

    // Join tenant and user rooms
    socket.join(`tenant:${tenant.id}`);
    socket.join(`tenant:${tenant.id}:user:${user.id}`);

    // Create tenant-scoped query helper
    socket.tq = new TenantQuery(tenant.id);

    // Send tenant-scoped data
    await sendMonitorList(socket);
    // ... etc
}

// Modified event emission
function emitToUser(tenantId, userId, event, data) {
    io.to(`tenant:${tenantId}:user:${userId}`).emit(event, data);
}

function emitToTenant(tenantId, event, data) {
    io.to(`tenant:${tenantId}`).emit(event, data);
}
```

### 4.4 Modified Socket Handlers

**Example:** `server/socket-handlers/monitor-socket-handler.js` (new file, refactored from server.js)

```javascript
module.exports = (socket, server) => {
    // Add monitor
    socket.on("add", async (monitor, callback) => {
        try {
            checkLogin(socket);

            // Check tenant limits
            const count = await socket.tq.count("monitor");
            const plan = await getTenantPlan(socket.tenantId);
            if (plan.monitor_limit && count >= plan.monitor_limit) {
                throw new Error(`Monitor limit reached (${plan.monitor_limit})`);
            }

            // Validate interval against plan
            if (monitor.interval < plan.check_interval_min) {
                monitor.interval = plan.check_interval_min;
            }

            let bean = R.dispense("monitor");
            bean.tenant_id = socket.tenantId;  // NEW
            bean.user_id = socket.userID;
            // ... rest of fields

            await R.store(bean);

            // Update usage
            await incrementUsage(socket.tenantId, 'monitors_count', 1);

            callback({ ok: true, monitorID: bean.id });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    // Edit monitor
    socket.on("editMonitor", async (monitor, callback) => {
        try {
            checkLogin(socket);

            // Tenant-scoped ownership check
            let bean = await socket.tq.findOne("monitor", "id = ?", [monitor.id]);
            if (!bean) {
                throw new Error("Monitor not found");
            }
            if (bean.user_id !== socket.userID && socket.userRole !== 'admin') {
                throw new Error("Permission denied");
            }

            // ... update logic
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });
};
```

### 4.5 Monitor Execution Architecture

**Current:** Single process runs all monitors via `setInterval`
**New:** Distributed worker architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      API Server(s)                          │
│  - Handles HTTP/Socket.io                                   │
│  - No monitor execution                                     │
│  - Manages monitor CRUD                                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ PostgreSQL
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Monitor Queue Table                       │
│  monitor_id | next_check_at | claimed_by | claimed_at       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Worker 1 │    │ Worker 2 │    │ Worker 3 │
        │          │    │          │    │          │
        │ Claims   │    │ Claims   │    │ Claims   │
        │ monitors │    │ monitors │    │ monitors │
        │ executes │    │ executes │    │ executes │
        │ checks   │    │ checks   │    │ checks   │
        └──────────┘    └──────────┘    └──────────┘
```

**New File:** `server/worker/monitor-worker.js`

```javascript
class MonitorWorker {
    constructor(workerId) {
        this.workerId = workerId;
        this.running = true;
    }

    async run() {
        while (this.running) {
            // Claim batch of due monitors
            const monitors = await this.claimMonitors(10);

            // Execute checks in parallel
            await Promise.all(monitors.map(m => this.executeCheck(m)));

            // Small delay if no work
            if (monitors.length === 0) {
                await sleep(1000);
            }
        }
    }

    async claimMonitors(limit) {
        // Atomic claim with PostgreSQL
        return await R.getAll(`
            UPDATE monitor_schedule
            SET claimed_by = ?, claimed_at = NOW()
            WHERE id IN (
                SELECT id FROM monitor_schedule
                WHERE next_check_at <= NOW()
                AND (claimed_by IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes')
                ORDER BY next_check_at
                LIMIT ?
                FOR UPDATE SKIP LOCKED
            )
            RETURNING monitor_id
        `, [this.workerId, limit]);
    }

    async executeCheck(monitorId) {
        const monitor = await R.findOne("monitor", " id = ? ", [monitorId]);
        // ... execute check logic from model/monitor.js
        // ... save heartbeat
        // ... emit via Redis pub/sub to API servers
    }
}
```

### 4.6 Redis for Real-Time Cross-Server Communication

```javascript
// server/redis-pubsub.js
const Redis = require('ioredis');

const publisher = new Redis(process.env.REDIS_URL);
const subscriber = new Redis(process.env.REDIS_URL);

// Worker publishes heartbeat
async function publishHeartbeat(tenantId, userId, heartbeat) {
    await publisher.publish('heartbeat', JSON.stringify({
        tenantId,
        userId,
        heartbeat
    }));
}

// API server subscribes and emits to Socket.io
subscriber.subscribe('heartbeat');
subscriber.on('message', (channel, message) => {
    if (channel === 'heartbeat') {
        const { tenantId, userId, heartbeat } = JSON.parse(message);
        io.to(`tenant:${tenantId}:user:${userId}`).emit('heartbeat', heartbeat);
    }
});
```

---

## 5. Frontend Changes

### 5.1 Tenant Context in Socket.js

**File:** `src/mixins/socket.js`

```javascript
data() {
    return {
        // Existing...
        loggedIn: false,
        username: null,

        // NEW: Tenant context
        tenant: null,
        tenantSlug: null,
        tenantPlan: null,
        tenantUsage: null,
    };
},

methods: {
    initSocketIO() {
        // Extract tenant from subdomain
        this.tenantSlug = this.extractTenantFromHost();

        // Connect with tenant context
        socket = io(url, {
            query: {
                tenant: this.tenantSlug
            }
        });

        // Handle tenant data
        socket.on("tenantInfo", (tenant) => {
            this.tenant = tenant;
            this.tenantPlan = tenant.plan;
        });

        socket.on("tenantUsage", (usage) => {
            this.tenantUsage = usage;
        });
    },

    extractTenantFromHost() {
        const host = window.location.hostname;
        const parts = host.split('.');
        if (parts.length >= 3) {
            return parts[0]; // subdomain
        }
        return null;
    }
}
```

### 5.2 Plan Limits in UI

**File:** `src/pages/EditMonitor.vue` (modifications)

```javascript
computed: {
    canAddMonitor() {
        if (!this.$root.tenantPlan?.monitor_limit) return true;
        return this.$root.tenantUsage?.monitors_count < this.$root.tenantPlan.monitor_limit;
    },

    minCheckInterval() {
        return this.$root.tenantPlan?.check_interval_min || 20;
    }
},

methods: {
    async submit() {
        if (!this.canAddMonitor && !this.isEdit) {
            toast.error(`Monitor limit reached. Upgrade your plan.`);
            return;
        }

        if (this.monitor.interval < this.minCheckInterval) {
            this.monitor.interval = this.minCheckInterval;
            toast.warning(`Minimum check interval is ${this.minCheckInterval}s on your plan.`);
        }

        // ... existing submit logic
    }
}
```

### 5.3 New Components

**`src/components/TenantUsage.vue`** - Usage dashboard widget
**`src/components/UpgradePrompt.vue`** - Plan upgrade CTA
**`src/pages/Billing.vue`** - Subscription management
**`src/pages/TeamMembers.vue`** - User management within tenant

### 5.4 Router Changes

```javascript
// src/router.js - Add new routes
{
    path: "/billing",
    component: Billing,
    meta: { requiresAuth: true, requiresOwner: true }
},
{
    path: "/team",
    component: TeamMembers,
    meta: { requiresAuth: true, requiresAdmin: true }
},
{
    path: "/usage",
    component: Usage,
    meta: { requiresAuth: true }
}
```

---

## 6. New Components

### 6.1 Billing Integration (Stripe)

**New Files:**
- `server/billing/stripe.js` - Stripe SDK wrapper
- `server/billing/webhook-handler.js` - Stripe webhooks
- `server/routers/billing-router.js` - Billing API endpoints

**Webhook Events to Handle:**
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

```javascript
// server/billing/stripe.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession(tenant, priceId) {
    return stripe.checkout.sessions.create({
        customer: tenant.stripe_customer_id,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.APP_URL}/billing?success=true`,
        cancel_url: `${process.env.APP_URL}/billing?canceled=true`,
        metadata: { tenant_id: tenant.id }
    });
}

async function createCustomerPortalSession(tenant) {
    return stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: `${process.env.APP_URL}/billing`
    });
}
```

### 6.2 Super Admin Panel

**New Route:** `/admin/*` (separate Vue app or same app with role check)

**Features:**
- Tenant list with search/filter
- Create/suspend/delete tenants
- View tenant usage and billing
- Impersonate tenant for support
- System health dashboard
- Background job monitoring

### 6.3 Tenant Onboarding Flow

```
1. User visits signup page
2. Enters: email, password, tenant name (generates slug)
3. Creates: tenant + user (role: owner)
4. Redirects to: {slug}.example.com/setup
5. Setup wizard: add first monitor, configure notifications
6. Dashboard with upgrade prompts
```

---

## 7. Infrastructure Architecture

### 7.1 Production Deployment

```
                    ┌─────────────────┐
                    │   Cloudflare    │
                    │  (DNS + CDN)    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Load Balancer  │
                    │   (nginx/ALB)   │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    ┌──────────┐       ┌──────────┐       ┌──────────┐
    │ API Pod 1│       │ API Pod 2│       │ API Pod 3│
    │ (Node.js)│       │ (Node.js)│       │ (Node.js)│
    └────┬─────┘       └────┬─────┘       └────┬─────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Redis   │  │PostgreSQL│  │  Redis   │
        │ (pub/sub)│  │ (Primary)│  │ (cache)  │
        └──────────┘  └────┬─────┘  └──────────┘
                           │
                    ┌──────▼──────┐
                    │ PostgreSQL  │
                    │ (Replica)   │
                    └─────────────┘

    ┌─────────────────────────────────────────────┐
    │            Worker Pool (Kubernetes)          │
    │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐│
    │  │Worker 1│ │Worker 2│ │Worker 3│ │Worker N││
    │  └────────┘ └────────┘ └────────┘ └────────┘│
    └─────────────────────────────────────────────┘
```

### 7.2 Database Sizing

**PostgreSQL Requirements:**
- Connection pooling via PgBouncer (100+ connections)
- Read replicas for dashboard queries
- Partitioning for heartbeat table by time
- Automatic vacuum tuning for high write load

**Estimated Storage (per 1000 tenants, 20 monitors each):**
- Monitors: ~20MB
- Heartbeats (30 days): ~10GB
- Statistics: ~1GB
- Total with indexes: ~15GB

### 7.3 Redis Usage

- **Session cache:** JWT token blacklist
- **Pub/Sub:** Real-time heartbeat distribution
- **Rate limiting:** Per-tenant API limits
- **Job queue:** Background tasks (notifications, cleanup)

---

## 8. Security Considerations

### 8.1 Tenant Isolation Checklist

- [ ] All SQL queries include tenant_id
- [ ] PostgreSQL RLS policies as backup
- [ ] Socket.io room names include tenant
- [ ] File uploads scoped to tenant directories
- [ ] API keys scoped to tenant
- [ ] Logs include tenant context
- [ ] Error messages don't leak cross-tenant data

### 8.2 Rate Limiting

```javascript
// Per-tenant rate limits
const rateLimits = {
    free: {
        api_requests_per_minute: 60,
        monitors_per_minute: 10,
        notifications_per_hour: 100
    },
    pro: {
        api_requests_per_minute: 300,
        monitors_per_minute: 50,
        notifications_per_hour: 1000
    }
};
```

### 8.3 Data Retention

- Free tier: 7 days heartbeat history
- Pro tier: 30 days
- Enterprise: 90 days
- Background job to purge old data

---

## 9. Migration Strategy

### 9.1 Database Migration Path

**Phase 1: Schema Changes (Zero Downtime)**
```sql
-- Add nullable tenant_id columns
ALTER TABLE user ADD COLUMN tenant_id INTEGER;
ALTER TABLE monitor ADD COLUMN tenant_id INTEGER;
-- ... other tables

-- Create tenant table
CREATE TABLE tenant (...);

-- Create default tenant for existing data
INSERT INTO tenant (slug, name) VALUES ('default', 'Default Tenant');

-- Backfill tenant_id
UPDATE user SET tenant_id = 1;
UPDATE monitor SET tenant_id = 1;
-- ... other tables

-- Add NOT NULL constraint
ALTER TABLE user ALTER COLUMN tenant_id SET NOT NULL;
```

**Phase 2: Add Foreign Keys and Indexes**
```sql
ALTER TABLE user ADD CONSTRAINT fk_user_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_user_tenant ON user(tenant_id);
-- ... etc
```

### 9.2 Code Deployment Strategy

1. **Blue-Green deployment** with feature flags
2. Enable multi-tenancy for new signups first
3. Migrate existing self-hosted users to "default" tenant
4. Gradually enable for existing users

---

## 10. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] PostgreSQL migration and connection pooling
- [ ] Create tenant, plan, usage tables
- [ ] Add tenant_id to core tables
- [ ] Tenant resolution middleware
- [ ] Basic tenant CRUD API

### Phase 2: Core Multi-Tenancy (Weeks 3-4)
- [ ] Modify all queries for tenant scoping
- [ ] Socket.io tenant rooms
- [ ] TenantQuery helper class
- [ ] Plan limit enforcement
- [ ] Frontend tenant context

### Phase 3: Worker Architecture (Weeks 5-6)
- [ ] Monitor scheduler table
- [ ] Worker process implementation
- [ ] Redis pub/sub for heartbeats
- [ ] Worker scaling configuration

### Phase 4: Billing & Admin (Weeks 7-8)
- [ ] Stripe integration
- [ ] Checkout flow
- [ ] Webhook handlers
- [ ] Customer portal
- [ ] Super admin panel

### Phase 5: Polish & Launch (Weeks 9-10)
- [ ] Onboarding flow
- [ ] Usage dashboard
- [ ] Documentation
- [ ] Performance testing
- [ ] Security audit

### Phase 6: Scale & Optimize (Weeks 11-12)
- [ ] Heartbeat table partitioning
- [ ] Query optimization
- [ ] Caching layer
- [ ] Monitoring & alerting
- [ ] Load testing

---

## Appendix A: Files to Modify

### Server Files
| File | Changes |
|------|---------|
| `server/server.js` | Tenant middleware, room changes |
| `server/database.js` | PostgreSQL connection |
| `server/uptime-kuma-server.js` | Tenant context |
| `server/model/monitor.js` | Tenant-aware queries |
| `server/model/user.js` | Tenant relationship |
| `server/client.js` | All query modifications |
| `server/auth.js` | Tenant in JWT |
| `server/socket-handlers/*.js` | Tenant scoping |
| `server/routers/api-router.js` | Tenant middleware |

### Frontend Files
| File | Changes |
|------|---------|
| `src/mixins/socket.js` | Tenant context, limits |
| `src/router.js` | New routes |
| `src/pages/EditMonitor.vue` | Plan limits |
| `src/components/Login.vue` | Tenant context |
| `src/layouts/Layout.vue` | Usage display |

### New Files
| File | Purpose |
|------|---------|
| `server/middleware/tenant.js` | Tenant resolution |
| `server/billing/*.js` | Stripe integration |
| `server/worker/*.js` | Monitor workers |
| `server/redis-pubsub.js` | Cross-server messaging |
| `src/pages/Billing.vue` | Subscription UI |
| `src/pages/TeamMembers.vue` | Team management |
| `db/knex_migrations/20XX-XX-XX-multitenancy.js` | Schema migration |

---

## Appendix B: Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/uptime_kuma
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID_PRO_MONTHLY=price_xxx
STRIPE_PRICE_ID_PRO_YEARLY=price_xxx

# Multi-tenancy
TENANT_DOMAIN=uptime.example.com
ENABLE_SIGNUP=true
DEFAULT_PLAN=free

# Workers
WORKER_COUNT=4
WORKER_ID=1
```

---

*Document Version: 1.0*
*Last Updated: 2024-12-10*
