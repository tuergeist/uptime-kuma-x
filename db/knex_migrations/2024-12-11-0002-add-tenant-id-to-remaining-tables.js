/**
 * Add tenant_id column to remaining tables that need multi-tenancy support
 */
exports.up = async function (knex) {
    const tables = [
        "docker_host",
        "remote_browser",
        "proxy",
        "api_key",
        "group",
        "maintenance",
        "incident",
    ];

    for (const tableName of tables) {
        // Check if column already exists
        const hasColumn = await knex.schema.hasColumn(tableName, "tenant_id");
        if (!hasColumn) {
            await knex.schema.alterTable(tableName, function (table) {
                table.integer("tenant_id").notNullable().defaultTo(1);
                table.index("tenant_id");
            });
            console.log(`Added tenant_id to ${tableName}`);
        }
    }
};

exports.down = async function (knex) {
    const tables = [
        "docker_host",
        "remote_browser",
        "proxy",
        "api_key",
        "group",
        "maintenance",
        "incident",
    ];

    for (const tableName of tables) {
        const hasColumn = await knex.schema.hasColumn(tableName, "tenant_id");
        if (hasColumn) {
            await knex.schema.alterTable(tableName, function (table) {
                table.dropColumn("tenant_id");
            });
        }
    }
};
