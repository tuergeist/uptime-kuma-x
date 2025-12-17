const { R } = require("redbean-node");

/**
 * Plan Enforcement Module
 * Centralized logic for checking and enforcing plan limits
 */

/**
 * Get tenant's plan with all limits
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object|null>} Plan object with limits or null
 */
async function getTenantPlan(tenantId) {
    if (!tenantId) {
        return null;
    }

    const result = await R.getRow(`
        SELECT p.*
        FROM plan p
        JOIN tenant t ON t.plan_id = p.id
        WHERE t.id = ?
    `, [ tenantId ]);

    return result;
}

/**
 * Get current usage counts for a tenant
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} Usage counts
 */
async function getTenantUsage(tenantId) {
    const [ monitorCount, statusPageCount, userCount ] = await Promise.all([
        R.getCell("SELECT COUNT(*) FROM monitor WHERE tenant_id = ?", [ tenantId ]),
        R.getCell("SELECT COUNT(*) FROM status_page WHERE tenant_id = ?", [ tenantId ]),
        R.getCell("SELECT COUNT(*) FROM \"user\" WHERE tenant_id = ?", [ tenantId ]),
    ]);

    return {
        monitors: parseInt(monitorCount) || 0,
        statusPages: parseInt(statusPageCount) || 0,
        users: parseInt(userCount) || 0,
    };
}

/**
 * Get full plan usage data for the plan status page
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} Full plan usage data
 */
async function getPlanUsage(tenantId) {
    const plan = await getTenantPlan(tenantId);
    const usage = await getTenantUsage(tenantId);

    // Default to free plan limits if no plan found
    const limits = {
        monitors: plan?.monitor_limit ?? 5,
        statusPages: plan?.status_pages_limit ?? 1,
        users: plan?.users_limit ?? 1,
        checkIntervalMin: plan?.check_interval_min ?? 60,
        retentionDays: plan?.retention_days ?? 7,
    };

    return {
        plan: {
            id: plan?.id ?? null,
            name: plan?.name ?? "Free",
            slug: plan?.slug ?? "free",
        },
        usage,
        limits,
    };
}

/**
 * Check if tenant can create more monitors
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} { allowed: boolean, current: number, limit: number|null }
 */
async function checkMonitorLimit(tenantId) {
    const plan = await getTenantPlan(tenantId);
    const limit = plan?.monitor_limit ?? 5; // Default to free plan limit

    // NULL limit means unlimited
    if (limit === null) {
        return {
            allowed: true,
            current: 0,
            limit: null
        };
    }

    const current = parseInt(await R.getCell(
        "SELECT COUNT(*) FROM monitor WHERE tenant_id = ?",
        [ tenantId ]
    )) || 0;

    return {
        allowed: current < limit,
        current,
        limit,
    };
}

/**
 * Check if tenant can create more status pages
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} { allowed: boolean, current: number, limit: number|null }
 */
async function checkStatusPageLimit(tenantId) {
    const plan = await getTenantPlan(tenantId);
    const limit = plan?.status_pages_limit ?? 1; // Default to free plan limit

    // NULL limit means unlimited
    if (limit === null) {
        return {
            allowed: true,
            current: 0,
            limit: null
        };
    }

    const current = parseInt(await R.getCell(
        "SELECT COUNT(*) FROM status_page WHERE tenant_id = ?",
        [ tenantId ]
    )) || 0;

    return {
        allowed: current < limit,
        current,
        limit,
    };
}

/**
 * Check if tenant can add more users
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} { allowed: boolean, current: number, limit: number|null }
 */
async function checkUserLimit(tenantId) {
    const plan = await getTenantPlan(tenantId);
    const limit = plan?.users_limit ?? 1; // Default to free plan limit

    // NULL limit means unlimited
    if (limit === null) {
        return {
            allowed: true,
            current: 0,
            limit: null
        };
    }

    const current = parseInt(await R.getCell(
        "SELECT COUNT(*) FROM \"user\" WHERE tenant_id = ?",
        [ tenantId ]
    )) || 0;

    return {
        allowed: current < limit,
        current,
        limit,
    };
}

/**
 * Get minimum allowed check interval for tenant
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<number>} Minimum interval in seconds
 */
async function getMinCheckInterval(tenantId) {
    const plan = await getTenantPlan(tenantId);
    return plan?.check_interval_min ?? 60; // Default to 60 seconds
}

