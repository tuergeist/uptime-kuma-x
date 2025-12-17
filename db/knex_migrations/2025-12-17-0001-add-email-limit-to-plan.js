/**
 * Migration: Add email notification limits to plan table
 * @param {import("knex")} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    // Add email_limit_daily column to plan table
    await knex.schema.alterTable("plan", (table) => {
        table.integer("email_limit_daily").nullable(); // NULL = unlimited
    });

    // Update default plans with email limits
    await knex("plan").where("slug", "free").update({ email_limit_daily: 50 });
    await knex("plan").where("slug", "pro").update({ email_limit_daily: 500 });
    await knex("plan").where("slug", "enterprise").update({ email_limit_daily: null }); // unlimited
};

/**
 * Rollback migration
 * @param {import("knex")} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    await knex.schema.alterTable("plan", (table) => {
        table.dropColumn("email_limit_daily");
    });
};
