/**
 * Schedule Service - Manages monitor_schedule table for worker architecture
 * Handles atomic claiming, schedule updates, and stale claim cleanup
 */
const { R } = require("redbean-node");
const { log } = require("../../src/util");
const dayjs = require("dayjs");
const Database = require("../database");

class ScheduleService {
    /**
     * Singleton instance
     * @type {ScheduleService}
     */
    static instance = null;

    /**
     * Default claim timeout in seconds (workers should complete within this time)
     * @type {number}
     */
    static CLAIM_TIMEOUT_SECONDS = 60;

    /**
     * Get the singleton instance
     * @returns {ScheduleService}
     */
    static getInstance() {
        if (ScheduleService.instance === null) {
            ScheduleService.instance = new ScheduleService();
        }
        return ScheduleService.instance;
    }

    /**
     * Initialize or update schedule entry for a monitor
     * @param {number} monitorId - Monitor ID
     * @param {number} tenantId - Tenant ID
     * @param {number} intervalSeconds - Check interval in seconds
     * @param {boolean} active - Whether the monitor is active
     * @returns {Promise<object>} Created/updated schedule entry
     */
    async initializeSchedule(monitorId, tenantId, intervalSeconds, active = true) {
        // Check if entry already exists
        let schedule = await R.findOne("monitor_schedule", " monitor_id = ? ", [monitorId]);

        if (schedule) {
            // Update existing entry
            schedule.tenant_id = tenantId;
            schedule.active = active;
            if (active && !schedule.next_check_at) {
                schedule.next_check_at = R.isoDateTime(dayjs());
            }
            schedule.updated_at = R.isoDateTime(dayjs());
            await R.store(schedule);
        } else {
            // Create new entry
            schedule = R.dispense("monitor_schedule");
            schedule.monitor_id = monitorId;
            schedule.tenant_id = tenantId;
            schedule.next_check_at = R.isoDateTime(dayjs()); // Check immediately
            schedule.active = active;
            schedule.retry_count = 0;
            schedule.consecutive_failures = 0;
            schedule.created_at = R.isoDateTime(dayjs());
            schedule.updated_at = R.isoDateTime(dayjs());
            await R.store(schedule);
        }

        log.debug("schedule", `Initialized schedule for monitor ${monitorId}, next check: ${schedule.next_check_at}`);
        return schedule;
    }

    /**
     * Claim monitors that are due for checking
     * Uses FOR UPDATE SKIP LOCKED for atomic claiming (PostgreSQL)
     * Falls back to standard locking for other databases
     *
     * @param {string} workerId - Worker ID claiming the monitors
     * @param {number} batchSize - Maximum number of monitors to claim
     * @returns {Promise<object[]>} Claimed schedule entries with monitor data
     */
    async claimMonitors(workerId, batchSize = 10) {
        const now = dayjs();
        const staleThreshold = now.subtract(ScheduleService.CLAIM_TIMEOUT_SECONDS, "second");

        const dbType = Database.dbConfig?.type || "sqlite";

        let claimedSchedules = [];

        if (dbType === "postgres") {
            // PostgreSQL: Use FOR UPDATE SKIP LOCKED for best performance
            claimedSchedules = await this._claimMonitorsPostgres(workerId, batchSize, now, staleThreshold);
        } else {
            // SQLite/MariaDB: Use transaction with standard locking
            claimedSchedules = await this._claimMonitorsGeneric(workerId, batchSize, now, staleThreshold);
        }

        if (claimedSchedules.length > 0) {
            log.debug("schedule", `Worker ${workerId} claimed ${claimedSchedules.length} monitors`);
        }

        return claimedSchedules;
    }

    /**
     * PostgreSQL-specific claim using FOR UPDATE SKIP LOCKED
     * @private
     */
    async _claimMonitorsPostgres(workerId, batchSize, now, staleThreshold) {
        const nowStr = now.format("YYYY-MM-DD HH:mm:ss");
        const staleStr = staleThreshold.format("YYYY-MM-DD HH:mm:ss");

        // Use raw query for FOR UPDATE SKIP LOCKED
        const sql = `
            WITH to_claim AS (
                SELECT id
                FROM monitor_schedule
                WHERE active = true
                  AND next_check_at <= $1
                  AND (claimed_by IS NULL OR claimed_at < $2)
                ORDER BY next_check_at
                LIMIT $3
                FOR UPDATE SKIP LOCKED
            )
            UPDATE monitor_schedule
            SET claimed_by = $4,
                claimed_at = $1
            WHERE id IN (SELECT id FROM to_claim)
            RETURNING *
        `;

        const result = await R.getAll(sql, [nowStr, staleStr, batchSize, workerId]);

        // Fetch monitor data for each claimed schedule
        const schedules = [];
        for (const row of result) {
            const monitor = await R.findOne("monitor", " id = ? ", [row.monitor_id]);
            if (monitor) {
                schedules.push({
                    schedule: row,
                    monitor: monitor,
                });
            }
        }

        return schedules;
    }

