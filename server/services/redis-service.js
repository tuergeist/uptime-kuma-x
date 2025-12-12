/**
 * Redis Service - Singleton for Redis client management
 * Used for pub/sub communication between API servers and workers
 */
const { createClient } = require("redis");
const { log } = require("../../src/util");

class RedisService {
    /**
     * Singleton instance
     * @type {RedisService}
     */
    static instance = null;

    /**
     * Redis client for publishing messages
     * @type {import("redis").RedisClientType}
     */
    publisher = null;

    /**
     * Redis client for subscribing to messages
     * @type {import("redis").RedisClientType}
     */
    subscriber = null;

    /**
     * Connection status
     * @type {boolean}
     */
    connected = false;

    /**
     * Redis URL from environment
     * @type {string|null}
     */
    redisUrl = null;

    /**
     * Get the singleton instance
     * @returns {RedisService}
     */
    static getInstance() {
        if (RedisService.instance === null) {
            RedisService.instance = new RedisService();
        }
        return RedisService.instance;
    }

    /**
     * Check if Redis is configured
     * @returns {boolean}
     */
    static isConfigured() {
        return !!process.env.REDIS_URL;
    }

    /**
     * Constructor
     */
    constructor() {
        this.redisUrl = process.env.REDIS_URL || null;
    }

    /**
     * Connect to Redis
     * Creates both publisher and subscriber clients
     * @returns {Promise<void>}
     */
    async connect() {
        if (!this.redisUrl) {
            log.warn("redis", "REDIS_URL not configured, Redis features disabled");
            return;
        }

        if (this.connected) {
            log.debug("redis", "Already connected to Redis");
            return;
        }

        try {
            log.info("redis", `Connecting to Redis at ${this.redisUrl.replace(/\/\/.*@/, "//***@")}`);

            // Create publisher client
            this.publisher = createClient({
                url: this.redisUrl,
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            log.error("redis", "Max reconnection attempts reached for publisher");
                            return new Error("Max reconnection attempts reached");
                        }
                        return Math.min(retries * 100, 3000);
                    }
                }
            });

            // Create subscriber client (separate connection required for pub/sub)
            this.subscriber = createClient({
                url: this.redisUrl,
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            log.error("redis", "Max reconnection attempts reached for subscriber");
                            return new Error("Max reconnection attempts reached");
                        }
                        return Math.min(retries * 100, 3000);
                    }
                }
            });

            // Set up error handlers
            this.publisher.on("error", (err) => {
                log.error("redis", `Publisher error: ${err.message}`);
            });

            this.subscriber.on("error", (err) => {
                log.error("redis", `Subscriber error: ${err.message}`);
            });

            // Connect both clients
            await Promise.all([
                this.publisher.connect(),
                this.subscriber.connect()
            ]);

            this.connected = true;
            log.info("redis", "Successfully connected to Redis");

        } catch (error) {
            log.error("redis", `Failed to connect to Redis: ${error.message}`);
            this.connected = false;
            throw error;
        }
    }

    /**
     * Disconnect from Redis
     * @returns {Promise<void>}
     */
    async disconnect() {
        if (!this.connected) {
            return;
        }

        try {
            log.info("redis", "Disconnecting from Redis...");

            const disconnectPromises = [];

            if (this.publisher) {
                disconnectPromises.push(this.publisher.quit().catch(() => {}));
            }

            if (this.subscriber) {
                disconnectPromises.push(this.subscriber.quit().catch(() => {}));
            }

            await Promise.all(disconnectPromises);

            this.publisher = null;
            this.subscriber = null;
            this.connected = false;

            log.info("redis", "Disconnected from Redis");

        } catch (error) {
            log.error("redis", `Error disconnecting from Redis: ${error.message}`);
        }
    }

    /**
     * Publish a message to a channel
     * @param {string} channel - Channel name
     * @param {object} data - Data to publish (will be JSON stringified)
     * @returns {Promise<void>}
     */
    async publish(channel, data) {
        if (!this.connected || !this.publisher) {
            log.warn("redis", "Cannot publish: Redis not connected");
            return;
        }

        try {
            const message = JSON.stringify(data);
            await this.publisher.publish(channel, message);
            log.debug("redis", `Published to ${channel}: ${message.substring(0, 100)}...`);
        } catch (error) {
            log.error("redis", `Failed to publish to ${channel}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Subscribe to a channel
     * @param {string} channel - Channel name
     * @param {function} callback - Callback function(data) called when message received
     * @returns {Promise<void>}
     */
    async subscribe(channel, callback) {
        if (!this.connected || !this.subscriber) {
            log.warn("redis", "Cannot subscribe: Redis not connected");
            return;
        }

        try {
            await this.subscriber.subscribe(channel, (message) => {
                try {
                    const data = JSON.parse(message);
                    callback(data);
                } catch (error) {
                    log.error("redis", `Failed to parse message from ${channel}: ${error.message}`);
                }
            });

            log.info("redis", `Subscribed to channel: ${channel}`);

        } catch (error) {
            log.error("redis", `Failed to subscribe to ${channel}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Unsubscribe from a channel
     * @param {string} channel - Channel name
     * @returns {Promise<void>}
     */
    async unsubscribe(channel) {
        if (!this.connected || !this.subscriber) {
            return;
        }

        try {
            await this.subscriber.unsubscribe(channel);
            log.info("redis", `Unsubscribed from channel: ${channel}`);
        } catch (error) {
            log.error("redis", `Failed to unsubscribe from ${channel}: ${error.message}`);
        }
    }

    /**
     * Check Redis connection health
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        if (!this.connected || !this.publisher) {
            return false;
        }

        try {
            const pong = await this.publisher.ping();
            return pong === "PONG";
        } catch (error) {
            log.error("redis", `Health check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Get connection status
     * @returns {object}
     */
    getStatus() {
        return {
            configured: RedisService.isConfigured(),
            connected: this.connected,
            url: this.redisUrl ? this.redisUrl.replace(/\/\/.*@/, "//***@") : null,
        };
    }

    /**
     * Get the raw publisher client (for advanced use cases like Socket.io adapter)
     * @returns {import("redis").RedisClientType|null}
     */
    getPublisherClient() {
        return this.publisher;
    }

    /**
     * Get the raw subscriber client (for advanced use cases)
     * @returns {import("redis").RedisClientType|null}
     */
    getSubscriberClient() {
        return this.subscriber;
    }
}

module.exports = {
    RedisService,
};
