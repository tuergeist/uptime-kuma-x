/**
 * Monitor Worker - Main worker class for distributed monitor execution
 *
 * Handles the main loop:
 * 1. Claim monitors from schedule table
 * 2. Execute checks
 * 3. Process results and publish to Redis
 * 4. Update schedule for next check
 */
const { v4: uuidv4 } = require("uuid");
const { log } = require("../../src/util");
const { ScheduleService } = require("../services/schedule-service");
const { PubSubService } = require("../services/pubsub-service");
const { WORKER_COMMANDS } = require("../services/pubsub-channels");
const { executeCheck, initExecutor, getPreviousBeat } = require("./monitor-executor");
const { processHeartbeat, initProcessor } = require("./heartbeat-processor");

class MonitorWorker {
    /**
     * Unique worker ID
     * @type {string}
     */
    workerId = null;

    /**
     * Whether the worker is running
     * @type {boolean}
     */
    running = false;

    /**
     * Whether shutdown has been requested
     * @type {boolean}
     */
    shuttingDown = false;

    /**
     * Number of checks processed
     * @type {number}
     */
    checksProcessed = 0;

    /**
     * Last check timestamp
     * @type {Date|null}
     */
    lastCheckAt = null;

    /**
     * Configuration
     * @type {object}
     */
    config = {
        batchSize: 10,         // Monitors to claim per batch
        pollInterval: 1000,    // Ms between claim attempts
        heartbeatInterval: 30000, // Ms between worker heartbeats
        staleClaimMinutes: 2,  // Release claims older than this
    };

    /**
     * Timers
     */
    pollTimer = null;
    heartbeatTimer = null;
    staleCleanupTimer = null;

    /**
     * Services
     */
    scheduleService = null;
    pubsubService = null;

    /**
     * Create a new MonitorWorker
     * @param {object} options - Configuration options
     */
    constructor(options = {}) {
        this.workerId = options.workerId || `worker-${uuidv4().slice(0, 8)}`;
        this.config = { ...this.config, ...options };

        this.scheduleService = ScheduleService.getInstance();
        this.pubsubService = PubSubService.getInstance();

        log.info("worker", `MonitorWorker created: ${this.workerId}`);
    }

    /**
     * Initialize the worker with required dependencies
     * @param {object} Monitor - Monitor model class
     * @param {object} UptimeKumaServer - Server class
     * @param {object} UptimeCalculator - Calculator class
     */
    init(Monitor, UptimeKumaServer, UptimeCalculator) {
        initExecutor(Monitor, UptimeKumaServer);
        initProcessor(Monitor, UptimeCalculator);
        log.info("worker", `Worker ${this.workerId} initialized with dependencies`);
    }

    /**
     * Start the worker
     * @returns {Promise<void>}
     */
    async start() {
        if (this.running) {
            log.warn("worker", `Worker ${this.workerId} is already running`);
            return;
        }

        log.info("worker", `Starting worker ${this.workerId}...`);

        // Initialize pub/sub
        await this.pubsubService.init();

        // Subscribe to worker commands
        await this.pubsubService.subscribeToWorkerCommands((data) => {
            this.handleCommand(data);
        });

        // Sync monitors to schedule table
        await this.scheduleService.syncAllMonitors();

        this.running = true;
        this.shuttingDown = false;

        // Start the main poll loop
        this.startPollLoop();

        // Start worker heartbeat
        this.startHeartbeatLoop();

        // Start stale claim cleanup
        this.startStaleCleanup();

        log.info("worker", `Worker ${this.workerId} started successfully`);
    }

    /**
     * Stop the worker gracefully
     * @returns {Promise<void>}
     */
    async stop() {
        if (!this.running) {
            return;
        }

        log.info("worker", `Stopping worker ${this.workerId}...`);
        this.shuttingDown = true;

        // Clear timers
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.staleCleanupTimer) {
            clearInterval(this.staleCleanupTimer);
            this.staleCleanupTimer = null;
        }

        // Wait for in-flight checks to complete (up to 30 seconds)
        const maxWait = 30000;
        const startWait = Date.now();
        while (this.inFlightChecks > 0 && Date.now() - startWait < maxWait) {
            log.info("worker", `Waiting for ${this.inFlightChecks} in-flight checks...`);
            await this.sleep(1000);
        }

        // Publish final worker heartbeat (stopping status)
        if (this.pubsubService.isAvailable()) {
            await this.pubsubService.publishWorkerHeartbeat(
                this.workerId,
                "stopped",
                this.checksProcessed,
                this.lastCheckAt
            );
        }

        // Shutdown pub/sub
        await this.pubsubService.shutdown();

