# Multi-Tenancy Implementation Status

## Overview

This document tracks the implementation progress of the Uptime Kuma multi-tenancy transformation.

**Current Status:** Phase 4 Complete - Query Modifications
**Last Updated:** 2024-12-10

---

## Phase Completion Status

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 0 | Docker Infrastructure | ✅ Complete | PostgreSQL + Redis running |
| 1 | PostgreSQL Migration | ✅ Complete | Basic PostgreSQL support |
| 2 | Schema Changes | ✅ Complete | tenant_id columns added |
| 3 | Tenant Infrastructure | ✅ Complete | Middleware, helpers, socket integration |
| 4 | Query Modifications | ✅ Complete | All queries tenant-scoped |
| 5 | Worker Architecture | ⏳ Pending | Monitor execution scaling |
| 6 | Billing Integration | ⏳ Pending | Stripe integration |

---

## Phase 4 Details: Query Modifications

### Summary

All database queries have been updated to include `tenant_id` filtering for proper tenant isolation. The implementation follows a hybrid approach where tenant_id is passed explicitly to functions rather than using a global TenantQuery wrapper.

### Files Modified

#### Core Utilities
- [x] `server/utils/tenant-helpers.js` (NEW) - Tenant ID extraction helpers

#### Client Functions (`server/client.js`)
- [x] `sendNotificationList()` - Added tenant_id to query
- [x] `sendHeartbeatList()` - Added tenant_id to heartbeat query
- [x] `sendImportantHeartbeatList()` - Added tenant_id filter
- [x] `sendProxyList()` - Added tenant_id to proxy query
- [x] `sendDockerHostList()` - Added tenant_id to docker_host query
- [x] `sendRemoteBrowserList()` - Added tenant_id to remote_browser query
- [x] `sendAPIKeyList()` - Added tenant_id to api_key query

#### Main Server (`server/server.js`)
Socket Handlers Updated:
- [x] `editMonitor` - tenant_id in query
- [x] `getMonitor` - tenant_id in query
- [x] `getMonitorBeats` - tenant_id in heartbeat query
- [x] `deleteMonitor` - tenant_id in delete query
- [x] `editTag` - tenant_id in tag query
- [x] `deleteTag` - tenant_id in delete query
- [x] `monitorImportantHeartbeatListCount` - tenant_id added
- [x] `monitorImportantHeartbeatListPaged` - tenant_id added
- [x] `startMonitor` - Updated signature with tenantId
- [x] `restartMonitor` - Updated signature with tenantId
- [x] `pauseMonitor` - Updated signature with tenantId
- [x] `checkOwner()` - Updated to include tenant_id check

#### Monitor Model (`server/model/monitor.js`)
- [x] `deleteMonitor()` - tenant_id in delete query
- [x] `deleteMonitorRecursively()` - tenant_id in recursive delete

#### Supporting Services
- [x] `server/notification.js`
  - `save()` - tenant_id parameter and query
  - `delete()` - tenant_id parameter and query
  - `applyNotificationEveryMonitor()` - tenant-scoped
- [x] `server/proxy.js`
  - `save()` - tenant_id parameter and query
  - `delete()` - tenant_id parameter and query
  - `applyProxyEveryMonitor()` - tenant-scoped
- [x] `server/docker.js`
  - `save()` - tenant_id parameter
  - `delete()` - tenant_id parameter
- [x] `server/remote-browser.js`
  - `get()` - tenant_id parameter
  - `save()` - tenant_id parameter
  - `delete()` - tenant_id parameter

#### Socket Handlers (`server/socket-handlers/`)
- [x] `proxy-socket-handler.js` - Updated call sites
- [x] `docker-socket-handler.js` - Updated call sites
- [x] `remote-browser-socket-handler.js` - Updated call sites
- [x] `api-key-socket-handler.js` - Updated all queries
- [x] `maintenance-socket-handler.js` - All queries tenant-scoped
- [x] `status-page-socket-handler.js` - All queries tenant-scoped

#### Models
- [x] `server/model/api_key.js` - tenant_id in save()
- [x] `server/model/status_page.js`
  - `slugToID()` - Added tenant_id parameter
  - `sendStatusPageList()` - Added tenant_id filter

#### Monitor Types
- [x] `server/monitor-types/real-browser-monitor-type.js`
  - `getRemoteBrowser()` - tenant_id parameter

#### Server Core (`server/uptime-kuma-server.js`)
- [x] `sendMonitorList()` - tenant_id in call
- [x] `sendUpdateMonitorIntoList()` - tenant_id in call
- [x] `getMonitorJSONList()` - tenant_id in query
- [x] `sendMaintenanceList()` - tenant_id in call
- [x] `sendMaintenanceListByUserID()` - tenant_id parameter
- [x] `getMaintenanceJSONList()` - Filter by tenant_id

### Implementation Pattern

The tenant_id filtering follows this pattern throughout:

```javascript
// Function signature with default
async function doSomething(param, userID, tenantId = 1) {
    // Query with tenant isolation
    let bean = await R.findOne("table", " id = ? AND user_id = ? AND tenant_id = ? ", [
        id,
        userID,
        tenantId,
    ]);
}

// Call site from socket handler
await doSomething(param, socket.userID, socket.tenantId || 1);
```

### Notes on Public APIs

The following public-facing routes were intentionally left without tenant filtering as they operate on public data:

- `/api/push/:pushToken` - Uses unique push_token for lookup
- `/api/badge/*` - Public monitor badges (via monitor_group)
- `/api/status-page/*` - Public status page data

These routes access data through the status page or push token, which are already associated with specific tenants.

---

## Next Steps

### Phase 5: Worker Architecture
- [ ] Monitor scheduler table
- [ ] Worker process implementation
- [ ] Redis pub/sub for heartbeats
- [ ] Worker scaling configuration

### Phase 6: Billing & Admin
- [ ] Stripe integration
- [ ] Checkout flow
- [ ] Webhook handlers
- [ ] Super admin panel

---

## Testing Checklist

Before considering Phase 4 complete, verify:

- [ ] All monitors are properly scoped to tenant
- [ ] Notifications only show within tenant
- [ ] Status pages are tenant-isolated
- [ ] Maintenance windows are tenant-scoped
- [ ] Tags are tenant-scoped
- [ ] API keys are tenant-scoped
- [ ] Proxy configurations are tenant-scoped
- [ ] Docker hosts are tenant-scoped
- [ ] Remote browsers are tenant-scoped

---

*Last Updated: 2024-12-10*
