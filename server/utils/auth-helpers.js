/**
 * Authorization helpers for multi-tenancy role-based access control
 */

/**
 * Check if the user is logged in
 * @param {Socket} socket Socket instance
 * @throws {Error} If user is not logged in
 */
function checkLogin(socket) {
    if (!socket.userID) {
        throw new Error("You are not logged in.");
    }
}

/**
 * Check if the user is the owner of their tenant
 * @param {Socket} socket Socket instance
 * @throws {Error} If user is not an owner
 */
function checkOwner(socket) {
    checkLogin(socket);
    if (socket.userRole !== "owner") {
        throw new Error("permissionDeniedOwnerOnly");
    }
}

/**
 * Check if the user is an admin or owner of their tenant
 * @param {Socket} socket Socket instance
 * @throws {Error} If user is not admin or owner
 */
function checkAdmin(socket) {
    checkLogin(socket);
    if (socket.userRole !== "owner" && socket.userRole !== "admin") {
        throw new Error("permissionDeniedAdminOnly");
    }
}

/**
 * Check if the user is a member of a tenant
 * @param {Socket} socket Socket instance
 * @throws {Error} If user is not in a tenant
 */
function checkMember(socket) {
    checkLogin(socket);
    if (!socket.tenantId) {
        throw new Error("notAuthenticated");
    }
}

/**
 * Check if the user has one of the specified roles
 * @param {Socket} socket Socket instance
 * @param {string[]} roles Array of allowed roles
 * @returns {boolean} True if user has one of the roles
 */
function hasRole(socket, roles) {
    if (!socket.userID || !socket.userRole) {
        return false;
    }
    return roles.includes(socket.userRole);
}

/**
 * Check if the user is the owner
 * @param {Socket} socket Socket instance
 * @returns {boolean} True if user is owner
 */
function isOwner(socket) {
    return socket.userRole === "owner";
}

/**
 * Check if the user is admin or owner
 * @param {Socket} socket Socket instance
 * @returns {boolean} True if user is admin or owner
 */
function isAdmin(socket) {
    return socket.userRole === "owner" || socket.userRole === "admin";
}

module.exports = {
    checkLogin,
    checkOwner,
    checkAdmin,
    checkMember,
    hasRole,
    isOwner,
    isAdmin,
};
