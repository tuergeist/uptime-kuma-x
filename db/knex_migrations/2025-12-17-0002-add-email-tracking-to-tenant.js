/**
 * Migration: Add email tracking columns to tenant table
 * Tracks daily email notification count for rate limiting
 * @param {import("knex")} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    await knex.schema.alterTable("tenant", (table) => {
        table.date("email_count_date").nullable(); // Date of the current count
        table.integer("email_count_today").defaultTo(0); // Emails sent today
    });
};

/**
 * Rollback migration
 * @param {import("knex")} knex - Knex instance
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    await knex.schema.alterTable("tenant", (table) => {
        table.dropColumn("email_count_date");
        table.dropColumn("email_count_today");
    });
};
