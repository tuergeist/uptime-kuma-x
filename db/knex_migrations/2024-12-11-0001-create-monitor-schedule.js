/**
 * Migration: Create monitor_schedule table
 *
 * This table is used by the worker architecture to track when monitors
 * need to be checked and which worker has claimed them.
 */
exports.up = async function (knex) {
    // Check if table already exists
    const exists = await knex.schema.hasTable("monitor_schedule");
    if (exists) {
        return;
    }

    await knex.schema.createTable("monitor_schedule", function (table) {
        table.increments("id").primary();

        // Reference to the monitor
        table.integer("monitor_id").unsigned().notNullable();
        table.foreign("monitor_id")
            .references("id")
            .inTable("monitor")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");

        // Tenant ID for multi-tenancy (nullable for backward compat)
        table.integer("tenant_id").unsigned().nullable();

        // When the next check should happen
        table.timestamp("next_check_at").notNullable();

        // Which worker has claimed this monitor (null = unclaimed)
        table.string("claimed_by", 100).nullable();

        // When the worker claimed this monitor
        table.timestamp("claimed_at").nullable();

        // Last check information
        table.timestamp("last_check_at").nullable();
        table.integer("last_status").nullable();
        table.integer("last_ping").nullable();

        // Retry tracking
        table.integer("retry_count").defaultTo(0);
        table.integer("consecutive_failures").defaultTo(0);

        // Whether the monitor is active in the schedule
        table.boolean("active").defaultTo(true);

        // Timestamps
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        // Unique constraint: one schedule entry per monitor
        table.unique(["monitor_id"]);

        // Index for finding monitors due for checking
        // Workers query: WHERE next_check_at <= NOW() AND claimed_by IS NULL AND active = true
        table.index(["next_check_at", "claimed_by", "active"], "idx_schedule_due");

        // Index for finding stale claims
        // Cleanup query: WHERE claimed_by IS NOT NULL AND claimed_at < NOW() - interval
        table.index(["claimed_by", "claimed_at"], "idx_schedule_claims");

        // Index for tenant filtering
        table.index(["tenant_id"], "idx_schedule_tenant");

        // Index for active monitors per tenant
        table.index(["tenant_id", "active"], "idx_schedule_tenant_active");
    });

    // For PostgreSQL, create a partial index for better performance on unclaimed monitors
    const client = knex.client.config.client;
    if (client === "pg" || client === "postgresql") {
        await knex.raw(`
            CREATE INDEX IF NOT EXISTS idx_schedule_unclaimed
            ON monitor_schedule (next_check_at)
            WHERE claimed_by IS NULL AND active = true
        `);
    }
};

exports.down = async function (knex) {
    // Drop partial index first if PostgreSQL
    const client = knex.client.config.client;
    if (client === "pg" || client === "postgresql") {
        await knex.raw("DROP INDEX IF EXISTS idx_schedule_unclaimed");
    }

    await knex.schema.dropTableIfExists("monitor_schedule");
};
