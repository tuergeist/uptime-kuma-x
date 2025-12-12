/**
 * Tenant Resolution Middleware
 *
 * Resolves the current tenant from the request using multiple strategies:
 * 1. Subdomain extraction (acme.uptime.example.com → "acme")
 * 2. Custom domain lookup (status.acme.com → tenant_domain table)
 * 3. X-Tenant-ID header (for API clients/testing)
 * 4. Default tenant fallback
 *
 * Sets req.tenant with tenant information for downstream use.
 */

const { R } = require("redbean-node");
const { subdomainCache, domainCache, idCache } = require("../utils/tenant-cache");
const { log } = require("../../src/util");

// Configuration from environment
const BASE_DOMAIN = process.env.TENANT_DOMAIN || "localhost";
const MULTI_TENANT_ENABLED = process.env.MULTI_TENANT === "true";

/**
 * Convert a tenant bean to a plain object
 * @param {object} tenant Tenant bean from database
 * @returns {object} Plain tenant object
 */
function tenantToObject(tenant) {
    if (!tenant) {
        return null;
    }
    return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        plan_id: tenant.plan_id,
        status: tenant.status,
    };
}

/**
 * Get the default tenant (slug="default" or id=1)
 * @returns {Promise<object|null>} Default tenant object
 */
async function getDefaultTenant() {
    // Check cache first
    const cached = idCache.get("default");
    if (cached) {
        return cached;
    }

    // Query database
    // Use status='active' instead of boolean active column
    let tenant = await R.findOne("tenant", " slug = ? AND status = ? ", ["default", "active"]);

    // Fallback to id=1 if no "default" slug
    if (!tenant) {
        tenant = await R.findOne("tenant", " id = ? AND status = ? ", [1, "active"]);
    }

    if (tenant) {
        const result = tenantToObject(tenant);
        idCache.set("default", result);
        return result;
    }

    return null;
}

/**
 * Resolve tenant from subdomain
 * @param {object} req Express request
 * @returns {Promise<object|null>} Tenant object or null
 */
async function resolveFromSubdomain(req) {
    const host = req.hostname || req.headers.host?.split(":")[0];

    if (!host) {
        return null;
    }

    // Check if host ends with base domain
    if (!host.endsWith(BASE_DOMAIN)) {
        return null;
    }

    // Extract subdomain
    const subdomain = host.replace(`.${BASE_DOMAIN}`, "");

    // Skip if no subdomain, same as host, or is "www"
    if (!subdomain || subdomain === host || subdomain === "www" || subdomain === BASE_DOMAIN) {
        return null;
    }

    log.debug("tenant", `Resolving subdomain: ${subdomain}`);

    // Check cache first
    const cached = subdomainCache.get(subdomain);
    if (cached) {
        log.debug("tenant", `Cache hit for subdomain: ${subdomain}`);
        return cached;
    }

    // Query database
    // Use status='active' instead of boolean active column
    const tenant = await R.findOne("tenant", " slug = ? AND status = ? ", [subdomain, "active"]);

    if (tenant) {
        const result = tenantToObject(tenant);
        subdomainCache.set(subdomain, result);
        log.debug("tenant", `Found tenant for subdomain ${subdomain}: ${result.name}`);
        return result;
    }

    log.debug("tenant", `No tenant found for subdomain: ${subdomain}`);
    return null;
}

/**
 * Resolve tenant from custom domain
 * @param {object} req Express request
 * @returns {Promise<object|null>} Tenant object or null
 */
async function resolveFromCustomDomain(req) {
    const host = req.hostname || req.headers.host?.split(":")[0];

    if (!host) {
        return null;
    }

    // Skip if this looks like a subdomain of base domain
    if (host.endsWith(BASE_DOMAIN)) {
        return null;
    }

    log.debug("tenant", `Checking custom domain: ${host}`);

    // Check cache first
    const cached = domainCache.get(host);
    if (cached) {
        log.debug("tenant", `Cache hit for domain: ${host}`);
        return cached;
    }

    // Look up in tenant_domain table
    const domainRecord = await R.findOne("tenant_domain", " domain = ? AND verified = 1 ", [host]);

    if (!domainRecord) {
        log.debug("tenant", `No verified domain record for: ${host}`);
        return null;
    }

    // Get the associated tenant
    // Use status='active' instead of boolean active column
    const tenant = await R.findOne("tenant", " id = ? AND status = ? ", [domainRecord.tenant_id, "active"]);

    if (tenant) {
        const result = tenantToObject(tenant);
        domainCache.set(host, result);
        log.debug("tenant", `Found tenant for domain ${host}: ${result.name}`);
        return result;
    }

    return null;
}

