/**
 * Migration: Create tenant table for multi-tenancy
 * Core tenant entity that all other entities will reference
 */
exports.up = async (knex) => {
    // Check if table already exists (for safety)
    const exists = await knex.schema.hasTable("tenant");
    if (exists) {
        return;
    }

    await knex.schema.createTable("tenant", (table) => {
        table.increments("id").primary();
        table.string("slug", 63).unique().notNullable(); // Subdomain-safe slug
        table.string("name", 255).notNullable();
        table.string("status", 20).defaultTo("active"); // active, suspended, deleted
        table.integer("plan_id").unsigned()
            .references("id").inTable("plan")
            .onDelete("SET NULL")
            .onUpdate("CASCADE");
        table.string("stripe_customer_id", 255).nullable();
        table.string("stripe_subscription_id", 255).nullable();
        table.timestamp("subscription_ends_at").nullable();
        table.text("settings"); // JSON string for tenant-specific settings
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());
        table.timestamp("deleted_at").nullable();

        table.index("slug");
        table.index("status");
        table.index("stripe_customer_id");
    });

    // Get the free plan ID
    const freePlan = await knex("plan").where("slug", "free").first();
    const freePlanId = freePlan ? freePlan.id : 1;

    // Insert default tenant for existing data migration
    await knex("tenant").insert({
        slug: "default",
        name: "Default Tenant",
        status: "active",
        plan_id: freePlanId,
        settings: JSON.stringify({}),
    });
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists("tenant");
};
