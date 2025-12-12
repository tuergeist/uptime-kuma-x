/**
 * Migration: Add tenant_id to tag table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("tag", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id column
    await knex.schema.alterTable("tag", (table) => {
        table.integer("tenant_id").unsigned().nullable();
    });

    // Backfill existing tags with default tenant (id=1)
    await knex("tag").whereNull("tenant_id").update({ tenant_id: 1 });

    // Add foreign key and index
    await knex.schema.alterTable("tag", (table) => {
        table.foreign("tenant_id")
            .references("id")
            .inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.index("tenant_id", "tag_tenant_id_index");
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("tag", "tenant_id");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("tag", (table) => {
        table.dropIndex([], "tag_tenant_id_index");
        table.dropForeign("tenant_id");
        table.dropColumn("tenant_id");
    });
};
