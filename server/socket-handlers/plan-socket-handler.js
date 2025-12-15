const { checkLogin } = require("../util-server");
const { checkSuperAdmin } = require("../utils/auth-helpers");
const { R } = require("redbean-node");
const { log } = require("../../src/util");

/**
 * Handlers for plan management (super-admin only)
 * @param {Socket} socket Socket.io instance
 * @param {object} server UptimeKumaServer instance
 * @returns {void}
 */
module.exports.planSocketHandler = (socket, server) => {

    /**
     * Get all plans (super-admin only)
     */
    socket.on("getPlans", async (callback) => {
        try {
            checkLogin(socket);
            checkSuperAdmin(socket);

            const plans = await R.getAll(`
                SELECT
                    id,
                    name,
                    slug,
                    monitor_limit,
                    retention_days,
                    status_pages_limit,
                    users_limit,
                    check_interval_min,
                    price_monthly,
                    price_yearly,
                    stripe_price_id_monthly,
                    stripe_price_id_yearly,
                    features,
                    is_active,
                    created_at,
                    updated_at
                FROM plan
                ORDER BY price_monthly ASC, name ASC
            `);

            // Parse features JSON for each plan
            const parsedPlans = plans.map(plan => ({
                ...plan,
                features: parseFeatures(plan.features),
                is_active: plan.is_active === 1 || plan.is_active === true,
            }));

            callback({
                ok: true,
                plans: parsedPlans,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Get a single plan by ID (super-admin only)
     */
    socket.on("getPlan", async (planId, callback) => {
        try {
            checkLogin(socket);
            checkSuperAdmin(socket);

            const plan = await R.findOne("plan", " id = ? ", [ planId ]);

            if (!plan) {
                throw new Error("Plan not found");
            }

            callback({
                ok: true,
                plan: {
                    id: plan.id,
                    name: plan.name,
                    slug: plan.slug,
                    monitor_limit: plan.monitor_limit,
                    retention_days: plan.retention_days,
                    status_pages_limit: plan.status_pages_limit,
                    users_limit: plan.users_limit,
                    check_interval_min: plan.check_interval_min,
                    price_monthly: plan.price_monthly,
                    price_yearly: plan.price_yearly,
                    stripe_price_id_monthly: plan.stripe_price_id_monthly,
                    stripe_price_id_yearly: plan.stripe_price_id_yearly,
                    features: parseFeatures(plan.features),
                    is_active: plan.is_active === 1 || plan.is_active === true,
                },
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Save (create or update) a plan (super-admin only)
     */
    socket.on("savePlan", async (planData, callback) => {
        try {
            checkLogin(socket);
            checkSuperAdmin(socket);

            const {
                id,
                name,
                slug,
                monitor_limit,
                retention_days,
                status_pages_limit,
                users_limit,
                check_interval_min,
                price_monthly,
                price_yearly,
                stripe_price_id_monthly,
                stripe_price_id_yearly,
                features,
                is_active,
            } = planData;

            // Validate required fields
            if (!name || !name.trim()) {
                throw new Error("Plan name is required");
            }

            if (!slug || !slug.trim()) {
                throw new Error("Plan slug is required");
            }

            // Validate slug format
            if (!/^[a-z0-9-]+$/.test(slug)) {
                throw new Error("Slug must contain only lowercase letters, numbers, and dashes");
            }

            let plan;
            const isNew = !id;

            if (isNew) {
                // Check for duplicate slug
                const existingPlan = await R.findOne("plan", " slug = ? ", [ slug ]);
                if (existingPlan) {
                    throw new Error("A plan with this slug already exists");
                }

                plan = R.dispense("plan");
            } else {
                plan = await R.findOne("plan", " id = ? ", [ id ]);
                if (!plan) {
                    throw new Error("Plan not found");
                }

                // Check for duplicate slug (excluding current plan)
                const existingPlan = await R.findOne("plan", " slug = ? AND id != ? ", [ slug, id ]);
                if (existingPlan) {
                    throw new Error("A plan with this slug already exists");
                }
            }

            // Update plan fields
            plan.name = name.trim();
            plan.slug = slug.trim().toLowerCase();
            plan.monitor_limit = parseInt(monitor_limit) || 0;
            plan.retention_days = parseInt(retention_days) || 30;
            plan.status_pages_limit = parseInt(status_pages_limit) || 1;
            plan.users_limit = parseInt(users_limit) || 1;
            plan.check_interval_min = parseInt(check_interval_min) || 60;
            plan.price_monthly = parseFloat(price_monthly) || 0;
            plan.price_yearly = parseFloat(price_yearly) || 0;
            plan.stripe_price_id_monthly = stripe_price_id_monthly?.trim() || null;
            plan.stripe_price_id_yearly = stripe_price_id_yearly?.trim() || null;
            plan.features = JSON.stringify(features || {});
            plan.is_active = is_active ? 1 : 0;

            if (isNew) {
                plan.created_at = new Date().toISOString();
            }
            plan.updated_at = new Date().toISOString();

            await R.store(plan);

            // For PostgreSQL, get the ID if it's a new record
            if (isNew && !plan.id) {
                const rows = await R.getAll(
                    "SELECT id FROM plan WHERE slug = ? ORDER BY id DESC LIMIT 1",
                    [ plan.slug ]
                );
                if (rows.length > 0) {
                    plan.id = rows[0].id;
                }
            }

            log.info("plan", `Plan ${plan.id} ${isNew ? "created" : "updated"} by super-admin ${socket.userID}`);

            callback({
                ok: true,
                msg: isNew ? "Plan created successfully" : "Plan updated successfully",
                plan: {
                    id: plan.id,
                    name: plan.name,
                    slug: plan.slug,
                },
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Delete a plan (super-admin only)
     * Only deactivates if tenants are using it
     */
    socket.on("deletePlan", async (planId, callback) => {
        try {
            checkLogin(socket);
            checkSuperAdmin(socket);

            const plan = await R.findOne("plan", " id = ? ", [ planId ]);
            if (!plan) {
                throw new Error("Plan not found");
            }

            // Check if any tenants are using this plan
            const tenantsUsingPlan = await R.count("tenant", " plan_id = ? ", [ planId ]);

            if (tenantsUsingPlan > 0) {
                // Deactivate instead of delete
                plan.is_active = 0;
                plan.updated_at = new Date().toISOString();
                await R.store(plan);

                log.info("plan", `Plan ${planId} deactivated (${tenantsUsingPlan} tenants using it) by super-admin ${socket.userID}`);

                callback({
                    ok: true,
                    msg: `Plan deactivated. ${tenantsUsingPlan} tenant(s) are still using this plan.`,
                    deactivated: true,
                });
            } else {
                // Safe to delete
                await R.trash(plan);

                log.info("plan", `Plan ${planId} deleted by super-admin ${socket.userID}`);

                callback({
                    ok: true,
                    msg: "Plan deleted successfully",
                    deleted: true,
                });
            }

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Get super-admin status for current user
     */
    socket.on("getSuperAdminStatus", async (callback) => {
        try {
            checkLogin(socket);

            callback({
                ok: true,
                isSuperAdmin: socket.isSuperAdmin === true,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
                isSuperAdmin: false,
            });
        }
    });
};

/**
 * Parse features JSON safely
 * @param {string|object} features Features JSON string or object
 * @returns {object} Parsed features object
 */
function parseFeatures(features) {
    if (!features) {
        return {};
    }
    if (typeof features === "object") {
        return features;
    }
    try {
        return JSON.parse(features);
    } catch (e) {
        return {};
    }
}
