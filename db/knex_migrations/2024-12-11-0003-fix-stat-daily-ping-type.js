/**
 * Fix stat_daily ping column type from integer to real for float values
 */
exports.up = async function (knex) {
    const isPostgres = knex.client.config.client === "pg";

    if (isPostgres) {
        // Use raw SQL for PostgreSQL as Knex .alter() doesn't work reliably for type changes
        await knex.raw("ALTER TABLE stat_daily ALTER COLUMN ping TYPE real USING ping::real");

        const hasHourly = await knex.schema.hasTable("stat_hourly");
        if (hasHourly) {
            await knex.raw("ALTER TABLE stat_hourly ALTER COLUMN ping TYPE real USING ping::real");
        }

        const hasMinutely = await knex.schema.hasTable("stat_minutely");
        if (hasMinutely) {
            await knex.raw("ALTER TABLE stat_minutely ALTER COLUMN ping TYPE real USING ping::real");
        }
    } else {
        // For SQLite/MariaDB, use Knex schema builder
        await knex.schema.alterTable("stat_daily", function (table) {
            table.float("ping").defaultTo(0).alter();
        });

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