/**
 * Resolve tenant from X-Tenant-ID header
 * @param {object} req Express request
 * @returns {Promise<object|null>} Tenant object or null
 */
async function resolveFromHeader(req) {
    const tenantIdHeader = req.headers["x-tenant-id"];

    if (!tenantIdHeader) {
        return null;
    }

    const tenantId = parseInt(tenantIdHeader, 10);
    if (isNaN(tenantId)) {
        log.warn("tenant", `Invalid X-Tenant-ID header: ${tenantIdHeader}`);
        return null;
    }

    log.debug("tenant", `Resolving from header: ${tenantId}`);

    // Check cache first
    const cacheKey = String(tenantId);
    const cached = idCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // Query database
    // Use status='active' instead of boolean active column
    const tenant = await R.findOne("tenant", " id = ? AND status = ? ", [tenantId, "active"]);

    if (tenant) {
        const result = tenantToObject(tenant);
        idCache.set(cacheKey, result);
        return result;
    }

    log.warn("tenant", `No tenant found for ID: ${tenantId}`);
    return null;
}

/**
 * Main tenant resolution middleware
 * @param {object} req Express request
 * @param {object} res Express response
 * @param {Function} next Next middleware
 * @returns {Promise<void>}
 */
async function resolveTenant(req, res, next) {
    // If multi-tenancy is disabled, use default tenant
    if (!MULTI_TENANT_ENABLED) {
        req.tenant = await getDefaultTenant() || { id: 1, slug: "default", name: "Default" };
        return next();
    }

    let tenant = null;

    try {
        // 1. Try subdomain resolution
        tenant = await resolveFromSubdomain(req);

        // 2. Try custom domain resolution
        if (!tenant) {
            tenant = await resolveFromCustomDomain(req);
        }

        // 3. Try X-Tenant-ID header
        if (!tenant) {
            tenant = await resolveFromHeader(req);
        }

        // 4. Fall back to default tenant
        if (!tenant) {
            tenant = await getDefaultTenant();
        }

        // If still no tenant, return error
        if (!tenant) {
            log.error("tenant", "Could not resolve tenant and no default available");
            return res.status(404).json({
                ok: false,
                error: "Tenant not found",
            });
        }

        // Set tenant on request
        req.tenant = tenant;
        log.debug("tenant", `Resolved tenant: ${tenant.slug} (${tenant.id})`);

        next();
    } catch (error) {
        log.error("tenant", `Error resolving tenant: ${error.message}`);
        return res.status(500).json({
            ok: false,
            error: "Internal server error during tenant resolution",
        });
    }
}

/**
 * Middleware to require a valid tenant (fails if no tenant resolved)
 * Use after resolveTenant middleware
 * @param {object} req Express request
 * @param {object} res Express response
 * @param {Function} next Next middleware
 */
function requireTenant(req, res, next) {
    if (!req.tenant || !req.tenant.id) {
        return res.status(400).json({
            ok: false,
            error: "Tenant context required",
        });
    }
    next();
}

/**
 * Get tenant by ID (for internal use)
 * @param {number} tenantId Tenant ID
 * @returns {Promise<object|null>} Tenant object or null
 */
async function getTenantById(tenantId) {
    const cacheKey = String(tenantId);
    const cached = idCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    // Use status='active' instead of boolean active column
    const tenant = await R.findOne("tenant", " id = ? AND status = ? ", [tenantId, "active"]);
    if (tenant) {
        const result = tenantToObject(tenant);
        idCache.set(cacheKey, result);
        return result;
    }

    return null;
}

module.exports = {
    resolveTenant,
    requireTenant,
    getDefaultTenant,
    getTenantById,
    resolveFromSubdomain,
    resolveFromCustomDomain,
    resolveFromHeader,
    MULTI_TENANT_ENABLED,
    BASE_DOMAIN,
};