    /**
     * Generic claim for SQLite/MariaDB using transaction
     * @private
     */
    async _claimMonitorsGeneric(workerId, batchSize, now, staleThreshold) {
        const nowStr = now.format("YYYY-MM-DD HH:mm:ss");
        const staleStr = staleThreshold.format("YYYY-MM-DD HH:mm:ss");

        // Find due monitors (use true for PostgreSQL boolean compatibility)
        const dueSchedules = await R.getAll(`
            SELECT id, monitor_id
            FROM monitor_schedule
            WHERE active = true
              AND next_check_at <= ?
              AND (claimed_by IS NULL OR claimed_at < ?)
            ORDER BY next_check_at
            LIMIT ?
        `, [nowStr, staleStr, batchSize]);

        if (dueSchedules.length === 0) {
            return [];
        }

        const schedules = [];

        // Claim each monitor in a transaction
        for (const due of dueSchedules) {
            try {
                // Attempt to claim
                const updateCount = await R.exec(`
                    UPDATE monitor_schedule
                    SET claimed_by = ?,
                        claimed_at = ?
                    WHERE id = ?
                      AND (claimed_by IS NULL OR claimed_at < ?)
                `, [workerId, nowStr, due.id, staleStr]);

                // If we successfully claimed it
                if (updateCount > 0) {
                    const schedule = await R.findOne("monitor_schedule", " id = ? ", [due.id]);
                    const monitor = await R.findOne("monitor", " id = ? ", [due.monitor_id]);

                    if (schedule && monitor) {
                        schedules.push({
                            schedule: schedule,
                            monitor: monitor,
                        });
                    }
                }
            } catch (err) {
                // Another worker may have claimed it, continue
                log.debug("schedule", `Failed to claim monitor ${due.monitor_id}: ${err.message}`);
            }
        }

        return schedules;
    }

    /**
     * Release a claimed monitor (after check completes)
     * @param {number} scheduleId - Schedule entry ID
     * @param {number} intervalSeconds - Check interval for next check
     * @param {number|null} status - Result status (UP, DOWN, etc.)
     * @param {number|null} ping - Response time in ms
     * @param {boolean} wasFailure - Whether this check was a failure
     * @returns {Promise<void>}
     */
    async releaseMonitor(scheduleId, intervalSeconds, status = null, ping = null, wasFailure = false) {
        const now = dayjs();
        const nextCheck = now.add(intervalSeconds, "second");

        const schedule = await R.findOne("monitor_schedule", " id = ? ", [scheduleId]);
        if (!schedule) {
            return;
        }

        schedule.claimed_by = null;
        schedule.claimed_at = null;
        schedule.next_check_at = R.isoDateTime(nextCheck);
        schedule.last_check_at = R.isoDateTime(now);
        schedule.updated_at = R.isoDateTime(now);

        if (status !== null) {
            schedule.last_status = status;
        }
        if (ping !== null) {
            schedule.last_ping = ping;
        }

        // Update failure tracking
        if (wasFailure) {
            schedule.consecutive_failures = (schedule.consecutive_failures || 0) + 1;
        } else {
            schedule.consecutive_failures = 0;
        }

        await R.store(schedule);

        log.debug("schedule", `Released monitor ${schedule.monitor_id}, next check: ${schedule.next_check_at}`);
    }

    /**
     * Update schedule for next check (without releasing claim)
     * Used when retrying on pending status
     * @param {number} scheduleId - Schedule entry ID
     * @param {number} retryIntervalSeconds - Retry interval in seconds
     * @returns {Promise<void>}
     */
    async scheduleRetry(scheduleId, retryIntervalSeconds) {
        const now = dayjs();
        const nextCheck = now.add(retryIntervalSeconds, "second");

        await R.exec(`
            UPDATE monitor_schedule
            SET next_check_at = ?,
                retry_count = retry_count + 1,
                updated_at = ?
            WHERE id = ?
        `, [R.isoDateTime(nextCheck), R.isoDateTime(now), scheduleId]);

        log.debug("schedule", `Scheduled retry for ${scheduleId}, next check: ${nextCheck.format()}`);
    }

