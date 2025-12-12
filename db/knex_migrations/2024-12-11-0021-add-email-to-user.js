/**
 * Migration: Add email field to user table
 * Required for invitations and account recovery
 */
exports.up = async (knex) => {
    // Check if column already exists (idempotency)
    const hasColumn = await knex.schema.hasColumn("user", "email");
    if (hasColumn) {
        return;
    }

    // Add email column
    await knex.schema.alterTable("user", (table) => {
        table.string("email", 255).nullable().unique();
    });

    // Add index for email lookups
    await knex.schema.alterTable("user", (table) => {
        table.index("email", "user_email_index");
    });
};

/**
 * Rollback migration
 */
exports.down = async (knex) => {
    const hasColumn = await knex.schema.hasColumn("user", "email");
    if (!hasColumn) {
        return;
    }

    await knex.schema.alterTable("user", (table) => {
        table.dropIndex([], "user_email_index");
        table.dropColumn("email");
    });
};
