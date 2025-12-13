# Worker Distribution Implementation Plan

## Current Status

Workers are starting and claiming monitors, but failing to execute HTTP/keyword/json-query monitors because these types are handled inline in `Monitor.beat()`, not through the `monitorTypeList` pattern.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DISTRIBUTED MODE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   API Server    │    │    Worker 1     │    │    Worker N     │         │
│  │   (server.js)   │    │  (worker/index) │    │  (worker/index) │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           │ Subscribe            │ Claim & Execute      │ Claim & Execute  │
│           ▼                      ▼                      ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                           REDIS                                  │       │
│  │  • heartbeat channel (worker → API server)                      │       │
│  │  • importantHeartbeat channel (worker → API server)             │       │
│  │  • monitorStats channel (worker → API server)                   │       │
│  │  • workerCommand channel (API server → workers)                 │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│           │                      │                      │                   │
│           │ Relay to Socket.IO   │ Store & Read         │                   │
│           ▼                      ▼                      ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                         POSTGRESQL                               │       │
│  │  • monitor_schedule: Atomic claiming with FOR UPDATE SKIP LOCKED │       │
│  │  • heartbeat: Check results                                      │       │
│  │  • stat_*: Uptime statistics                                     │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Issues to Fix

### Issue 1: HTTP/keyword/json-query monitors not supported
**Error:** `Unknown monitor type: http`

**Root Cause:** `executeMonitorType()` only handles types in `UptimeKumaServer.monitorTypeList`. HTTP monitors are handled inline in `Monitor.beat()`.

**Fix:** Add `Monitor.executeTypeCheck()` method that extracts check logic from `beat()`, then call it from `monitor-executor.js` for inline types.

### Issue 2: UptimeCalculator API mismatch
**Error:** `uptimeCalculator.get24HourUptime is not a function`

**Root Cause:** `heartbeat-processor.js` calls non-existent methods.

**Fix:** Use correct methods:
```javascript
// Wrong:
const uptime24h = await uptimeCalculator.get24HourUptime();

// Correct:
const uptime24hResult = uptimeCalculator.get24Hour(); // sync, returns UptimeDataResult
const uptime24h = uptime24hResult.uptime;
```

### Issue 3: PostgreSQL datetime syntax (potential)
**Location:** `heartbeat-processor.js` line 145

**Current:** `datetime('now', '-1 hour')` - SQLite syntax

**Fix:** Use database-agnostic approach or PostgreSQL syntax.

## Implementation Steps

### Phase 1: Fix UptimeCalculator API (Quick Win)

**File: `server/worker/heartbeat-processor.js`**

```javascript
// Before:
const uptime24h = await uptimeCalculator.get24HourUptime();
const uptime30d = await uptimeCalculator.get30DayUptime();

// After:
const uptime24hResult = uptimeCalculator.get24Hour();
const uptime30dResult = uptimeCalculator.get30Day();
const uptime24h = uptime24hResult.uptime;
const uptime30d = uptime30dResult.uptime;
```

### Phase 2: Fix PostgreSQL datetime syntax

**File: `server/worker/heartbeat-processor.js`**

```javascript
// Before:
WHERE time > datetime('now', '-1 hour')

// After (database-agnostic using dayjs):
const oneHourAgo = dayjs().subtract(1, 'hour').format('YYYY-MM-DD HH:mm:ss');
WHERE time > '${oneHourAgo}'
```

### Phase 3: Add Monitor.executeTypeCheck() method

**File: `server/model/monitor.js`**

Add a new method that extracts the check logic from `beat()`:

```javascript
/**
 * Execute a single type-specific check (for workers)
 * This is the check logic extracted from beat(), without scheduling/emitting
 *
 * @param {object} bean - Heartbeat bean to populate
 * @param {number} timeout - Timeout in seconds
 * @returns {Promise<{tlsInfo: object|null}>}
 */
async executeTypeCheck(bean, timeout) {
    let tlsInfo = null;

    if (this.type === "http" || this.type === "keyword" || this.type === "json-query") {
        // HTTP check logic (extracted from beat() lines 420-640)
        // ... all the OAuth, proxy, TLS, cookie handling
        tlsInfo = await this._executeHttpCheck(bean, timeout);
    } else if (this.type === "ping") {
        // Ping logic
    } else if (this.type === "docker") {
        // Docker logic
    }
    // ... other inline types

    return { tlsInfo };
}
```

### Phase 4: Update monitor-executor.js

**File: `server/worker/monitor-executor.js`**

```javascript
async function executeMonitorType(monitor, bean, timeout) {
    const type = monitor.type;
    let tlsInfo = undefined;

    // Types handled by MonitorType classes
    if (type in UptimeKumaServer.monitorTypeList) {
        // ... existing code
    }
    // Types handled inline in Monitor class
    else if (typeof monitor.executeTypeCheck === 'function') {
        const result = await monitor.executeTypeCheck(bean, timeout);
        tlsInfo = result.tlsInfo;
    }
    else {
        throw new Error(`Unknown monitor type: ${type}`);
    }

    return { tlsInfo };
}
```

## Monitor Type Classification

### Registered in monitorTypeList (workers support now):
- dns, postgres, mqtt, smtp, group, snmp, grpc-keyword, mongodb, rabbitmq
- port, manual, redis, real-browser, tailscale-ping, websocket-upgrade

### Inline in Monitor.beat() (need executeTypeCheck):
| Type | Priority | Lines in beat() |
|------|----------|-----------------|
| http | HIGH | 420-605 |
| keyword | HIGH | 606-626 |
| json-query | HIGH | 628-639 |
| ping | MEDIUM | 642-645 |
| push | LOW | 646-676 (passive) |
| steam | LOW | 678-719 |
| gamedig | LOW | 720-734 |
| docker | MEDIUM | 735-782 |
| sqlserver | MEDIUM | 783-790 |
| mysql | MEDIUM | 791-799 |

## Testing Plan

1. Deploy updated worker image
2. Check worker logs for successful HTTP check execution
3. Verify heartbeats appear in browser (via Redis relay)
4. Test keyword and json-query monitors
5. Test error scenarios (timeout, DNS failure, etc.)

## Files to Modify

| File | Changes |
|------|---------|
| `server/model/monitor.js` | Add `executeTypeCheck()` method |
| `server/worker/monitor-executor.js` | Call `executeTypeCheck()` for inline types |
| `server/worker/heartbeat-processor.js` | Fix UptimeCalculator API, fix SQL syntax |

## Rollback Plan

If issues occur:
1. Scale workers to 0: `kubectl scale deployment uptime-kuma-worker --replicas=0`
2. API server continues to work (just no distributed monitoring)
3. Revert image tag to previous version
