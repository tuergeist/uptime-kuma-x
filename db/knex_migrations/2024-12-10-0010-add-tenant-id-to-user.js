/**
 * Migration: Add tenant_id and role to user table
 * Part of multi-tenancy Phase 2 - Schema Modifications
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("user", "tenant_id");
    if (hasColumn) {
        return;
    }

    // Add tenant_id and role columns
    await knex.schema.alterTable("user", (table) => {
        table.integer("tenant_id").unsigned().nullable();
        table.string("role", 20).defaultTo("member"); // owner, admin, member
    });

    // Backfill existing users with default tenant (id=1)
    await knex("user").whereNull("tenant_id").update({ tenant_id: 1 });

    // Add foreign key reference to tenant table
    await knex.schema.alterTable("user", (table) => {
        table.foreign("tenant_id")
            .references("id")
            .inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.index("tenant_id", "user_tenant_id_index");
        table.index([ "tenant_id", "role" ], "user_tenant_role_index");
    });
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("user", "tenant_id");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("user", (table) => {
        table.dropIndex([], "user_tenant_role_index");
        table.dropIndex([], "user_tenant_id_index");
        table.dropForeign("tenant_id");
        table.dropColumn("tenant_id");
        table.dropColumn("role");
    });
};
