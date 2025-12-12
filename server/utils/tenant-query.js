/**
 * TenantQuery - A wrapper around redbean-node's R object
 * that automatically scopes all queries to a specific tenant.
 *
 * This ensures tenant isolation at the query level, preventing
 * accidental data leakage between tenants.
 */

const { R } = require("redbean-node");

/**
 * TenantQuery wraps database operations to automatically include tenant_id
 */
class TenantQuery {
    /**
     * Create a new TenantQuery instance
     * @param {number} tenantId The tenant ID to scope queries to
     * @throws {Error} If tenantId is not provided
     */
    constructor(tenantId) {
        if (!tenantId && tenantId !== 0) {
            throw new Error("TenantQuery requires a valid tenantId");
        }
        this.tenantId = tenantId;
    }

    /**
     * Prepend tenant_id condition to existing conditions
     * @param {string} conditions Existing WHERE conditions
     * @returns {string} Conditions with tenant_id prepended
     * @private
     */
    _scopeConditions(conditions = "") {
        const trimmed = conditions.trim();
        if (!trimmed) {
            return " tenant_id = ? ";
        }
        // Prepend tenant_id condition
        return ` tenant_id = ? AND (${trimmed}) `;
    }

    /**
     * Prepend tenantId to params array
     * @param {Array} params Existing parameters
     * @returns {Array} Parameters with tenantId prepended
     * @private
     */
    _scopeParams(params = []) {
        return [this.tenantId, ...params];
    }

    /**
     * Find all records matching conditions within tenant
     * @param {string} table Table name
     * @param {string} conditions WHERE conditions (without tenant_id)
     * @param {Array} params Query parameters
     * @returns {Promise<Array>} Array of matching records
     */
    async find(table, conditions = "", params = []) {
        return R.find(table, this._scopeConditions(conditions), this._scopeParams(params));
    }

    /**
     * Find one record matching conditions within tenant
     * @param {string} table Table name
     * @param {string} conditions WHERE conditions (without tenant_id)
     * @param {Array} params Query parameters
     * @returns {Promise<object|null>} Matching record or null
     */
    async findOne(table, conditions = "", params = []) {
        return R.findOne(table, this._scopeConditions(conditions), this._scopeParams(params));
    }

    /**
     * Count records matching conditions within tenant
     * @param {string} table Table name
     * @param {string} conditions WHERE conditions (without tenant_id)
     * @param {Array} params Query parameters
     * @returns {Promise<number>} Count of matching records
     */
    async count(table, conditions = "", params = []) {
        return R.count(table, this._scopeConditions(conditions), this._scopeParams(params));
    }

    /**
     * Create a new bean with tenant_id pre-set
     * @param {string} table Table name
     * @returns {object} New bean with tenant_id set
     */
    dispense(table) {
        const bean = R.dispense(table);
        bean.tenant_id = this.tenantId;
        return bean;
    }

    /**
     * Verify a record belongs to this tenant
     * @param {string} table Table name
     * @param {number} id Record ID
     * @returns {Promise<boolean>} True if record belongs to tenant
     */
    async verifyOwnership(table, id) {
        const bean = await R.findOne(table, " id = ? AND tenant_id = ? ", [id, this.tenantId]);
        return !!bean;
    }

    /**
     * Get a record by ID only if it belongs to this tenant
     * @param {string} table Table name
     * @param {number} id Record ID
     * @returns {Promise<object|null>} Record if found and owned, null otherwise
     */
    async getOwned(table, id) {
        return R.findOne(table, " id = ? AND tenant_id = ? ", [id, this.tenantId]);
    }

    /**
     * Delete a record only if it belongs to this tenant
     * @param {string} table Table name
     * @param {number} id Record ID
     * @returns {Promise<boolean>} True if deleted, false if not found/not owned
     */
    async deleteOwned(table, id) {
        const bean = await this.getOwned(table, id);
        if (bean) {
            await R.trash(bean);
            return true;
        }
        return false;
    }

    /**
     * Execute a raw SQL query scoped to tenant
     * Warning: Use carefully, conditions must be properly parameterized
     * @param {string} sql SQL query with tenant_id = ? placeholder
     * @param {Array} params Query parameters (tenantId will NOT be auto-prepended)
     * @returns {Promise<*>} Query result
     */
    async rawWithTenant(sql, params = []) {
        return R.getAll(sql, [this.tenantId, ...params]);
    }
}

/**
 * Factory function to create TenantQuery from request object
 * @param {object} req Express request with tenant context
 * @returns {TenantQuery} TenantQuery instance
 * @throws {Error} If no tenant context available
 */
function createTenantQuery(req) {
    if (!req.tenant?.id) {
        throw new Error("No tenant context available on request");
    }
    return new TenantQuery(req.tenant.id);
}

/**
 * Factory function to create TenantQuery from socket object
 * @param {object} socket Socket.IO socket with tenant context
 * @returns {TenantQuery} TenantQuery instance
 * @throws {Error} If no tenant context available
 */
function createTenantQueryFromSocket(socket) {
    if (!socket.tenantId) {
        throw new Error("No tenant context available on socket");
    }
    return new TenantQuery(socket.tenantId);
}

module.exports = {
    TenantQuery,
    createTenantQuery,
    createTenantQueryFromSocket,
};
