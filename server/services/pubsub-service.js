/**
 * Pub/Sub Service - High-level pub/sub operations for worker architecture
 * Wraps RedisService with domain-specific methods
 */
const { RedisService } = require("./redis-service");
const {
    CHANNEL_HEARTBEAT,
    CHANNEL_IMPORTANT_HEARTBEAT,
    CHANNEL_MONITOR_STATUS,
    CHANNEL_MONITOR_STATS,
    CHANNEL_WORKER_HEARTBEAT,
    CHANNEL_WORKER_COMMAND,
    CHANNEL_CERT_INFO,
    CHANNEL_MAINTENANCE,
} = require("./pubsub-channels");
const { log } = require("../../src/util");

class PubSubService {
    /**
     * Singleton instance
     * @type {PubSubService}
     */
    static instance = null;

    /**
     * Redis service instance
     * @type {RedisService}
     */
    redis = null;

    /**
     * Registered callbacks for channels
     * @type {Map<string, Function[]>}
     */
    callbacks = new Map();

    /**
     * Get the singleton instance
     * @returns {PubSubService}
     */
    static getInstance() {
        if (PubSubService.instance === null) {
            PubSubService.instance = new PubSubService();
        }
        return PubSubService.instance;
    }

    /**
     * Constructor
     */
    constructor() {
        this.redis = RedisService.getInstance();
    }

    /**
     * Initialize the pub/sub service
     * @returns {Promise<void>}
     */
    async init() {
        if (!RedisService.isConfigured()) {
            log.info("pubsub", "Redis not configured, pub/sub disabled");
            return;
        }

        await this.redis.connect();
        log.info("pubsub", "Pub/Sub service initialized");
    }

    /**
     * Shutdown the pub/sub service
     * @returns {Promise<void>}
     */
    async shutdown() {
        await this.redis.disconnect();
        this.callbacks.clear();
        log.info("pubsub", "Pub/Sub service shut down");
    }

    /**
     * Check if pub/sub is available
     * @returns {boolean}
     */
    isAvailable() {
        return this.redis.connected;
    }

    // ==================== HEARTBEAT PUBLISHING ====================

    /**
     * Publish a heartbeat from a worker
     * @param {number} tenantId - Tenant ID
     * @param {number} monitorId - Monitor ID
     * @param {number} userId - User ID
     * @param {object} heartbeat - Heartbeat data (from bean.toJSON())
     * @returns {Promise<void>}
     */
    async publishHeartbeat(tenantId, monitorId, userId, heartbeat) {
        await this.redis.publish(CHANNEL_HEARTBEAT, {
            tenantId,
            monitorId,
            userId,
            heartbeat,
            timestamp: Date.now(),
        });
    }

    /**
     * Publish an important heartbeat (status change)
     * @param {number} tenantId - Tenant ID
     * @param {number} monitorId - Monitor ID
     * @param {number} userId - User ID
     * @param {object} heartbeat - Heartbeat data
     * @param {boolean} isFirstBeat - Is this the first heartbeat
     * @returns {Promise<void>}
     */
    async publishImportantHeartbeat(tenantId, monitorId, userId, heartbeat, isFirstBeat) {
        await this.redis.publish(CHANNEL_IMPORTANT_HEARTBEAT, {
            tenantId,
            monitorId,
            userId,
            heartbeat,
            isFirstBeat,
            timestamp: Date.now(),
        });
    }

    // ==================== MONITOR STATUS ====================

    /**
     * Publish monitor status change
     * @param {number} tenantId - Tenant ID
     * @param {number} monitorId - Monitor ID
     * @param {number} status - New status
     * @param {number} previousStatus - Previous status
     * @returns {Promise<void>}
     */
    async publishMonitorStatus(tenantId, monitorId, status, previousStatus) {
        await this.redis.publish(CHANNEL_MONITOR_STATUS, {
            tenantId,
            monitorId,
            status,
            previousStatus,
            timestamp: Date.now(),
        });
    }

    /**
     * Publish monitor statistics update
     * @param {number} tenantId - Tenant ID
     * @param {number} monitorId - Monitor ID
     * @param {number} userId - User ID
     * @param {object} stats - Statistics data (avgPing, uptime, etc.)
     * @returns {Promise<void>}
     */
    async publishMonitorStats(tenantId, monitorId, userId, stats) {
        await this.redis.publish(CHANNEL_MONITOR_STATS, {
            tenantId,
            monitorId,
            userId,
            stats,
            timestamp: Date.now(),
        });
    }

    /**
     * Publish certificate info update
     * @param {number} tenantId - Tenant ID
     * @param {number} monitorId - Monitor ID
     * @param {number} userId - User ID
     * @param {object} certInfo - Certificate information
     * @returns {Promise<void>}
     */
    async publishCertInfo(tenantId, monitorId, userId, certInfo) {
        await this.redis.publish(CHANNEL_CERT_INFO, {
            tenantId,
            monitorId,
            userId,
            certInfo,
            timestamp: Date.now(),
        });
    }

    // ==================== WORKER COMMUNICATION ====================

