/**
 * Worker Health Server - HTTP health check endpoint for workers
 *
 * Provides /health and /ready endpoints for Kubernetes probes
 * and monitoring systems.
 */
const http = require("http");
const { log } = require("../../src/util");

class WorkerHealthServer {
    /**
     * Worker reference
     * @type {object}
     */
    worker = null;

    /**
     * HTTP server
     * @type {http.Server}
     */
    server = null;

    /**
     * Port to listen on
     * @type {number}
     */
    port = 3002;

    /**
     * Create a new WorkerHealthServer
     * @param {object} worker - MonitorWorker instance
     * @param {number} port - Port to listen on
     */
    constructor(worker, port = 3002) {
        this.worker = worker;
        this.port = port;
    }

    /**
     * Start the health server
     * @returns {Promise<void>}
     */
    async start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on("error", (error) => {
                log.error("health", `Health server error: ${error.message}`);
                reject(error);
            });

            this.server.listen(this.port, () => {
                log.info("health", `Health server listening on port ${this.port}`);
                resolve();
            });
        });
    }

    /**
     * Stop the health server
     * @returns {Promise<void>}
     */
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    log.info("health", "Health server stopped");
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle incoming HTTP requests
     * @param {http.IncomingMessage} req - Request
     * @param {http.ServerResponse} res - Response
     */
    handleRequest(req, res) {
        const url = req.url;

        if (url === "/health" || url === "/healthz") {
            this.handleHealthCheck(req, res);
        } else if (url === "/ready" || url === "/readyz") {
            this.handleReadyCheck(req, res);
        } else if (url === "/status") {
            this.handleStatusCheck(req, res);
        } else if (url === "/metrics") {
            this.handleMetrics(req, res);
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        }
    }

    /**
     * Handle /health endpoint (liveness probe)
     * Returns 200 if the worker process is alive
     */
    handleHealthCheck(req, res) {
        // Basic liveness - process is running
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            timestamp: new Date().toISOString(),
        }));
    }

    /**
     * Handle /ready endpoint (readiness probe)
     * Returns 200 if the worker is ready to process monitors
     */
    handleReadyCheck(req, res) {
        const status = this.worker.getStatus();

        if (status.running && !status.shuttingDown) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "ready",
                workerId: status.workerId,
                pubsubAvailable: status.pubsubAvailable,
                timestamp: new Date().toISOString(),
            }));
        } else {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "not_ready",
                running: status.running,
                shuttingDown: status.shuttingDown,
                timestamp: new Date().toISOString(),
            }));
        }
    }

    /**
     * Handle /status endpoint (detailed status)
     */
    handleStatusCheck(req, res) {
        const status = this.worker.getStatus();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            ...status,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
        }));
    }

    /**
     * Handle /metrics endpoint (Prometheus format)
     */
    handleMetrics(req, res) {
        const status = this.worker.getStatus();

        const metrics = [
            `# HELP uptime_kuma_worker_running Whether the worker is running`,
            `# TYPE uptime_kuma_worker_running gauge`,
            `uptime_kuma_worker_running{worker_id="${status.workerId}"} ${status.running ? 1 : 0}`,
            ``,
            `# HELP uptime_kuma_worker_checks_processed Total number of checks processed`,
            `# TYPE uptime_kuma_worker_checks_processed counter`,
            `uptime_kuma_worker_checks_processed{worker_id="${status.workerId}"} ${status.checksProcessed}`,
            ``,
            `# HELP uptime_kuma_worker_inflight_checks Current number of in-flight checks`,
            `# TYPE uptime_kuma_worker_inflight_checks gauge`,
            `uptime_kuma_worker_inflight_checks{worker_id="${status.workerId}"} ${status.inFlightChecks}`,
            ``,
            `# HELP uptime_kuma_worker_pubsub_available Whether Redis pub/sub is available`,
            `# TYPE uptime_kuma_worker_pubsub_available gauge`,
            `uptime_kuma_worker_pubsub_available{worker_id="${status.workerId}"} ${status.pubsubAvailable ? 1 : 0}`,
            ``,
        ].join("\n");

        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(metrics);
    }
}

module.exports = {
    WorkerHealthServer,
};
