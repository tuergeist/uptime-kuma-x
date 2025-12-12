/**
 * Socket.IO emit helpers for tenant-scoped messaging
 *
 * Room naming conventions:
 * - User room: `tenant:${tenantId}:user:${userId}`
 * - Tenant-wide room: `tenant:${tenantId}`
 * - Status page room: `tenant:${tenantId}:statuspage:${slug}`
 */

/**
 * Get the room name for a specific user within a tenant
 * @param {number} tenantId Tenant ID
 * @param {number} userId User ID
 * @returns {string} Room name
 */
function getUserRoom(tenantId, userId) {
    return `tenant:${tenantId}:user:${userId}`;
}

/**
 * Get the room name for all users in a tenant
 * @param {number} tenantId Tenant ID
 * @returns {string} Room name
 */
function getTenantRoom(tenantId) {
    return `tenant:${tenantId}`;
}

/**
 * Get the room name for a status page
 * @param {number} tenantId Tenant ID
 * @param {string} slug Status page slug
 * @returns {string} Room name
 */
function getStatusPageRoom(tenantId, slug) {
    return `tenant:${tenantId}:statuspage:${slug}`;
}

/**
 * Emit an event to a specific user within a tenant
 * @param {object} io Socket.IO server instance
 * @param {number} tenantId Tenant ID
 * @param {number} userId User ID
 * @param {string} event Event name
 * @param {*} data Event data
 */
function emitToUser(io, tenantId, userId, event, data) {
    io.to(getUserRoom(tenantId, userId)).emit(event, data);
}

/**
 * Emit an event to all users in a tenant
 * @param {object} io Socket.IO server instance
 * @param {number} tenantId Tenant ID
 * @param {string} event Event name
 * @param {*} data Event data
 */
function emitToTenant(io, tenantId, event, data) {
    io.to(getTenantRoom(tenantId)).emit(event, data);
}

/**
 * Emit an event to all subscribers of a status page
 * @param {object} io Socket.IO server instance
 * @param {number} tenantId Tenant ID
 * @param {string} slug Status page slug
 * @param {string} event Event name
 * @param {*} data Event data
 */
function emitToStatusPage(io, tenantId, slug, event, data) {
    io.to(getStatusPageRoom(tenantId, slug)).emit(event, data);
}

/**
 * Join a socket to tenant-specific rooms after authentication
 * @param {object} socket Socket.IO socket instance
 * @param {number} tenantId Tenant ID
 * @param {number} userId User ID
 */
function joinTenantRooms(socket, tenantId, userId) {
    // Join user-specific room
    socket.join(getUserRoom(tenantId, userId));

    // Join tenant-wide room
    socket.join(getTenantRoom(tenantId));

    // Legacy support: also join old room format during transition
    // Socket.IO uses the userID directly as room name (number or string)
    socket.join(userId);
    socket.join(String(userId));
}

/**
 * Join a socket to a status page room
 * @param {object} socket Socket.IO socket instance
 * @param {number} tenantId Tenant ID
 * @param {string} slug Status page slug
 */
function joinStatusPageRoom(socket, tenantId, slug) {
    socket.join(getStatusPageRoom(tenantId, slug));
}

module.exports = {
    getUserRoom,
    getTenantRoom,
    getStatusPageRoom,
    emitToUser,
    emitToTenant,
    emitToStatusPage,
    joinTenantRooms,
    joinStatusPageRoom,
};
