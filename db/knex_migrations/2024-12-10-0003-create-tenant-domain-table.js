/**
 * Migration: Create tenant_domain table for custom domain mappings
 * Allows tenants to use custom domains for their status pages
 */
exports.up = async (knex) => {
    // Check if table already exists (for safety)
    const exists = await knex.schema.hasTable("tenant_domain");
    if (exists) {
        return;
    }

    await knex.schema.createTable("tenant_domain", (table) => {
        table.increments("id").primary();
        table.integer("tenant_id").unsigned().notNullable()
            .references("id").inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.string("domain", 255).unique().notNullable();
        table.boolean("is_primary").defaultTo(false);
        table.boolean("verified").defaultTo(false);
        table.string("verification_token", 64).nullable();
        table.string("verification_method", 20).defaultTo("dns"); // dns, file
        table.string("ssl_status", 20).defaultTo("pending"); // pending, active, failed
        table.timestamp("verified_at").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.index("domain");
        table.index("tenant_id");
    });
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists("tenant_domain");
};
