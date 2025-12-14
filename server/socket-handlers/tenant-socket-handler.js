const { checkLogin } = require("../util-server");
const { checkOwner } = require("../utils/auth-helpers");
const { R } = require("redbean-node");
const { log } = require("../../src/util");
const { generateSlug, isValidSlug } = require("../utils/tenant-slug");

/**
 * Handlers for tenant/company settings
 * @param {Socket} socket Socket.io instance
 * @param {object} server UptimeKumaServer instance
 * @returns {void}
 */
module.exports.tenantSocketHandler = (socket, server) => {

    /**
     * Get current tenant info
     */
    socket.on("getTenantInfo", async (callback) => {
        try {
            checkLogin(socket);

            const tenantId = socket.tenantId || 1;
            const tenant = await R.findOne("tenant", " id = ? ", [tenantId]);

            if (!tenant) {
                throw new Error("Tenant not found");
            }

            // Parse settings JSON
            let settings = {};
            try {
                settings = JSON.parse(tenant.settings || "{}");
            } catch (e) {
                settings = {};
            }

            callback({
                ok: true,
                tenant: {
                    id: tenant.id,
                    name: tenant.name,
                    slug: tenant.slug,
                    companyName: settings.companyName || tenant.name,
                    companyAddress: settings.companyAddress || "",
                    companyEmail: settings.companyEmail || "",
                    companyPhone: settings.companyPhone || "",
                    companyWebsite: settings.companyWebsite || "",
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
     * Update tenant info
     * Owner only
     */
    socket.on("updateTenantInfo", async (data, callback) => {
        try {
            checkLogin(socket);
            checkOwner(socket);

            const tenantId = socket.tenantId || 1;
            const tenant = await R.findOne("tenant", " id = ? ", [tenantId]);

            if (!tenant) {
                throw new Error("Tenant not found");
            }

            const {
                name,
                slug,
                companyName,
                companyAddress,
                companyEmail,
                companyPhone,
                companyWebsite,
            } = data;

            // Validate required fields
            if (!name || !name.trim()) {
                throw new Error("Organization name is required");
            }

            // Validate slug if provided
            if (slug && slug !== tenant.slug) {
                if (!isValidSlug(slug)) {
                    throw new Error("Invalid slug format. Use lowercase letters, numbers, and dashes only.");
                }

                // Check if slug is already taken by another tenant
                const existingTenant = await R.findOne("tenant", " slug = ? AND id != ? ", [slug, tenantId]);
                if (existingTenant) {
                    throw new Error("This slug is already taken by another organization");
                }
            }

            // Update tenant fields
            tenant.name = name.trim();
            if (slug && slug !== tenant.slug) {
                tenant.slug = slug;
            }

            // Parse existing settings and update
            let settings = {};
            try {
                settings = JSON.parse(tenant.settings || "{}");
            } catch (e) {
                settings = {};
            }

            settings.companyName = companyName?.trim() || "";
            settings.companyAddress = companyAddress?.trim() || "";
            settings.companyEmail = companyEmail?.trim() || "";
            settings.companyPhone = companyPhone?.trim() || "";
            settings.companyWebsite = companyWebsite?.trim() || "";

            tenant.settings = JSON.stringify(settings);

            await R.store(tenant);

            log.info("tenant", `Tenant ${tenantId} updated by user ${socket.userID}`);

            callback({
                ok: true,
                msg: "Organization settings saved",
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Check if a slug is available
     */
    socket.on("checkSlugAvailable", async (slug, callback) => {
        try {
            checkLogin(socket);

            if (!slug || !isValidSlug(slug)) {
                callback({
                    ok: true,
                    available: false,
                    reason: "Invalid slug format",
                });
                return;
            }

            const tenantId = socket.tenantId || 1;
            const existingTenant = await R.findOne("tenant", " slug = ? AND id != ? ", [slug, tenantId]);

            callback({
                ok: true,
                available: !existingTenant,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Generate a suggested slug from a name
     */
    socket.on("generateSlug", async (name, callback) => {
        try {
            checkLogin(socket);

            const slug = generateSlug(name);

            callback({
                ok: true,
                slug: slug,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
