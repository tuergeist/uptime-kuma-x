/**
 * Worker Entry Point
 *
 * Standalone entry point for running monitor workers.
 * Workers claim monitors from the schedule table, execute checks,
 * and publish results via Redis.
 *
 * Usage: node server/worker/index.js
 *
 * Environment variables:
 * - WORKER_ID: Unique worker identifier (auto-generated if not set)
 * - WORKER_BATCH_SIZE: Number of monitors to claim per batch (default: 10)
 * - WORKER_POLL_INTERVAL: Ms between claim attempts (default: 1000)
 * - REDIS_URL: Redis connection URL (required)
 * - Database env vars (same as main server)
 */
const { log } = require("../../src/util");
const Database = require("../database");
const { MonitorWorker } = require("./monitor-worker");
const { WorkerHealthServer } = require("./worker-health");

// Worker instance
let worker = null;
let healthServer = null;

/**
 * Main entry point
 */
async function main() {
    log.info("worker", "=".repeat(50));
    log.info("worker", "Uptime Kuma Monitor Worker Starting...");
    log.info("worker", "=".repeat(50));

    // Validate required environment variables
    if (!process.env.REDIS_URL) {
        log.error("worker", "REDIS_URL environment variable is required");
        process.exit(1);
    }

    // Parse configuration from environment
    const config = {
        workerId: process.env.WORKER_ID || undefined,
        batchSize: parseInt(process.env.WORKER_BATCH_SIZE || "10", 10),
        pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || "1000", 10),
        heartbeatInterval: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL || "30000", 10),
        staleClaimMinutes: parseInt(process.env.WORKER_STALE_CLAIM_MINUTES || "2", 10),
    };

    log.info("worker", `Configuration: ${JSON.stringify(config)}`);

    try {
        // Initialize database connection
        log.info("worker", "Connecting to database...");
        await Database.initDatabase();
        log.info("worker", "Database connected");

        // Load required models
        const Monitor = require("../model/monitor");
        const { UptimeKumaServer } = require("../uptime-kuma-server");
        const { UptimeCalculator } = require("../uptime-calculator");

        // Create and initialize worker
        worker = new MonitorWorker(config);
        worker.init(Monitor, UptimeKumaServer, UptimeCalculator);

        // Start health check server
        const healthPort = parseInt(process.env.WORKER_HEALTH_PORT || "3002", 10);
        healthServer = new WorkerHealthServer(worker, healthPort);
        await healthServer.start();

        // Start worker
        await worker.start();

        log.info("worker", "Worker is running. Press Ctrl+C to stop.");

    } catch (error) {
        log.error("worker", `Failed to start worker: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
    log.info("worker", `Received ${signal}, shutting down gracefully...`);

    try {
        // Stop worker
        if (worker) {
            await worker.stop();
        }

        // Stop health server
        if (healthServer) {
            await healthServer.stop();
        }

        // Close database
        await Database.close();

        log.info("worker", "Shutdown complete");
        process.exit(0);

    } catch (error) {
        log.error("worker", `Error during shutdown: ${error.message}`);
        process.exit(1);
    }
}

// Register signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
    log.error("worker", `Uncaught exception: ${error.message}`);
    console.error(error);
    shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
    log.error("worker", `Unhandled rejection at ${promise}: ${reason}`);
    // Don't exit on unhandled rejections, but log them
});

// Start the worker
main();