    /**
     * Publish worker heartbeat (worker reporting its status)
     * @param {string} workerId - Worker ID
     * @param {string} status - Worker status (running, idle, stopping)
     * @param {number} checksProcessed - Number of checks processed
     * @param {Date|null} lastCheckAt - Last check timestamp
     * @returns {Promise<void>}
     */
    async publishWorkerHeartbeat(workerId, status, checksProcessed, lastCheckAt) {
        await this.redis.publish(CHANNEL_WORKER_HEARTBEAT, {
            workerId,
            status,
            checksProcessed,
            lastCheckAt: lastCheckAt ? lastCheckAt.toISOString() : null,
            timestamp: Date.now(),
        });
    }

    /**
     * Publish a command to workers
     * @param {string} command - Command type (from WORKER_COMMANDS)
     * @param {number|null} monitorId - Monitor ID (if applicable)
     * @param {number|null} tenantId - Tenant ID (if applicable)
     * @param {object} data - Additional command data
     * @returns {Promise<void>}
     */
    async publishWorkerCommand(command, monitorId = null, tenantId = null, data = {}) {
        await this.redis.publish(CHANNEL_WORKER_COMMAND, {
            command,
            monitorId,
            tenantId,
            data,
            timestamp: Date.now(),
        });
    }

    // ==================== MAINTENANCE ====================

    /**
     * Publish maintenance status change
     * @param {number} tenantId - Tenant ID
     * @param {number} maintenanceId - Maintenance ID
     * @param {number} userId - User ID
     * @param {string} status - Maintenance status
     * @returns {Promise<void>}
     */
    async publishMaintenanceStatus(tenantId, maintenanceId, userId, status) {
        await this.redis.publish(CHANNEL_MAINTENANCE, {
            tenantId,
            maintenanceId,
            userId,
            status,
            timestamp: Date.now(),
        });
    }

    // ==================== SUBSCRIPTIONS ====================

    /**
     * Subscribe to heartbeat channel
     * @param {function} callback - Callback(data) when heartbeat received
     * @returns {Promise<void>}
     */
    async subscribeToHeartbeats(callback) {
        await this.redis.subscribe(CHANNEL_HEARTBEAT, callback);
        this._addCallback(CHANNEL_HEARTBEAT, callback);
    }

    /**
     * Subscribe to important heartbeats
     * @param {function} callback - Callback(data) when important heartbeat received
     * @returns {Promise<void>}
     */
    async subscribeToImportantHeartbeats(callback) {
        await this.redis.subscribe(CHANNEL_IMPORTANT_HEARTBEAT, callback);
        this._addCallback(CHANNEL_IMPORTANT_HEARTBEAT, callback);
    }

    /**
     * Subscribe to monitor status changes
     * @param {function} callback - Callback(data) when status changes
     * @returns {Promise<void>}
     */
    async subscribeToMonitorStatus(callback) {
        await this.redis.subscribe(CHANNEL_MONITOR_STATUS, callback);
        this._addCallback(CHANNEL_MONITOR_STATUS, callback);
    }

    /**
     * Subscribe to monitor stats updates
     * @param {function} callback - Callback(data) when stats updated
     * @returns {Promise<void>}
     */
    async subscribeToMonitorStats(callback) {
        await this.redis.subscribe(CHANNEL_MONITOR_STATS, callback);
        this._addCallback(CHANNEL_MONITOR_STATS, callback);
    }

    /**
     * Subscribe to certificate info updates
     * @param {function} callback - Callback(data) when cert info updated
     * @returns {Promise<void>}
     */
    async subscribeToCertInfo(callback) {
        await this.redis.subscribe(CHANNEL_CERT_INFO, callback);
        this._addCallback(CHANNEL_CERT_INFO, callback);
    }

    /**
     * Subscribe to worker heartbeats
     * @param {function} callback - Callback(data) when worker reports
     * @returns {Promise<void>}
     */
    async subscribeToWorkerHeartbeats(callback) {
        await this.redis.subscribe(CHANNEL_WORKER_HEARTBEAT, callback);
        this._addCallback(CHANNEL_WORKER_HEARTBEAT, callback);
    }

    /**
     * Subscribe to worker commands
     * @param {function} callback - Callback(data) when command received
     * @returns {Promise<void>}
     */
    async subscribeToWorkerCommands(callback) {
        await this.redis.subscribe(CHANNEL_WORKER_COMMAND, callback);
        this._addCallback(CHANNEL_WORKER_COMMAND, callback);
    }

    /**
     * Subscribe to maintenance updates
     * @param {function} callback - Callback(data) when maintenance changes
     * @returns {Promise<void>}
     */
    async subscribeToMaintenance(callback) {
        await this.redis.subscribe(CHANNEL_MAINTENANCE, callback);
        this._addCallback(CHANNEL_MAINTENANCE, callback);
    }

    // ==================== HELPER METHODS ====================

    /**
     * Add callback to internal tracking
     * @param {string} channel - Channel name
     * @param {function} callback - Callback function
     * @private
     */
    _addCallback(channel, callback) {
        if (!this.callbacks.has(channel)) {
            this.callbacks.set(channel, []);
        }
        this.callbacks.get(channel).push(callback);
    }

    /**
     * Get service status
     * @returns {object}
     */
    getStatus() {
        return {
            available: this.isAvailable(),
            redis: this.redis.getStatus(),
            subscriptions: Array.from(this.callbacks.keys()),
        };
    }
}

module.exports = {
    PubSubService,
};