        this.running = false;
        log.info("worker", `Worker ${this.workerId} stopped`);
    }

    /**
     * In-flight check counter
     * @type {number}
     */
    inFlightChecks = 0;

    /**
     * Start the main poll loop
     */
    startPollLoop() {
        const poll = async () => {
            if (this.shuttingDown) {
                return;
            }

            try {
                await this.claimAndProcess();
            } catch (error) {
                log.error("worker", `Poll loop error: ${error.message}`);
            }

            // Schedule next poll
            if (!this.shuttingDown) {
                this.pollTimer = setTimeout(() => poll(), this.config.pollInterval);
            }
        };

        // Start immediately
        poll();
    }

    /**
     * Claim monitors and process them
     */
    async claimAndProcess() {
        // Claim a batch of monitors
        const claimed = await this.scheduleService.claimMonitors(
            this.workerId,
            this.config.batchSize
        );

        if (claimed.length === 0) {
            return;
        }

        log.debug("worker", `Claimed ${claimed.length} monitors`);

        // Process each claimed monitor
        const processPromises = claimed.map(({ schedule, monitor }) =>
            this.processMonitor(schedule, monitor)
        );

        // Wait for all to complete
        await Promise.allSettled(processPromises);
    }

    /**
     * Process a single monitor
     * @param {object} schedule - Schedule entry
     * @param {object} monitor - Monitor data
     */
    async processMonitor(schedule, monitor) {
        this.inFlightChecks++;

        try {
            log.debug("worker", `Processing monitor ${monitor.id}: ${monitor.name}`);

            // Get previous heartbeat for comparison
            const previousBeat = await getPreviousBeat(monitor.id);
            const retries = previousBeat?.retries || 0;

            // Execute the check
            const checkResult = await executeCheck(monitor, previousBeat, retries);

            // Process the result (store, notify, publish)
            const processResult = await processHeartbeat(monitor, checkResult);

            // Update schedule
            const wasFailure = checkResult.heartbeat.status !== 1; // Not UP
            await this.scheduleService.releaseMonitor(
                schedule.id,
                checkResult.nextInterval,
                checkResult.heartbeat.status,
                checkResult.heartbeat.ping,
                wasFailure
            );

            this.checksProcessed++;
            this.lastCheckAt = new Date();

            log.debug("worker", `Completed monitor ${monitor.id}, next check in ${checkResult.nextInterval}s`);

        } catch (error) {
            log.error("worker", `Failed to process monitor ${monitor.id}: ${error.message}`);

            // Release with default interval on error
            try {
                await this.scheduleService.releaseMonitor(
                    schedule.id,
                    monitor.interval || 60,
                    null,
                    null,
                    true
                );
            } catch (releaseError) {
                log.error("worker", `Failed to release monitor ${monitor.id}: ${releaseError.message}`);
            }
        } finally {
            this.inFlightChecks--;
        }
    }

    /**
     * Start worker heartbeat publishing
     */
    startHeartbeatLoop() {
        const sendHeartbeat = async () => {
            if (!this.pubsubService.isAvailable()) {
                return;
            }

            try {
                await this.pubsubService.publishWorkerHeartbeat(
                    this.workerId,
                    this.shuttingDown ? "stopping" : "running",
                    this.checksProcessed,
                    this.lastCheckAt
                );
            } catch (error) {
                log.error("worker", `Failed to send worker heartbeat: ${error.message}`);
            }
        };

        // Send immediately
        sendHeartbeat();

        // Then on interval
        this.heartbeatTimer = setInterval(sendHeartbeat, this.config.heartbeatInterval);
    }

    /**
     * Start stale claim cleanup
     */
    startStaleCleanup() {
        const cleanup = async () => {
            try {
                await this.scheduleService.releaseStaleClaimsOlderThan(this.config.staleClaimMinutes);
            } catch (error) {
                log.error("worker", `Stale cleanup error: ${error.message}`);
            }
        };

        // Run every minute
        this.staleCleanupTimer = setInterval(cleanup, 60000);
    }

    /**
     * Handle worker command from pub/sub
     * @param {object} data - Command data
     */
    handleCommand(data) {
        const { command, monitorId, tenantId } = data;

        log.info("worker", `Received command: ${command}`);

        switch (command) {
            case WORKER_COMMANDS.SHUTDOWN:
                log.info("worker", "Received shutdown command");
                this.stop();
                break;

            case WORKER_COMMANDS.CHECK_NOW:
                if (monitorId) {
                    log.info("worker", `Check now requested for monitor ${monitorId}`);
                    // Force immediate check by updating schedule
                    this.scheduleService.activateSchedule(monitorId, 0);
                }
                break;

            default:
                log.debug("worker", `Unknown command: ${command}`);
        }
    }

    /**
     * Get worker status
     * @returns {object}
     */
    getStatus() {
        return {
            workerId: this.workerId,
            running: this.running,
            shuttingDown: this.shuttingDown,
            checksProcessed: this.checksProcessed,
            lastCheckAt: this.lastCheckAt,
            inFlightChecks: this.inFlightChecks,
            pubsubAvailable: this.pubsubService.isAvailable(),
        };
    }

    /**
     * Sleep helper
     * @param {number} ms - Milliseconds
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = {
    MonitorWorker,
};
