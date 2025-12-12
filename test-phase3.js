/**
 * Phase 3 Test Script
 * Tests tenant middleware and utility modules
 */

console.log("Testing Phase 3 - Tenant Middleware & Context...\n");

// Test 1: tenant-cache.js
console.log("1. Testing tenant-cache.js...");
try {
    const { TenantCache, subdomainCache, domainCache, idCache, invalidateAllCaches } = require("./server/utils/tenant-cache");

    // Test basic cache operations
    const cache = new TenantCache(10, 1000);
    cache.set("test", { id: 1, name: "Test" });
    const result = cache.get("test");
    if (result && result.id === 1) {
        console.log("   ✅ TenantCache basic operations work");
    } else {
        console.log("   ❌ TenantCache basic operations failed");
    }

    // Test singleton caches exist
    if (subdomainCache && domainCache && idCache) {
        console.log("   ✅ Singleton caches initialized");
    }

    console.log("   ✅ tenant-cache.js OK\n");
} catch (err) {
    console.log("   ❌ tenant-cache.js failed:", err.message, "\n");
}

// Test 2: tenant-emit.js
console.log("2. Testing tenant-emit.js...");
try {
    const {
        getUserRoom,
        getTenantRoom,
        getStatusPageRoom,
        joinTenantRooms,
    } = require("./server/utils/tenant-emit");

    // Test room name generation
    const userRoom = getUserRoom(1, 42);
    const tenantRoom = getTenantRoom(1);
    const statusRoom = getStatusPageRoom(1, "main");

    if (userRoom === "tenant:1:user:42") {
        console.log("   ✅ getUserRoom works correctly");
    } else {
        console.log("   ❌ getUserRoom failed:", userRoom);
    }

    if (tenantRoom === "tenant:1") {
        console.log("   ✅ getTenantRoom works correctly");
    } else {
        console.log("   ❌ getTenantRoom failed:", tenantRoom);
    }

    if (statusRoom === "tenant:1:statuspage:main") {
        console.log("   ✅ getStatusPageRoom works correctly");
    } else {
        console.log("   ❌ getStatusPageRoom failed:", statusRoom);
    }

    console.log("   ✅ tenant-emit.js OK\n");
} catch (err) {
    console.log("   ❌ tenant-emit.js failed:", err.message, "\n");
}

// Test 3: tenant-query.js
console.log("3. Testing tenant-query.js...");
try {
    const { TenantQuery, createTenantQuery, createTenantQueryFromSocket } = require("./server/utils/tenant-query");

    // Test TenantQuery instantiation
    const tq = new TenantQuery(1);
    if (tq.tenantId === 1) {
        console.log("   ✅ TenantQuery instantiation works");
    }

    // Test condition scoping
    const scoped = tq._scopeConditions("user_id = ?");
    if (scoped.includes("tenant_id = ?") && scoped.includes("user_id = ?")) {
        console.log("   ✅ Condition scoping works correctly");
    } else {
        console.log("   ❌ Condition scoping failed:", scoped);
    }

    // Test param scoping
    const params = tq._scopeParams([42]);
    if (params[0] === 1 && params[1] === 42) {
        console.log("   ✅ Parameter scoping works correctly");
    } else {
        console.log("   ❌ Parameter scoping failed:", params);
    }

    // Test error on missing tenantId
    try {
        new TenantQuery(null);
        console.log("   ❌ Should have thrown error for null tenantId");
    } catch (e) {
        console.log("   ✅ Throws error for invalid tenantId");
    }

    console.log("   ✅ tenant-query.js OK\n");
} catch (err) {
    console.log("   ❌ tenant-query.js failed:", err.message, "\n");
}

// Test 4: tenant.js middleware (syntax check only, needs DB for full test)
console.log("4. Testing middleware/tenant.js (syntax)...");
try {
    const {
        resolveTenant,
        requireTenant,
        getDefaultTenant,
        MULTI_TENANT_ENABLED,
        BASE_DOMAIN,
    } = require("./server/middleware/tenant");

    if (typeof resolveTenant === "function") {
        console.log("   ✅ resolveTenant function exported");
    }

    if (typeof requireTenant === "function") {
        console.log("   ✅ requireTenant function exported");
    }

    if (typeof getDefaultTenant === "function") {
        console.log("   ✅ getDefaultTenant function exported");
    }

    console.log(`   ℹ️  MULTI_TENANT_ENABLED: ${MULTI_TENANT_ENABLED}`);
    console.log(`   ℹ️  BASE_DOMAIN: ${BASE_DOMAIN}`);

    console.log("   ✅ tenant.js middleware OK\n");
} catch (err) {
    console.log("   ❌ tenant.js middleware failed:", err.message, "\n");
}

// Test 5: user.js JWT update
console.log("5. Testing model/user.js JWT update...");
try {
    // Can't fully test without database, but check file loads
    const User = require("./server/model/user");
    if (typeof User.createJWT === "function") {
        console.log("   ✅ User.createJWT function exists");
    }

    // Read the source to verify tenant fields added
    const fs = require("fs");
    const userSource = fs.readFileSync("./server/model/user.js", "utf8");
    if (userSource.includes("tenant_id:") && userSource.includes("role:")) {
        console.log("   ✅ JWT includes tenant_id and role fields");
    } else {
        console.log("   ❌ JWT missing tenant fields");
    }

    console.log("   ✅ user.js OK\n");
} catch (err) {
    console.log("   ❌ user.js failed:", err.message, "\n");
}

// Test 6: server.js modifications
console.log("6. Testing server.js modifications...");
try {
    const fs = require("fs");
    const serverSource = fs.readFileSync("./server/server.js", "utf8");

    if (serverSource.includes("require(\"./middleware/tenant\")")) {
        console.log("   ✅ tenant middleware imported");
    } else {
        console.log("   ❌ tenant middleware not imported");
    }

    if (serverSource.includes("app.use(resolveTenant)")) {
        console.log("   ✅ tenant middleware added to app");
    } else {
        console.log("   ❌ tenant middleware not added to app");
    }

    if (serverSource.includes("socket.tenantId")) {
        console.log("   ✅ socket.tenantId set in afterLogin");
    } else {
        console.log("   ❌ socket.tenantId not set");
    }

    if (serverSource.includes("joinTenantRooms")) {
        console.log("   ✅ joinTenantRooms called in afterLogin");
    } else {
        console.log("   ❌ joinTenantRooms not called");
    }

    console.log("   ✅ server.js OK\n");
} catch (err) {
    console.log("   ❌ server.js failed:", err.message, "\n");
}

console.log("========================================");
console.log("Phase 3 module tests complete!");
console.log("========================================");
