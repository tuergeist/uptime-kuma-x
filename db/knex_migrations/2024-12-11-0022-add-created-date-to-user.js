exports.up = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.timestamp("created_date").defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.dropColumn("created_date");
    });
};
