/**
 * Pub/Sub Channel Constants
 * Centralized definition of all Redis pub/sub channels used in the worker architecture
 */

/**
 * Channel for heartbeat messages from workers to API servers
 * Message format: { tenantId, monitorId, userId, heartbeat, timestamp }
 */
const CHANNEL_HEARTBEAT = "uptime:heartbeat";

/**
 * Channel for monitor status changes
 * Message format: { tenantId, monitorId, status, previousStatus, timestamp }
 */
const CHANNEL_MONITOR_STATUS = "uptime:monitor:status";

/**
 * Channel for important heartbeats (status changes that trigger notifications)
 * Message format: { tenantId, monitorId, userId, heartbeat, isFirstBeat, timestamp }
 */
const CHANNEL_IMPORTANT_HEARTBEAT = "uptime:heartbeat:important";

/**
 * Channel for monitor statistics updates
 * Message format: { tenantId, monitorId, userId, stats, timestamp }
 */
const CHANNEL_MONITOR_STATS = "uptime:monitor:stats";

/**
 * Channel for worker heartbeats (workers reporting their status)
 * Message format: { workerId, status, checksProcessed, lastCheckAt, timestamp }
 */
const CHANNEL_WORKER_HEARTBEAT = "uptime:worker:heartbeat";

/**
 * Channel for worker commands (start/stop/restart monitors)
 * Message format: { command, monitorId, tenantId, timestamp }
 */
const CHANNEL_WORKER_COMMAND = "uptime:worker:command";

/**
 * Channel for certificate info updates
 * Message format: { tenantId, monitorId, userId, certInfo, timestamp }
 */
const CHANNEL_CERT_INFO = "uptime:cert:info";

/**
 * Channel for maintenance status changes
 * Message format: { tenantId, maintenanceId, userId, status, timestamp }
 */
const CHANNEL_MAINTENANCE = "uptime:maintenance";

/**
 * All channels grouped by category
 */
const CHANNELS = {
    // Core heartbeat channels
    HEARTBEAT: CHANNEL_HEARTBEAT,
    IMPORTANT_HEARTBEAT: CHANNEL_IMPORTANT_HEARTBEAT,

    // Monitor channels
    MONITOR_STATUS: CHANNEL_MONITOR_STATUS,
    MONITOR_STATS: CHANNEL_MONITOR_STATS,
    CERT_INFO: CHANNEL_CERT_INFO,

    // Worker channels
    WORKER_HEARTBEAT: CHANNEL_WORKER_HEARTBEAT,
    WORKER_COMMAND: CHANNEL_WORKER_COMMAND,

    // Maintenance channels
    MAINTENANCE: CHANNEL_MAINTENANCE,
};

/**
 * Worker command types
 */
const WORKER_COMMANDS = {
    START_MONITOR: "start_monitor",
    STOP_MONITOR: "stop_monitor",
    RESTART_MONITOR: "restart_monitor",
    CHECK_NOW: "check_now",
    SHUTDOWN: "shutdown",
};

/**
 * Get tenant-specific channel name
 * @param {string} baseChannel - Base channel name
 * @param {number} tenantId - Tenant ID
 * @returns {string} Tenant-specific channel name
 */
function getTenantChannel(baseChannel, tenantId) {
    return `${baseChannel}:tenant:${tenantId}`;
}

/**
 * Get user-specific channel name
 * @param {string} baseChannel - Base channel name
 * @param {number} tenantId - Tenant ID
 * @param {number} userId - User ID
 * @returns {string} User-specific channel name
 */
function getUserChannel(baseChannel, tenantId, userId) {
    return `${baseChannel}:tenant:${tenantId}:user:${userId}`;
}

module.exports = {
    // Individual channel constants
    CHANNEL_HEARTBEAT,
    CHANNEL_MONITOR_STATUS,
    CHANNEL_IMPORTANT_HEARTBEAT,
    CHANNEL_MONITOR_STATS,
    CHANNEL_WORKER_HEARTBEAT,
    CHANNEL_WORKER_COMMAND,
    CHANNEL_CERT_INFO,
    CHANNEL_MAINTENANCE,

    // Grouped channels
    CHANNELS,

    // Worker commands
    WORKER_COMMANDS,

    // Helper functions
    getTenantChannel,
    getUserChannel,
};
