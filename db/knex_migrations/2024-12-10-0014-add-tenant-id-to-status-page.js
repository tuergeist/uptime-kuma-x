/**
 * Migration: Add tenant_id to status_page table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * Note: Also changes slug uniqueness from global to per-tenant
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("status_page", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id column
    await knex.schema.alterTable("status_page", (table) => {
        table.integer("tenant_id").unsigned().nullable();
    });

    // Backfill existing status pages with default tenant (id=1)
    await knex("status_page").whereNull("tenant_id").update({ tenant_id: 1 });

    // Drop the existing unique constraint on slug
    // This needs to be done carefully for cross-DB compatibility
    const dbType = knex.client.config.client;
    try {
        if (dbType === "pg") {
            // PostgreSQL - drop the unique constraint
            await knex.raw("ALTER TABLE status_page DROP CONSTRAINT IF EXISTS status_page_slug_unique");
        } else if (dbType === "mysql2" || dbType === "mysql") {
            // MySQL/MariaDB - drop the unique index
            await knex.raw("ALTER TABLE status_page DROP INDEX status_page_slug_unique");
        } else {
            // SQLite - need to use knex's dropUnique
            await knex.schema.alterTable("status_page", (table) => {
                table.dropUnique("slug");
            });
        }
    } catch (err) {
        // Constraint might not exist or have different name, continue
        console.log("Note: Could not drop slug unique constraint (may not exist):", err.message);
    }

    // Add foreign key, indexes, and new composite unique constraint
    await knex.schema.alterTable("status_page", (table) => {
        table.foreign("tenant_id")
            .references("id")
            .inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.index("tenant_id", "status_page_tenant_id_index");
        // New: slug is unique per tenant, not globally
        table.unique([ "tenant_id", "slug" ], { indexName: "status_page_tenant_slug_unique" });
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("status_page", "tenant_id");
    if (!hasColumn) {
        return;
    }

    // Drop the composite unique and restore original
    await knex.schema.alterTable("status_page", (table) => {
        table.dropUnique([ "tenant_id", "slug" ], "status_page_tenant_slug_unique");
        table.dropIndex([], "status_page_tenant_id_index");
        table.dropForeign("tenant_id");
        table.dropColumn("tenant_id");
        // Restore original unique constraint on slug
        table.unique("slug");
    });
};
