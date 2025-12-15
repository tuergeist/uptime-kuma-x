/**
 * Migration: Add is_super_admin column to user table
 * Super-admins have platform-wide access to manage plans and tenants
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("user", "is_super_admin");
    if (hasColumn) {
        return;
    }

    // Add is_super_admin column
    await knex.schema.alterTable("user", (table) => {
        table.boolean("is_super_admin").defaultTo(false);
    });

    // Make the first user (id=1) a super-admin if they exist
    const firstUser = await knex("user").where("id", 1).first();
    if (firstUser) {
        await knex("user").where("id", 1).update({ is_super_admin: true });
    }
};

/**
 * Rollback migration
 * @param {object} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("user", "is_super_admin");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("user", (table) => {
        table.dropColumn("is_super_admin");
    });
};
