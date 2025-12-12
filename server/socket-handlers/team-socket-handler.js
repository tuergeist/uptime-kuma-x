const { checkLogin } = require("../util-server");
const { checkOwner } = require("../utils/auth-helpers");
const { R } = require("redbean-node");
const { log } = require("../../src/util");
const { nanoid } = require("nanoid");
const { sendInvitationEmail, isEmailConfigured, getAppUrl } = require("../services/email-service");

/**
 * Handlers for team management (members and invitations)
 * @param {Socket} socket Socket.io instance
 * @param {object} server UptimeKumaServer instance
 * @param {object} io Socket.io server instance
 * @returns {void}
 */
module.exports.teamSocketHandler = (socket, server, io) => {

    /**
     * Get list of team members for the current tenant
     */
    socket.on("getTeamMembers", async (callback) => {
        try {
            checkLogin(socket);

            const tenantId = socket.tenantId || 1;
            log.debug("team", `getTeamMembers called for tenant ${tenantId}`);

            const members = await R.getAll(`
                SELECT id, username, email, role, created_date
                FROM "user"
                WHERE tenant_id = ?
                ORDER BY
                    CASE role
                        WHEN 'owner' THEN 1
                        WHEN 'admin' THEN 2
                        ELSE 3
                    END,
                    username
            `, [tenantId]);

            callback({
                ok: true,
                members: members,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Get list of pending invitations for the current tenant
     * Owner only
     */
    socket.on("getPendingInvitations", async (callback) => {
        try {
            checkLogin(socket);
            checkOwner(socket);

            const tenantId = socket.tenantId || 1;

            const invitations = await R.getAll(`
                SELECT i.id, i.email, i.role, i.expires_at, i.created_at, u.username as invited_by_name
                FROM invitation i
                LEFT JOIN "user" u ON i.invited_by = u.id
                WHERE i.tenant_id = ? AND i.used_at IS NULL AND i.expires_at > NOW()
                ORDER BY i.created_at DESC
            `, [tenantId]);

            callback({
                ok: true,
                invitations: invitations,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Create a new invitation
     * Owner only
     */
    socket.on("createInvitation", async (data, callback) => {
        try {
            checkLogin(socket);
            checkOwner(socket);

            const { email, role = "member" } = data;
            const tenantId = socket.tenantId || 1;

            // Validate email
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error("Invalid email address");
            }

            // Validate role
            const validRoles = ["member", "admin"];
            if (!validRoles.includes(role)) {
                throw new Error("Invalid role");
            }

            // Check if user already exists with this email
            const existingUser = await R.findOne("user", " email = ? ", [email.toLowerCase()]);
            if (existingUser) {
                if (existingUser.tenant_id === tenantId) {
                    throw new Error("This user is already a member of your team");
                } else {
                    throw new Error("This email is already registered with another organization");
                }
            }

            // Check for existing pending invitation
            const existingInvite = await R.findOne("invitation",
                " tenant_id = ? AND email = ? AND used_at IS NULL AND expires_at > NOW() ",
                [tenantId, email.toLowerCase()]
            );
            if (existingInvite) {
                throw new Error("An invitation has already been sent to this email");
            }

            // Generate secure token
            const token = nanoid(64);

            // Set expiration to 7 days from now
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            // Create invitation
            let invitation = R.dispense("invitation");
            invitation.token = token;
            invitation.email = email.toLowerCase();
            invitation.tenant_id = tenantId;
            invitation.role = role;
            invitation.invited_by = socket.userID;
            invitation.expires_at = expiresAt.toISOString();
            await R.store(invitation);

            // For PostgreSQL, fetch the invitation ID if not set
            if (!invitation.id) {
                const inviteRow = await R.findOne("invitation", " token = ? ", [token]);
                invitation.id = inviteRow.id;
            }

            log.info("team", `Invitation created for ${email} by user ${socket.userID}`);

            // Get tenant name and inviter info for email
            const tenant = await R.findOne("tenant", " id = ? ", [tenantId]);
            const inviter = await R.findOne("user", " id = ? ", [socket.userID]);

            // Send invitation email (non-blocking)
            let emailSent = false;
            if (isEmailConfigured()) {
                emailSent = await sendInvitationEmail(
                    email.toLowerCase(),
                    token,
                    tenant?.name || "Unknown",
                    inviter?.username || "A team member",
                    role
                );
            }

            const appUrl = getAppUrl();

            callback({
                ok: true,
                msg: emailSent ? "Invitation sent successfully" : "Invitation created - please share the link manually",
                invitation: {
                    id: invitation.id,
                    email: email.toLowerCase(),
                    role: role,
                    token: token,
                    expiresAt: expiresAt.toISOString(),
                    inviteUrl: `${appUrl}/invite/${token}`,
                },
                tenantName: tenant?.name || "Unknown",
                emailSent: emailSent,
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Cancel/delete a pending invitation
     * Owner only
     */
    socket.on("cancelInvitation", async (invitationId, callback) => {
        try {
            checkLogin(socket);
            checkOwner(socket);

            const tenantId = socket.tenantId || 1;

            // Verify invitation belongs to this tenant
            const invitation = await R.findOne("invitation", " id = ? AND tenant_id = ? ", [invitationId, tenantId]);
            if (!invitation) {
                throw new Error("Invitation not found");
            }

            // Delete the invitation
            await R.exec("DELETE FROM invitation WHERE id = ? ", [invitationId]);

            log.info("team", `Invitation ${invitationId} cancelled by user ${socket.userID}`);

            callback({
                ok: true,
                msg: "Invitation cancelled",
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Remove a team member
     * Owner only
     */
    socket.on("removeTeamMember", async (userId, callback) => {
        try {
            checkLogin(socket);
            checkOwner(socket);

            const tenantId = socket.tenantId || 1;

            // Cannot remove yourself
            if (userId === socket.userID) {
                throw new Error("You cannot remove yourself from the team");
            }

            // Verify user belongs to this tenant
            const user = await R.findOne("user", " id = ? AND tenant_id = ? ", [userId, tenantId]);
            if (!user) {
                throw new Error("User not found");
            }

            // Cannot remove another owner
            if (user.role === "owner") {
                throw new Error("Cannot remove another owner");
            }

            // Delete the user
            await R.exec("DELETE FROM \"user\" WHERE id = ? ", [userId]);

            log.info("team", `User ${userId} removed from tenant ${tenantId} by ${socket.userID}`);

            callback({
                ok: true,
                msg: "Team member removed",
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Update a team member's role
     * Owner only
     */
    socket.on("updateMemberRole", async (data, callback) => {
        try {
            checkLogin(socket);
            checkOwner(socket);

            const { userId, role } = data;
            const tenantId = socket.tenantId || 1;

            // Validate role
            const validRoles = ["member", "admin"];
            if (!validRoles.includes(role)) {
                throw new Error("Invalid role");
            }

            // Cannot change your own role
            if (userId === socket.userID) {
                throw new Error("You cannot change your own role");
            }

            // Verify user belongs to this tenant
            const user = await R.findOne("user", " id = ? AND tenant_id = ? ", [userId, tenantId]);
            if (!user) {
                throw new Error("User not found");
            }

            // Cannot change another owner's role
            if (user.role === "owner") {
                throw new Error("Cannot change another owner's role");
            }

            // Update role
            await R.exec("UPDATE \"user\" SET role = ? WHERE id = ? ", [role, userId]);

            log.info("team", `User ${userId} role changed to ${role} by ${socket.userID}`);

            callback({
                ok: true,
                msg: "Role updated successfully",
            });

        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    /**
     * Get current user's role info
     */
    socket.on("getMyRole", async (callback) => {
        try {
            checkLogin(socket);

            log.debug("team", `getMyRole called for user ${socket.userID}, role: ${socket.userRole}`);

            callback({
                ok: true,
                role: socket.userRole || "member",
                isOwner: socket.userRole === "owner",
                isAdmin: socket.userRole === "owner" || socket.userRole === "admin",
            });

        } catch (e) {
            log.error("team", `getMyRole error: ${e.message}`);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
