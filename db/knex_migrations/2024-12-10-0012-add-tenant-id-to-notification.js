/**
 * Migration: Add tenant_id to notification table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("notification", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id column
    await knex.schema.alterTable("notification", (table) => {
        table.integer("tenant_id").unsigned().nullable();
    });

    // Backfill: Get tenant_id from the notification's user, or default to 1
    const dbType = knex.client.config.client;
    if (dbType === "pg") {
        await knex.raw(`
            UPDATE notification n
            SET tenant_id = COALESCE(
                (SELECT u.tenant_id FROM "user" u WHERE u.id = n.user_id),
                1
            )
            WHERE n.tenant_id IS NULL
        `);
    } else if (dbType === "mysql2" || dbType === "mysql") {
        await knex.raw(`
            UPDATE notification n
            LEFT JOIN user u ON u.id = n.user_id
            SET n.tenant_id = COALESCE(u.tenant_id, 1)
            WHERE n.tenant_id IS NULL
        `);
    } else {
        // SQLite - simple approach
        await knex("notification").whereNull("tenant_id").update({ tenant_id: 1 });
    }

    // Add foreign key and index
    await knex.schema.alterTable("notification", (table) => {
        table.foreign("tenant_id")
            .references("id")
            .inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.index("tenant_id", "notification_tenant_id_index");
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("notification", "tenant_id");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("notification", (table) => {
        table.dropIndex([], "notification_tenant_id_index");
        table.dropForeign("tenant_id");
        table.dropColumn("tenant_id");
    });
};
