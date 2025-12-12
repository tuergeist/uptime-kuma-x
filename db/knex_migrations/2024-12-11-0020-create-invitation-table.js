/**
 * Migration: Create invitation table for team invitations
 * Stores pending invitations for users to join a tenant
 */
exports.up = async (knex) => {
    // Check if table already exists (for safety)
    const exists = await knex.schema.hasTable("invitation");
    if (exists) {
        return;
    }

    await knex.schema.createTable("invitation", (table) => {
        table.increments("id").primary();
        table.string("token", 64).unique().notNullable(); // Secure random token
        table.string("email", 255).notNullable(); // Invitee email address
        table.integer("tenant_id").unsigned().notNullable()
            .references("id").inTable("tenant")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        table.string("role", 20).defaultTo("member"); // Role to assign upon acceptance
        table.integer("invited_by").unsigned().nullable()
            .references("id").inTable("user")
            .onDelete("SET NULL")
            .onUpdate("CASCADE");
        table.timestamp("expires_at").notNullable(); // Expiration timestamp
        table.timestamp("used_at").nullable(); // When invitation was accepted
        table.timestamp("created_at").defaultTo(knex.fn.now());

        // Indexes for common queries
        table.index("token");
        table.index("tenant_id");
        table.index("expires_at");
        table.index(["tenant_id", "email"]); // Check for duplicate invites
    });
};

exports.down = async (knex) => {
    await knex.schema.dropTableIfExists("invitation");
};
