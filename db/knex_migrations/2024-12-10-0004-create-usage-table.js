/**
 * Migration: Create usage table for per-tenant usage tracking
 * Tracks monitor counts, checks, notifications for billing and limits
 */
exports.up = async (knex) => {
    // Check if table already exists (for safety)
    const exists = await knex.schema.hasTable("usage");
    if (exists) {
        return;
    }

    await knex.schema.createTable("usage", (table) => {
        table.increments("id").primary();
        table.integer("tenant_id").unsigned().notNullable()
            .references("id").inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.date("period_start").notNullable();
        table.date("period_end").notNullable();
        table.integer("monitors_count").defaultTo(0);
        table.integer("status_pages_count").defaultTo(0);
        table.integer("users_count").defaultTo(0);
        table.bigInteger("checks_count").defaultTo(0);
        table.integer("notifications_sent").defaultTo(0);
        table.integer("api_calls").defaultTo(0);
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.unique(["tenant_id", "period_start"]);
        table.index(["tenant_id", "period_start"]);
    });
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists("usage");
};
