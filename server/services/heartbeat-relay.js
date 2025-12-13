/**
 * Heartbeat Relay Service - Bridges Redis pub/sub to Socket.IO
 *
 * In distributed mode, workers publish heartbeats to Redis.
 * This service subscribes to those channels and relays events
 * to connected Socket.IO clients.
 */
const { PubSubService } = require("./pubsub-service");
const { emitToUser } = require("../utils/tenant-emit");
const { log } = require("../../src/util");
const apicache = require("../modules/apicache");
const { UptimeCalculator } = require("../uptime-calculator");

class HeartbeatRelayService {
    /**
     * Singleton instance
     * @type {HeartbeatRelayService}
     */
    static instance = null;

    /**
     * Socket.IO server instance
     * @type {object}
     */
    io = null;

    /**
     * Whether the service is initialized
     * @type {boolean}
     */
    initialized = false;

    /**
     * Message counters for monitoring
     * @type {object}
     */
    stats = {
        heartbeats: 0,
        importantHeartbeats: 0,
        statsUpdates: 0,
        certInfoUpdates: 0,
        errors: 0,
    };

    /**
     * Get the singleton instance
     * @returns {HeartbeatRelayService}
     */
    static getInstance() {
        if (HeartbeatRelayService.instance === null) {
            HeartbeatRelayService.instance = new HeartbeatRelayService();
        }
        return HeartbeatRelayService.instance;
    }

    /**
     * Initialize the relay service
     * @param {object} io - Socket.IO server instance
     * @returns {Promise<void>}
     */
    async init(io) {
        if (this.initialized) {
            log.warn("heartbeat-relay", "HeartbeatRelayService already initialized");
            return;
        }

        this.io = io;

        const pubsub = PubSubService.getInstance();

        // Check if Redis is available
        if (!pubsub.isAvailable()) {
            // Try to initialize
            await pubsub.init();
        }

        if (!pubsub.isAvailable()) {
            log.warn("heartbeat-relay", "Redis not available, heartbeat relay disabled");
            return;
        }

        log.info("heartbeat-relay", "Initializing heartbeat relay subscriptions...");

        // Subscribe to regular heartbeats
        await pubsub.subscribeToHeartbeats((data) => {
            this.handleHeartbeat(data);
        });

        // Subscribe to important heartbeats (status changes)
        await pubsub.subscribeToImportantHeartbeats((data) => {
            this.handleImportantHeartbeat(data);
        });

        // Subscribe to monitor stats updates
        await pubsub.subscribeToMonitorStats((data) => {
            this.handleStatsUpdate(data);
        });

        // Subscribe to certificate info updates
        await pubsub.subscribeToCertInfo((data) => {
            this.handleCertInfo(data);
        });

        this.initialized = true;
        log.info("heartbeat-relay", "Heartbeat relay service initialized");
    }

    /**
     * Handle regular heartbeat from Redis
     * @param {object} data - Heartbeat data from Redis
     */
    handleHeartbeat(data) {
        try {
            const { tenantId, monitorId, userId, heartbeat } = data;

            if (!tenantId || !userId || !heartbeat) {
                log.warn("heartbeat-relay", "Invalid heartbeat data received");
                return;
            }

            // Invalidate UptimeCalculator cache so next chart request gets fresh DB data
            // This is critical for distributed mode where workers update stats
            UptimeCalculator.remove(monitorId);

            // Emit to user's Socket.IO room
            emitToUser(this.io, tenantId, userId, "heartbeat", heartbeat);
            this.stats.heartbeats++;

            log.debug("heartbeat-relay", `Relayed heartbeat for monitor ${monitorId} to user ${userId}`);
        } catch (error) {
            log.error("heartbeat-relay", `Error handling heartbeat: ${error.message}`);
            this.stats.errors++;
        }
    }

    /**
     * Handle important heartbeat (status change) from Redis
     * @param {object} data - Important heartbeat data from Redis
     */
    handleImportantHeartbeat(data) {
        try {
            const { tenantId, monitorId, userId, heartbeat, isFirstBeat } = data;

            if (!tenantId || !userId || !heartbeat) {
                log.warn("heartbeat-relay", "Invalid important heartbeat data received");
                return;
            }

            // Clear API cache on important heartbeats (status changes)
            apicache.clear();

            // Emit to user's Socket.IO room
            emitToUser(this.io, tenantId, userId, "importantHeartbeat", heartbeat);
            this.stats.importantHeartbeats++;

            log.debug("heartbeat-relay", `Relayed important heartbeat for monitor ${monitorId} (first: ${isFirstBeat})`);
        } catch (error) {
            log.error("heartbeat-relay", `Error handling important heartbeat: ${error.message}`);
            this.stats.errors++;
        }
    }

    /**
     * Handle stats update from Redis
     * @param {object} data - Stats data from Redis
     */
    handleStatsUpdate(data) {
        try {
            const { tenantId, monitorId, userId, stats } = data;

            if (!tenantId || !userId || !stats) {
                log.warn("heartbeat-relay", "Invalid stats data received");
                return;
            }

            // Emit avgPing and uptime separately (matching existing API)
            emitToUser(this.io, tenantId, userId, "avgPing", monitorId, stats.avgPing);
            emitToUser(this.io, tenantId, userId, "uptime", monitorId, stats.uptime24h, stats.uptime30d);
            this.stats.statsUpdates++;

            log.debug("heartbeat-relay", `Relayed stats for monitor ${monitorId}`);
        } catch (error) {
            log.error("heartbeat-relay", `Error handling stats update: ${error.message}`);
            this.stats.errors++;
        }
    }

    /**
     * Handle certificate info update from Redis
     * @param {object} data - Certificate info from Redis
     */
    handleCertInfo(data) {
        try {
            const { tenantId, monitorId, userId, certInfo } = data;

            if (!tenantId || !userId || !certInfo) {
                log.warn("heartbeat-relay", "Invalid cert info data received");
                return;
            }

            emitToUser(this.io, tenantId, userId, "certInfo", monitorId, certInfo);
            this.stats.certInfoUpdates++;

            log.debug("heartbeat-relay", `Relayed cert info for monitor ${monitorId}`);
        } catch (error) {
            log.error("heartbeat-relay", `Error handling cert info: ${error.message}`);
            this.stats.errors++;
        }
    }

    /**
     * Get service statistics
     * @returns {object}
     */
    getStats() {
        return {
            initialized: this.initialized,
            ...this.stats,
        };
    }

    /**
     * Check if the service is ready
     * @returns {boolean}
     */
    isReady() {
        return this.initialized && this.io !== null;
    }
}

module.exports = {
    HeartbeatRelayService,
};
