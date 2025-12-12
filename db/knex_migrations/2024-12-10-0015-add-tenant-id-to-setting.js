/**
 * Migration: Add tenant_id to setting table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * Note: Also changes key uniqueness from global to per-tenant
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("setting", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id column
    await knex.schema.alterTable("setting", (table) => {
        table.integer("tenant_id").unsigned().nullable();
    });

    // Backfill existing settings with default tenant (id=1)
    // Note: Global settings will have tenant_id=1, tenant-specific settings
    // will be created with their own tenant_id going forward
    await knex("setting").whereNull("tenant_id").update({ tenant_id: 1 });

    // Drop the existing unique constraint on key
    const dbType = knex.client.config.client;
    try {
        if (dbType === "pg") {
            await knex.raw("ALTER TABLE setting DROP CONSTRAINT IF EXISTS setting_key_unique");
        } else if (dbType === "mysql2" || dbType === "mysql") {
            await knex.raw("ALTER TABLE setting DROP INDEX setting_key_unique");
        } else {
            // SQLite
            await knex.schema.alterTable("setting", (table) => {
                table.dropUnique("key");
            });
        }
    } catch (err) {
        console.log("Note: Could not drop key unique constraint (may not exist):", err.message);
    }

    // Add foreign key, index, and new composite unique constraint
    await knex.schema.alterTable("setting", (table) => {
        table.foreign("tenant_id")
            .references("id")
            .inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.index("tenant_id", "setting_tenant_id_index");
        // New: key is unique per tenant, not globally
        table.unique([ "tenant_id", "key" ], { indexName: "setting_tenant_key_unique" });
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("setting", "tenant_id");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("setting", (table) => {
        table.dropUnique([ "tenant_id", "key" ], "setting_tenant_key_unique");
        table.dropIndex([], "setting_tenant_id_index");
        table.dropForeign("tenant_id");
        table.dropColumn("tenant_id");
        // Restore original unique constraint
        table.unique("key");
    });
};
