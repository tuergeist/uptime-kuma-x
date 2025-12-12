/**
 * Migration: Add tenant_id to heartbeat table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * Note: This is a high-volume table; backfill derives tenant from monitor
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("heartbeat", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id column
    await knex.schema.alterTable("heartbeat", (table) => {
        table.integer("tenant_id").unsigned().nullable();
    });

    // Backfill: Get tenant_id from the heartbeat's monitor
    // This is more accurate than defaulting to tenant 1
    const dbType = knex.client.config.client;
    if (dbType === "pg") {
        await knex.raw(`
            UPDATE heartbeat h
            SET tenant_id = COALESCE(
                (SELECT m.tenant_id FROM monitor m WHERE m.id = h.monitor_id),
                1
            )
            WHERE h.tenant_id IS NULL
        `);
    } else if (dbType === "mysql2" || dbType === "mysql") {
        await knex.raw(`
            UPDATE heartbeat h
            LEFT JOIN monitor m ON m.id = h.monitor_id
            SET h.tenant_id = COALESCE(m.tenant_id, 1)
            WHERE h.tenant_id IS NULL
        `);
    } else {
        // SQLite - simple approach (subquery in UPDATE not well supported)
        await knex("heartbeat").whereNull("tenant_id").update({ tenant_id: 1 });
    }

    // Add index for query performance
    // Note: Not adding FK to avoid cascade overhead on high-volume inserts
    await knex.schema.alterTable("heartbeat", (table) => {
        table.index("tenant_id", "heartbeat_tenant_id_index");
        // Composite index for common query patterns
        table.index([ "tenant_id", "monitor_id", "time" ], "heartbeat_tenant_monitor_time_index");
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("heartbeat", "tenant_id");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("heartbeat", (table) => {
        table.dropIndex([], "heartbeat_tenant_monitor_time_index");
        table.dropIndex([], "heartbeat_tenant_id_index");
        table.dropColumn("tenant_id");
    });
};
