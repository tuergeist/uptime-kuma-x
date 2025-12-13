/**
 * Heartbeat Processor - Post-check processing for workers
 *
 * Handles all the work that happens after a monitor check:
 * - Storing heartbeat to database
 * - Sending notifications
 * - Updating uptime statistics
 * - Publishing to Redis for API servers
 */
const { R } = require("redbean-node");
const dayjs = require("dayjs");
const { log } = require("../../src/util");
const { UP, DOWN, PENDING, MAINTENANCE } = require("../../src/util");
const { PubSubService } = require("../services/pubsub-service");

// Dependencies injected at init time
let Monitor = null;
let UptimeCalculator = null;

/**
 * Initialize the processor with required dependencies
 * @param {object} monitorModel - The Monitor model class
 * @param {object} uptimeCalc - The UptimeCalculator class
 */
function initProcessor(monitorModel, uptimeCalc) {
    Monitor = monitorModel;
    UptimeCalculator = uptimeCalc;
}

/**
 * Process a completed monitor check result
 *
 * @param {object} monitor - Monitor bean
 * @param {object} checkResult - Result from executeCheck()
 * @returns {Promise<object>} Processing result
 */
async function processHeartbeat(monitor, checkResult) {
    const {
        heartbeat,
        tlsInfo,
        isFirstBeat,
        isImportant,
        shouldNotify,
        shouldResendNotification,
        nextInterval,
        retries,
    } = checkResult;

    const pubsub = PubSubService.getInstance();
    const tenantId = monitor.tenant_id || 1;
    const userId = monitor.user_id;

    try {
        // 1. Handle notifications
        if (shouldNotify || shouldResendNotification) {
            await sendNotification(isFirstBeat, monitor, heartbeat);
        }

        // 2. Cache invalidation on important beats
        // Note: Workers don't have local HTTP cache - API servers clear their
        // caches when they receive importantHeartbeat events via Redis pub/sub
        if (isImportant) {
            log.debug("processor", `[${monitor.name}] Important beat - API servers will clear cache`);
        }

        // 3. Calculate uptime statistics
        let uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitor.id);
        let endTimeDayjs = await uptimeCalculator.update(heartbeat.status, parseFloat(heartbeat.ping));
        heartbeat.end_time = R.isoDateTimeMillis(endTimeDayjs);

        // 4. Store heartbeat to database
        log.debug("processor", `[${monitor.name}] Storing heartbeat`);
        await R.store(heartbeat);

        // 5. Publish heartbeat via Redis
        if (pubsub.isAvailable()) {
            await pubsub.publishHeartbeat(tenantId, monitor.id, userId, heartbeat.toJSON());

            // Publish important heartbeat on separate channel
            if (isImportant) {
                await pubsub.publishImportantHeartbeat(tenantId, monitor.id, userId, heartbeat.toJSON(), isFirstBeat);
            }

            // Publish stats update
            const stats = await getMonitorStats(monitor.id);
            await pubsub.publishMonitorStats(tenantId, monitor.id, userId, stats);

            // Publish TLS info if available
            if (tlsInfo) {
                await pubsub.publishCertInfo(tenantId, monitor.id, userId, tlsInfo);
            }
        }

        // 6. Log result
        logHeartbeatResult(monitor, heartbeat, nextInterval);

        return {
            success: true,
            heartbeatId: heartbeat.id,
            status: heartbeat.status,
            nextInterval,
        };

    } catch (error) {
        log.error("processor", `Failed to process heartbeat for monitor ${monitor.id}: ${error.message}`);
        throw error;
    }
}

/**
 * Send notification for a monitor status change
 * @param {boolean} isFirstBeat - Is this the first heartbeat
 * @param {object} monitor - Monitor bean
 * @param {object} heartbeat - Heartbeat bean
 * @returns {Promise<void>}
 */
async function sendNotification(isFirstBeat, monitor, heartbeat) {
    try {
        log.debug("processor", `[${monitor.name}] Sending notification`);
        await Monitor.sendNotification(isFirstBeat, monitor, heartbeat);
    } catch (error) {
        log.error("processor", `Failed to send notification for monitor ${monitor.id}: ${error.message}`);
        // Don't throw - notification failure shouldn't stop heartbeat processing
    }
}

/**
 * Get monitor statistics for publishing
 * @param {number} monitorId - Monitor ID
 * @returns {Promise<object>} Stats object
 */
async function getMonitorStats(monitorId) {
    try {
        const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorId);

        // Get 24-hour and 30-day uptime
        // These return UptimeDataResult objects with .uptime property
        const uptime24hResult = uptimeCalculator.get24Hour();
        const uptime30dResult = uptimeCalculator.get30Day();

        // Get average ping from recent heartbeats (database-agnostic)
        const oneHourAgo = dayjs().subtract(1, "hour").format("YYYY-MM-DD HH:mm:ss");
        const avgPingResult = await R.getRow(`
            SELECT AVG(ping) as avg_ping
            FROM heartbeat
            WHERE monitor_id = ?
              AND time > ?
              AND status = 1
        `, [monitorId, oneHourAgo]);

        return {
            uptime24h: uptime24hResult.uptime,
            uptime30d: uptime30dResult.uptime,
            avgPing: avgPingResult?.avg_ping || 0,
        };
    } catch (error) {
        log.warn("processor", `Failed to get stats for monitor ${monitorId}: ${error.message}`);
        return {
            uptime24h: 0,
            uptime30d: 0,
            avgPing: 0,
        };
    }
}

/**
 * Log heartbeat result
 * @param {object} monitor - Monitor bean
 * @param {object} heartbeat - Heartbeat bean
 * @param {number} nextInterval - Next check interval
 */
function logHeartbeatResult(monitor, heartbeat, nextInterval) {
    const name = monitor.name;
    const type = monitor.type;

    if (heartbeat.status === UP) {
        log.debug("processor", `Monitor #${monitor.id} '${name}': Successful Response: ${heartbeat.ping} ms | Interval: ${nextInterval} seconds | Type: ${type}`);
    } else if (heartbeat.status === PENDING) {
        log.warn("processor", `Monitor #${monitor.id} '${name}': Pending: ${heartbeat.msg} | Retry Interval: ${nextInterval} seconds | Type: ${type}`);
    } else if (heartbeat.status === MAINTENANCE) {
        log.warn("processor", `Monitor #${monitor.id} '${name}': Under Maintenance | Type: ${type}`);
    } else {
        log.warn("processor", `Monitor #${monitor.id} '${name}': Failing: ${heartbeat.msg} | Interval: ${nextInterval} seconds | Type: ${type} | Down Count: ${heartbeat.downCount}`);
    }
}

/**
 * Reset down count after notification sent during resend interval
 * @param {number} heartbeatId - Heartbeat ID
 * @returns {Promise<void>}
 */
async function resetDownCount(heartbeatId) {
    await R.exec(`
        UPDATE heartbeat
        SET downCount = 0
        WHERE id = ?
    `, [heartbeatId]);
}

module.exports = {
    initProcessor,
    processHeartbeat,
    sendNotification,
    getMonitorStats,
    logHeartbeatResult,
    resetDownCount,
};
