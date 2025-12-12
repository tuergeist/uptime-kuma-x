/**
 * LRU Cache for tenant lookups
 * Provides fast in-memory caching with TTL expiration
 */

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Simple LRU Cache with TTL support
 */
class TenantCache {
    /**
     * Create a new TenantCache
     * @param {number} maxSize Maximum number of entries
     * @param {number} ttl Time-to-live in milliseconds
     */
    constructor(maxSize = DEFAULT_MAX_SIZE, ttl = DEFAULT_TTL) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    /**
     * Get a value from cache
     * @param {string} key Cache key
     * @returns {*} Cached value or null if not found/expired
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        // Check expiration
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }

        // Move to end for LRU ordering
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value;
    }

    /**
     * Set a value in cache
     * @param {string} key Cache key
     * @param {*} value Value to cache
     */
    set(key, value) {
        // Evict oldest entry if at capacity
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            value,
            expiry: Date.now() + this.ttl
        });
    }

    /**
     * Delete a specific key from cache
     * @param {string} key Cache key
     */
    delete(key) {
        this.cache.delete(key);
    }

    /**
     * Clear all entries from cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Invalidate all cache entries for a specific tenant
     * @param {number} tenantId Tenant ID to invalidate
     */
    invalidateTenant(tenantId) {
        for (const [key, entry] of this.cache) {
            if (entry.value?.id === tenantId) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get current cache size
     * @returns {number} Number of entries in cache
     */
    get size() {
        return this.cache.size;
    }
}

// Singleton cache instances for different lookup types
const subdomainCache = new TenantCache();
const domainCache = new TenantCache();
const idCache = new TenantCache();

/**
 * Invalidate all caches for a tenant
 * @param {number} tenantId Tenant ID to invalidate
 */
function invalidateAllCaches(tenantId) {
    subdomainCache.invalidateTenant(tenantId);
    domainCache.invalidateTenant(tenantId);
    idCache.delete(String(tenantId));
}

module.exports = {
    TenantCache,
    subdomainCache,
    domainCache,
    idCache,
    invalidateAllCaches,
};
