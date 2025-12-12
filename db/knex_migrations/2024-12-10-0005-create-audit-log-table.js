/**
 * Migration: Create audit_log table for compliance logging
 * Tracks all significant actions for security and compliance
 */
exports.up = async (knex) => {
    // Check if table already exists (for safety)
    const exists = await knex.schema.hasTable("audit_log");
    if (exists) {
        return;
    }

    await knex.schema.createTable("audit_log", (table) => {
        table.bigIncrements("id").primary();
        table.integer("tenant_id").unsigned().notNullable();
        table.integer("user_id").unsigned().nullable();
        table.string("action", 100).notNullable(); // e.g., monitor.create, user.login, settings.update
        table.string("entity_type", 50).nullable(); // e.g., monitor, user, notification
        table.integer("entity_id").nullable();
        table.text("old_values"); // JSON string of previous values
        table.text("new_values"); // JSON string of new values
        table.string("ip_address", 45).nullable(); // IPv6 compatible
        table.text("user_agent").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());

        table.index("tenant_id");
        table.index("user_id");
        table.index("action");
        table.index("entity_type");
        table.index("created_at");
        table.index(["tenant_id", "created_at"]);
    });
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists("audit_log");
};
