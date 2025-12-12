/**
 * Migration: Create plan table for subscription plans
 * Part of multi-tenancy implementation
 */
exports.up = async (knex) => {
    // Check if table already exists (for safety)
    const exists = await knex.schema.hasTable("plan");
    if (exists) {
        return;
    }

    await knex.schema.createTable("plan", (table) => {
        table.increments("id").primary();
        table.string("name", 100).notNullable();
        table.string("slug", 50).unique().notNullable();
        table.integer("monitor_limit").nullable(); // NULL = unlimited
        table.integer("check_interval_min").defaultTo(60); // Minimum check interval in seconds
        table.integer("retention_days").defaultTo(30);
        table.integer("status_pages_limit").defaultTo(1);
        table.integer("users_limit").defaultTo(1);
        table.decimal("price_monthly", 10, 2).nullable();
        table.decimal("price_yearly", 10, 2).nullable();
        table.string("stripe_price_id_monthly", 255).nullable();
        table.string("stripe_price_id_yearly", 255).nullable();
        table.text("features"); // JSON string of additional features
        table.boolean("is_active").defaultTo(true);
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());
    });

    // Insert default plans
    await knex("plan").insert([
        {
            slug: "free",
            name: "Free",
            monitor_limit: 5,
            check_interval_min: 60,
            retention_days: 7,
            status_pages_limit: 1,
            users_limit: 1,
            features: JSON.stringify({ notifications: true, api_access: false }),
        },
        {
            slug: "pro",
            name: "Pro",
            monitor_limit: 50,
            check_interval_min: 20,
            retention_days: 30,
            status_pages_limit: 5,
            users_limit: 5,
            price_monthly: 9.99,
            price_yearly: 99.99,
            features: JSON.stringify({ notifications: true, api_access: true, custom_domains: true }),
        },
        {
            slug: "enterprise",
            name: "Enterprise",
            monitor_limit: null, // unlimited
            check_interval_min: 1,
            retention_days: 90,
            status_pages_limit: null, // unlimited
            users_limit: null, // unlimited
            price_monthly: 49.99,
            price_yearly: 499.99,
            features: JSON.stringify({ notifications: true, api_access: true, custom_domains: true, sla: true, priority_support: true }),
        },
    ]);
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists("plan");
};