/**
 * Enforce minimum check interval - returns adjusted interval if needed
 * @param {number} tenantId - The tenant ID
 * @param {number} requestedInterval - Requested interval in seconds
 * @returns {Promise<object>} { interval: number, wasAdjusted: boolean, minAllowed: number }
 */
async function enforceMinInterval(tenantId, requestedInterval) {
    const minAllowed = await getMinCheckInterval(tenantId);

    if (requestedInterval < minAllowed) {
        return {
            interval: minAllowed,
            wasAdjusted: true,
            minAllowed,
        };
    }

    return {
        interval: requestedInterval,
        wasAdjusted: false,
        minAllowed,
    };
}

/**
 * Get data retention days for tenant
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<number>} Retention days
 */
async function getRetentionDays(tenantId) {
    const plan = await getTenantPlan(tenantId);
    return plan?.retention_days ?? 7; // Default to 7 days
}

/**
 * Create a limit error response object
 * @param {string} limitType - Type of limit (monitors, statusPages, users)
 * @param {number} current - Current count
 * @param {number} limit - Maximum allowed
 * @returns {object} Error response object
 */
function createLimitError(limitType, current, limit) {
    const typeLabels = {
        monitors: "Monitor",
        statusPages: "Status page",
        users: "Team member",
    };

    const label = typeLabels[limitType] || limitType;

    return {
        ok: false,
        msg: `${label} limit reached (${current}/${limit}). Upgrade your plan for more.`,
        msgi18n: false,
        limitReached: true,
        limitType,
        current,
        limit,
    };
}

/**
 * Check if tenant can send more emails today
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} { allowed: boolean, current: number, limit: number|null, remaining: number|null }
 */
async function checkEmailLimit(tenantId) {
    const plan = await getTenantPlan(tenantId);
    const limit = plan?.email_limit_daily ?? 50; // Default to free plan limit

    // NULL limit means unlimited
    if (limit === null) {
        return {
            allowed: true,
            current: 0,
            limit: null,
            remaining: null,
        };
    }

    // Get current email count for today
    const today = new Date().toISOString().split("T")[0];
    const tenant = await R.getRow(
        "SELECT email_count_date, email_count_today FROM tenant WHERE id = ?",
        [ tenantId ]
    );

    let current = 0;
    if (tenant && tenant.email_count_date === today) {
        current = tenant.email_count_today || 0;
    }

    return {
        allowed: current < limit,
        current,
        limit,
        remaining: limit - current,
    };
}

/**
 * Increment email count for tenant (call after sending email)
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<void>}
 */
async function incrementEmailCount(tenantId) {
    const today = new Date().toISOString().split("T")[0];

    // Check if we need to reset the counter (new day)
    const tenant = await R.getRow(
        "SELECT email_count_date, email_count_today FROM tenant WHERE id = ?",
        [ tenantId ]
    );

    if (tenant && tenant.email_count_date === today) {
        // Same day, increment
        await R.exec(
            "UPDATE tenant SET email_count_today = email_count_today + 1 WHERE id = ?",
            [ tenantId ]
        );
    } else {
        // New day, reset to 1
        await R.exec(
            "UPDATE tenant SET email_count_date = ?, email_count_today = 1 WHERE id = ?",
            [ today, tenantId ]
        );
    }
}

/**
 * Get email usage for display in plan status
 * @param {number} tenantId - The tenant ID
 * @returns {Promise<object>} { sent: number, limit: number|null, resetTime: string }
 */
async function getEmailUsage(tenantId) {
    const plan = await getTenantPlan(tenantId);
    const limit = plan?.email_limit_daily ?? 50;

    const today = new Date().toISOString().split("T")[0];
    const tenant = await R.getRow(
        "SELECT email_count_date, email_count_today FROM tenant WHERE id = ?",
        [ tenantId ]
    );

    let sent = 0;
    if (tenant && tenant.email_count_date === today) {
        sent = tenant.email_count_today || 0;
    }

    // Calculate reset time (midnight UTC)
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    return {
        sent,
        limit,
        resetTime: tomorrow.toISOString(),
    };
}

module.exports = {
    getTenantPlan,
    getTenantUsage,
    getPlanUsage,
    checkMonitorLimit,
    checkStatusPageLimit,
    checkUserLimit,
    getMinCheckInterval,
    enforceMinInterval,
    getRetentionDays,
    createLimitError,
    checkEmailLimit,
    incrementEmailCount,
    getEmailUsage,
};
