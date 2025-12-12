/**
 * Fix stat_daily ping column type from integer to real for float values
 */
exports.up = async function (knex) {
    // Change ping from integer to real (float) for PostgreSQL compatibility
    await knex.schema.alterTable("stat_daily", function (table) {
        table.float("ping").defaultTo(0).alter();
    });

    // Also fix stat_hourly and stat_minutely if they have the same issue
    const hasHourly = await knex.schema.hasTable("stat_hourly");
    if (hasHourly) {
        await knex.schema.alterTable("stat_hourly", function (table) {
            table.float("ping").defaultTo(0).alter();
        });
    }

    const hasMinutely = await knex.schema.hasTable("stat_minutely");
    if (hasMinutely) {
        await knex.schema.alterTable("stat_minutely", function (table) {
            table.float("ping").defaultTo(0).alter();
        });
    }

    console.log("Changed ping column to float type");
};

exports.down = async function (knex) {
    // Revert to integer (may lose precision)
    await knex.schema.alterTable("stat_daily", function (table) {
        table.integer("ping").defaultTo(0).alter();
    });

    const hasHourly = await knex.schema.hasTable("stat_hourly");
    if (hasHourly) {
        await knex.schema.alterTable("stat_hourly", function (table) {
            table.integer("ping").defaultTo(0).alter();
        });
    }

    const hasMinutely = await knex.schema.hasTable("stat_minutely");
    if (hasMinutely) {
        await knex.schema.alterTable("stat_minutely", function (table) {
            table.integer("ping").defaultTo(0).alter();
        });
    }
};
