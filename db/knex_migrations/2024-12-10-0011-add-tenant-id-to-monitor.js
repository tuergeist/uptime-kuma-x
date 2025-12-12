/**
 * Migration: Add tenant_id to monitor table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("monitor", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id column
    await knex.schema.alterTable("monitor", (table) => {
        table.integer("tenant_id").unsigned().nullable();
    });

    // Backfill: Get tenant_id from the monitor's user, or default to 1
    // Using raw SQL for cross-DB subquery update
    const dbType = knex.client.config.client;
    if (dbType === "pg") {
        await knex.raw(`
            UPDATE monitor m
            SET tenant_id = COALESCE(
                (SELECT u.tenant_id FROM "user" u WHERE u.id = m.user_id),
                1
            )
            WHERE m.tenant_id IS NULL
        `);
    } else if (dbType === "mysql2" || dbType === "mysql") {
        await knex.raw(`
            UPDATE monitor m
            LEFT JOIN user u ON u.id = m.user_id
            SET m.tenant_id = COALESCE(u.tenant_id, 1)
            WHERE m.tenant_id IS NULL
        `);
    } else {
        // SQLite - simple approach
        await knex("monitor").whereNull("tenant_id").update({ tenant_id: 1 });
    }

    // Add foreign key and indexes for query performance
    await knex.schema.alterTable("monitor", (table) => {
        table.foreign("tenant_id")
            .references("id")
            .inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.index("tenant_id", "monitor_tenant_id_index");
        table.index([ "tenant_id", "active" ], "monitor_tenant_active_index");
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("monitor", "tenant_id");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("monitor", (table) => {
        table.dropIndex([], "monitor_tenant_active_index");
        table.dropIndex([], "monitor_tenant_id_index");
        table.dropForeign("tenant_id");
        table.dropColumn("tenant_id");
    });
};