    /**
     * Release stale claims (from crashed/stuck workers)
     * @param {number} olderThanMinutes - Release claims older than this many minutes
     * @returns {Promise<number>} Number of released claims
     */
    async releaseStaleClaimsOlderThan(olderThanMinutes = 2) {
        const threshold = dayjs().subtract(olderThanMinutes, "minute");
        const thresholdStr = threshold.format("YYYY-MM-DD HH:mm:ss");

        const result = await R.exec(`
            UPDATE monitor_schedule
            SET claimed_by = NULL,
                claimed_at = NULL,
                updated_at = ?
            WHERE claimed_by IS NOT NULL
              AND claimed_at < ?
        `, [R.isoDateTime(dayjs()), thresholdStr]);

        if (result > 0) {
            log.info("schedule", `Released ${result} stale claims older than ${olderThanMinutes} minutes`);
        }

        return result;
    }

    /**
     * Deactivate schedule for a monitor (when monitor is paused/deleted)
     * @param {number} monitorId - Monitor ID
     * @returns {Promise<void>}
     */
    async deactivateSchedule(monitorId) {
        // Use false instead of 0 for PostgreSQL boolean compatibility
        await R.exec(`
            UPDATE monitor_schedule
            SET active = ?,
                claimed_by = NULL,
                claimed_at = NULL,
                updated_at = ?
            WHERE monitor_id = ?
        `, [false, R.isoDateTime(dayjs()), monitorId]);

        log.debug("schedule", `Deactivated schedule for monitor ${monitorId}`);
    }

    /**
     * Activate schedule for a monitor (when monitor is resumed)
     * @param {number} monitorId - Monitor ID
     * @param {number} intervalSeconds - Check interval
     * @returns {Promise<void>}
     */
    async activateSchedule(monitorId, intervalSeconds) {
        const now = dayjs();
        const nextCheck = now.add(1, "second"); // Check soon after activation

        // Use true for PostgreSQL boolean compatibility
        await R.exec(`
            UPDATE monitor_schedule
            SET active = true,
                next_check_at = ?,
                updated_at = ?
            WHERE monitor_id = ?
        `, [R.isoDateTime(nextCheck), R.isoDateTime(now), monitorId]);

        log.debug("schedule", `Activated schedule for monitor ${monitorId}`);
    }

    /**
     * Delete schedule for a monitor
     * @param {number} monitorId - Monitor ID
     * @returns {Promise<void>}
     */
    async deleteSchedule(monitorId) {
        await R.exec("DELETE FROM monitor_schedule WHERE monitor_id = ?", [monitorId]);
        log.debug("schedule", `Deleted schedule for monitor ${monitorId}`);
    }

    /**
     * Get schedule statistics
     * @param {number|null} tenantId - Filter by tenant (null for all)
     * @returns {Promise<object>}
     */
    async getStats(tenantId = null) {
        let whereClause = "";
        let params = [];

        if (tenantId !== null) {
            whereClause = " WHERE tenant_id = ? ";
            params = [tenantId];
        }

        // Use true for PostgreSQL boolean compatibility and NOW() for timestamp
        const stats = await R.getRow(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN active = true THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN claimed_by IS NOT NULL THEN 1 ELSE 0 END) as claimed,
                SUM(CASE WHEN next_check_at <= NOW() AND active = true AND claimed_by IS NULL THEN 1 ELSE 0 END) as due
            FROM monitor_schedule
            ${whereClause}
        `, params);

        return {
            total: stats.total || 0,
            active: stats.active || 0,
            claimed: stats.claimed || 0,
            due: stats.due || 0,
        };
    }

    /**
     * Sync all monitors to schedule table
     * Used on startup to ensure all monitors have schedule entries
     * @returns {Promise<number>} Number of monitors synced
     */
    async syncAllMonitors() {
        // Get all active monitors without schedule entries
        const monitors = await R.getAll(`
            SELECT m.id, m.tenant_id, m.interval, m.active
            FROM monitor m
            LEFT JOIN monitor_schedule ms ON m.id = ms.monitor_id
            WHERE ms.id IS NULL
        `);

        for (const monitor of monitors) {
            await this.initializeSchedule(
                monitor.id,
                monitor.tenant_id || 1,
                monitor.interval || 60,
                monitor.active === true || monitor.active === 1  // Handle both boolean and integer
            );
        }

        if (monitors.length > 0) {
            log.info("schedule", `Synced ${monitors.length} monitors to schedule table`);
        }

        return monitors.length;
    }
}

module.exports = {
    ScheduleService,
};
