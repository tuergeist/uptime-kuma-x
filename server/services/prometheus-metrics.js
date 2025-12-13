const promClient = require("prom-client");

// Create a new registry for our custom metrics
const register = new promClient.Registry();

// Add default Node.js metrics (memory, CPU, etc.)
promClient.collectDefaultMetrics({ register });

// Counter for total checks performed
const checksTotal = new promClient.Counter({
    name: "uptime_hive_checks_total",
    help: "Total number of monitor checks performed",
    labelNames: ["tenant_id", "monitor_type", "status"],
    registers: [register],
});

// Histogram for check duration/response time
const checkDuration = new promClient.Histogram({
    name: "uptime_hive_check_duration_ms",
    help: "Duration of monitor checks in milliseconds",
    labelNames: ["tenant_id", "monitor_type"],
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [register],
});

// Gauge for active monitors count
const monitorsActive = new promClient.Gauge({
    name: "uptime_hive_monitors_active",
    help: "Number of currently active monitors",
    labelNames: ["tenant_id"],
    registers: [register],
});

// Gauge for monitors by status
const monitorsByStatus = new promClient.Gauge({
    name: "uptime_hive_monitors_by_status",
    help: "Number of monitors by current status",
    labelNames: ["tenant_id", "status"],
    registers: [register],
});

/**
 * Record a monitor check
 * @param {object} options
 * @param {number} options.tenantId - Tenant ID
 * @param {string} options.monitorType - Type of monitor (http, ping, dns, etc.)
 * @param {string} options.status - Check result (up, down, pending, maintenance)
 * @param {number} options.duration - Response time in milliseconds
 */
function recordCheck({ tenantId, monitorType, status, duration }) {
    const labels = {
        tenant_id: String(tenantId || "default"),
        monitor_type: monitorType || "unknown",
        status: status || "unknown",
    };

    checksTotal.inc(labels);

    if (duration !== undefined && duration !== null) {
        checkDuration.observe(
            { tenant_id: labels.tenant_id, monitor_type: labels.monitor_type },
            duration
        );
    }
}

/**
 * Update active monitor count for a tenant
 * @param {number} tenantId
 * @param {number} count
 */
function setActiveMonitors(tenantId, count) {
    monitorsActive.set({ tenant_id: String(tenantId || "default") }, count);
}

/**
 * Update monitors by status for a tenant
 * @param {number} tenantId
 * @param {object} statusCounts - { up: n, down: n, pending: n, maintenance: n }
 */
function setMonitorsByStatus(tenantId, statusCounts) {
    const tenantLabel = String(tenantId || "default");
    for (const [status, count] of Object.entries(statusCounts)) {
        monitorsByStatus.set({ tenant_id: tenantLabel, status }, count);
    }
}

/**
 * Get metrics in Prometheus format
 * @returns {Promise<string>}
 */
async function getMetrics() {
    return register.metrics();
}

/**
 * Get content type for Prometheus response
 * @returns {string}
 */
function getContentType() {
    return register.contentType;
}

module.exports = {
    register,
    checksTotal,
    checkDuration,
    monitorsActive,
    monitorsByStatus,
    recordCheck,
    setActiveMonitors,
    setMonitorsByStatus,
    getMetrics,
    getContentType,
};
