/**
 * Tenant Helper Utilities
 * Common functions for extracting tenant context in queries
 */

/**
 * Get tenant ID from a Socket.IO socket
 * Falls back to 1 (default tenant) for backwards compatibility
 * @param {object} socket Socket.IO socket instance
 * @returns {number} Tenant ID
 */
function getTenantIdFromSocket(socket) {
    return socket?.tenantId || 1;
}

/**
 * Get tenant ID from an Express request
 * Falls back to 1 (default tenant) for backwards compatibility
 * @param {object} req Express request object
 * @returns {number} Tenant ID
 */
function getTenantIdFromReq(req) {
    return req?.tenant?.id || 1;
}

/**
 * Get tenant ID from a user object
 * Falls back to 1 (default tenant) for backwards compatibility
 * @param {object} user User object from database
 * @returns {number} Tenant ID
 */
function getTenantIdFromUser(user) {
    return user?.tenant_id || 1;
}

/**
 * Get tenant ID from a monitor object
 * Falls back to 1 (default tenant) for backwards compatibility
 * @param {object} monitor Monitor object from database
 * @returns {number} Tenant ID
 */
function getTenantIdFromMonitor(monitor) {
    return monitor?.tenant_id || 1;
}

/**
 * Validate that a resource belongs to the expected tenant
 * @param {object} resource Database resource with tenant_id
 * @param {number} expectedTenantId Expected tenant ID
 * @returns {boolean} True if tenant matches
 */
function validateTenantOwnership(resource, expectedTenantId) {
    if (!resource || !expectedTenantId) {
        return false;
    }
    return resource.tenant_id === expectedTenantId;
}

/**
 * Add tenant condition to a WHERE clause
 * @param {string} conditions Existing WHERE conditions
 * @param {string} tableAlias Optional table alias (e.g., "m" for "monitor m")
 * @returns {string} Conditions with tenant_id added
 */
function addTenantCondition(conditions, tableAlias = "") {
    const prefix = tableAlias ? `${tableAlias}.` : "";
    const trimmed = conditions.trim();

    if (!trimmed) {
        return ` ${prefix}tenant_id = ? `;
    }

    return ` ${prefix}tenant_id = ? AND (${trimmed}) `;
}

module.exports = {
    getTenantIdFromSocket,
    getTenantIdFromReq,
    getTenantIdFromUser,
    getTenantIdFromMonitor,
    validateTenantOwnership,
    addTenantCondition,
};
