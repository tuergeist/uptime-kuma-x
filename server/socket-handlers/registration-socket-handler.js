const { R } = require("redbean-node");
const { log } = require("../../src/util");
const passwordHash = require("../password-hash");
const { passwordStrength } = require("check-password-strength");
const User = require("../model/user");

/**
 * Generate a URL-safe slug from a string
 * @param {string} str Input string
 * @returns {string} URL-safe slug
 */
function generateSlug(str) {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "") // Remove non-word chars
        .replace(/[\s_-]+/g, "-") // Replace spaces/underscores with hyphens
        .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Validate email format
 * @param {string} email Email address
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Handlers for user registration and invitation acceptance
 * @param {Socket} socket Socket.io instance
 * @param {object} server UptimeKumaServer instance
 * @returns {void}
 */
module.exports.registrationSocketHandler = (socket, server) => {

    /**
     * Check if email is available
     */
    socket.on("checkEmailAvailable", async (email, callback) => {
        try {
            if (!email || !isValidEmail(email)) {
                callback({
                    ok: false,
                    msg: "Invalid email format",
                });
                return;
            }

            const existing = await R.findOne("user", " email = ? ", [email.toLowerCase()]);
            callback({
                ok: true,
                available: !existing,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Check if username is available
     */
    socket.on("checkUsernameAvailable", async (username, callback) => {
        try {
            if (!username || username.trim().length < 3) {
                callback({
                    ok: false,
                    msg: "Username must be at least 3 characters",
                });
                return;
            }

            const existing = await R.findOne("user", " username = ? ", [username.trim()]);
            callback({
                ok: true,
                available: !existing,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Register a new user with their own tenant
     */
    socket.on("register", async (data, callback) => {
        try {
            const { username, email, password, tenantName } = data;

            // Validate required fields
            if (!username || !email || !password || !tenantName) {
                throw new Error("All fields are required");
            }

            // Validate username
            if (username.trim().length < 3) {
                throw new Error("Username must be at least 3 characters");
            }

            // Validate email
            if (!isValidEmail(email)) {
                throw new Error("Invalid email format");
            }

            // Validate password strength
            if (passwordStrength(password).value === "Too weak") {
                throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
            }

            // Check for existing username
            const existingUsername = await R.findOne("user", " username = ? ", [username.trim()]);
            if (existingUsername) {
                throw new Error("Username already taken");
            }

            // Check for existing email
            const existingEmail = await R.findOne("user", " email = ? ", [email.toLowerCase()]);
            if (existingEmail) {
                throw new Error("Email already registered");
            }

            // Generate unique tenant slug
            let baseSlug = generateSlug(tenantName);
            if (!baseSlug) {
                baseSlug = "tenant";
            }
            let slug = baseSlug;
            let counter = 1;
            while (await R.findOne("tenant", " slug = ? ", [slug])) {
                slug = `${baseSlug}-${counter}`;
                counter++;
            }

            // Get the free plan ID
            const freePlan = await R.findOne("plan", " slug = ? ", ["free"]);
            const freePlanId = freePlan ? freePlan.id : 1;

            // Create tenant
            let tenant = R.dispense("tenant");
            tenant.slug = slug;
            tenant.name = tenantName.trim();
            tenant.status = "active";
            tenant.plan_id = freePlanId;
            tenant.settings = JSON.stringify({});
            await R.store(tenant);

            // For PostgreSQL, fetch the tenant ID if not set
            if (!tenant.id) {
                const tenantRow = await R.findOne("tenant", " slug = ? ", [slug]);
                tenant.id = tenantRow.id;
            }

            // Create user as owner of the tenant
            let user = R.dispense("user");
            user.username = username.trim();
            user.email = email.toLowerCase();
            user.password = await passwordHash.generate(password);
            user.tenant_id = tenant.id;
            user.role = "owner";
            user.active = true;
            await R.store(user);

            // For PostgreSQL, fetch the user ID if not set
            if (!user.id) {
                const userRow = await R.findOne("user", " username = ? AND tenant_id = ? ", [username.trim(), tenant.id]);
                user.id = userRow.id;
            }

            log.info("registration", `New user registered: ${username} (tenant: ${slug})`);

            // Generate JWT token for auto-login
            const token = User.createJWT(user, server.jwtSecret);

            callback({
                ok: true,
                msg: "Registration successful",
                token: token,
            });

        } catch (e) {
            log.error("registration", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Validate an invitation token
     */
    socket.on("validateInvitation", async (token, callback) => {
        try {
            if (!token) {
                throw new Error("Invalid invitation link");
            }

            const invitation = await R.findOne("invitation", " token = ? ", [token]);

            if (!invitation) {
                callback({
                    ok: false,
                    msg: "Invitation not found or invalid",
                });
                return;
            }

            // Check if already used
            if (invitation.used_at) {
                callback({
                    ok: false,
                    msg: "This invitation has already been used",
                });
                return;
            }

            // Check if expired
            const expiresAt = new Date(invitation.expires_at);
            if (expiresAt < new Date()) {
                callback({
                    ok: false,
                    msg: "This invitation has expired",
                });
                return;
            }

            // Get tenant info
            const tenant = await R.findOne("tenant", " id = ? ", [invitation.tenant_id]);
            if (!tenant || tenant.status !== "active") {
                callback({
                    ok: false,
                    msg: "The organization is no longer active",
                });
                return;
            }

            callback({
                ok: true,
                invitation: {
                    email: invitation.email,
                    role: invitation.role,
                    tenantName: tenant.name,
                    tenantId: tenant.id,
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
     * Accept an invitation and create user account
     */
    socket.on("acceptInvitation", async (data, callback) => {
        try {
            const { token, username, password } = data;

            // Validate required fields
            if (!token || !username || !password) {
                throw new Error("All fields are required");
            }

            // Validate username
            if (username.trim().length < 3) {
                throw new Error("Username must be at least 3 characters");
            }

            // Validate password strength
            if (passwordStrength(password).value === "Too weak") {
                throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
            }

            // Find and validate invitation
            const invitation = await R.findOne("invitation", " token = ? ", [token]);

            if (!invitation) {
                throw new Error("Invalid invitation");
            }

            if (invitation.used_at) {
                throw new Error("This invitation has already been used");
            }

            const expiresAt = new Date(invitation.expires_at);
            if (expiresAt < new Date()) {
                throw new Error("This invitation has expired");
            }

            // Check for existing username
            const existingUsername = await R.findOne("user", " username = ? ", [username.trim()]);
            if (existingUsername) {
                throw new Error("Username already taken");
            }

            // Check if email is already registered
            const existingEmail = await R.findOne("user", " email = ? ", [invitation.email]);
            if (existingEmail) {
                throw new Error("This email is already registered");
            }

            // Get tenant
            const tenant = await R.findOne("tenant", " id = ? ", [invitation.tenant_id]);
            if (!tenant || tenant.status !== "active") {
                throw new Error("The organization is no longer active");
            }

            // Create user with the invitation's tenant and role
            let user = R.dispense("user");
            user.username = username.trim();
            user.email = invitation.email;
            user.password = await passwordHash.generate(password);
            user.tenant_id = invitation.tenant_id;
            user.role = invitation.role;
            user.active = true;
            await R.store(user);

            // For PostgreSQL, fetch the user ID if not set
            if (!user.id) {
                const userRow = await R.findOne("user", " username = ? AND tenant_id = ? ", [username.trim(), invitation.tenant_id]);
                user.id = userRow.id;
            }

            // Mark invitation as used
            await R.exec("UPDATE invitation SET used_at = ? WHERE id = ? ", [
                new Date().toISOString(),
                invitation.id,
            ]);

            log.info("registration", `Invitation accepted: ${username} joined tenant ${tenant.slug} as ${invitation.role}`);

            // Generate JWT token for auto-login
            const jwtToken = User.createJWT(user, server.jwtSecret);

            callback({
                ok: true,
                msg: "Welcome to the team!",
                token: jwtToken,
            });

        } catch (e) {
            log.error("registration", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
