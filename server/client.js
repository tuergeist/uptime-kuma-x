/*
 * For Client Socket
 */
const { TimeLogger } = require("../src/util");
const { R } = require("redbean-node");
const { UptimeKumaServer } = require("./uptime-kuma-server");
const server = UptimeKumaServer.getInstance();
const io = server.io;
const { setting } = require("./util-server");
const checkVersion = require("./check-version");
const Database = require("./database");

/**
 * Ensure result is an array (PostgreSQL compatibility)
 * @param {any} result Result from R.find or R.getAll
 * @returns {Array} Array result
 */
function ensureArray(result) {
    if (!result) {
        return [];
    }
    if (!Array.isArray(result)) {
        return [];
    }
    return result;
}

/**
 * Send list of notification providers to client
 * All team members can see all notifications belonging to their tenant.
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<Bean[]>} List of notifications
 */
async function sendNotificationList(socket) {
    const timeLogger = new TimeLogger();

    let result = [];
    // Filter by tenant_id only - all team members see all tenant notifications
    let list = ensureArray(await R.find("notification", " tenant_id = ? ", [
        socket.tenantId || 1,
    ]));

    for (let bean of list) {
        let notificationObject = bean.export();
        // Handle both SQLite (integer 0/1) and PostgreSQL (boolean true/false)
        notificationObject.isDefault = (notificationObject.isDefault === 1 || notificationObject.isDefault === true);
        notificationObject.active = (notificationObject.active === 1 || notificationObject.active === true);
        result.push(notificationObject);
    }

    io.to(socket.userID).emit("notificationList", result);

    timeLogger.print("Send Notification List");

    return list;
}

/**
 * Send Heartbeat History list to socket
 * @param {Socket} socket Socket.io instance
 * @param {number} monitorID ID of monitor to send heartbeat history
 * @param {boolean} toUser  True = send to all browsers with the same user id, False = send to the current browser only
 * @param {boolean} overwrite Overwrite client-side's heartbeat list
 * @returns {Promise<void>}
 */
async function sendHeartbeatList(socket, monitorID, toUser = false, overwrite = false) {
    let list = ensureArray(await R.getAll(`
        SELECT * FROM heartbeat
        WHERE monitor_id = ? AND tenant_id = ?
        ORDER BY time DESC
        LIMIT 100
    `, [
        monitorID,
        socket.tenantId || 1,
    ]));

    let result = list.reverse();

    if (toUser) {
        io.to(socket.userID).emit("heartbeatList", monitorID, result, overwrite);
    } else {
        socket.emit("heartbeatList", monitorID, result, overwrite);
    }
}

/**
 * Important Heart beat list (aka event list)
 * @param {Socket} socket Socket.io instance
 * @param {number} monitorID ID of monitor to send heartbeat history
 * @param {boolean} toUser  True = send to all browsers with the same user id, False = send to the current browser only
 * @param {boolean} overwrite Overwrite client-side's heartbeat list
 * @returns {Promise<void>}
 */
async function sendImportantHeartbeatList(socket, monitorID, toUser = false, overwrite = false) {
    const timeLogger = new TimeLogger();

    let list = ensureArray(await R.find("heartbeat", `
        monitor_id = ?
        AND tenant_id = ?
        AND important = true
        ORDER BY time DESC
        LIMIT 500
    `, [
        monitorID,
        socket.tenantId || 1,
    ]));

    timeLogger.print(`[Monitor: ${monitorID}] sendImportantHeartbeatList`);

    if (toUser) {
        io.to(socket.userID).emit("importantHeartbeatList", monitorID, list, overwrite);
    } else {
        socket.emit("importantHeartbeatList", monitorID, list, overwrite);
    }

}

/**
 * Emit proxy list to client
 * All team members can see all proxies belonging to their tenant.
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<Bean[]>} List of proxies
 */
async function sendProxyList(socket) {
    const timeLogger = new TimeLogger();

    // Filter by tenant_id only - all team members see all tenant proxies
    let list = ensureArray(await R.find("proxy", " tenant_id = ? ", [ socket.tenantId || 1 ]));
    io.to(socket.userID).emit("proxyList", list.map(bean => bean.export()));

    timeLogger.print("Send Proxy List");

    return list;
}

/**
 * Emit API key list to client
 * All team members can see all API keys belonging to their tenant.
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<void>}
 */
async function sendAPIKeyList(socket) {
    const timeLogger = new TimeLogger();

    let result = [];
    // Filter by tenant_id only - all team members see all tenant API keys
    const list = ensureArray(await R.find(
        "api_key",
        "tenant_id=?",
        [ socket.tenantId || 1 ],
    ));

    for (let bean of list) {
        result.push(bean.toPublicJSON());
    }

    io.to(socket.userID).emit("apiKeyList", result);
    timeLogger.print("Sent API Key List");

    return list;
}

/**
 * Emits the version information to the client.
 * @param {Socket} socket Socket.io socket instance
 * @param {boolean} hideVersion Should we hide the version information in the response?
 * @returns {Promise<void>}
 */
async function sendInfo(socket, hideVersion = false) {
    let version;
    let latestVersion;
    let isContainer;
    let dbType;

    if (!hideVersion) {
        version = checkVersion.version;
        latestVersion = checkVersion.latestVersion;
        isContainer = (process.env.UPTIME_KUMA_IS_CONTAINER === "1");
        dbType = Database.dbConfig.type;
    }

    // Get tenant info if user is logged in
    let tenantSlug = null;
    let tenantName = null;
    if (socket.tenantId) {
        const tenant = await R.findOne("tenant", " id = ? ", [socket.tenantId]);
        if (tenant) {
            tenantSlug = tenant.slug;
            tenantName = tenant.name;
        }
    }

    socket.emit("info", {
        version,
        latestVersion,
        isContainer,
        dbType,
        primaryBaseURL: await setting("primaryBaseURL"),
        serverTimezone: await server.getTimezone(),
        serverTimezoneOffset: server.getTimezoneOffset(),
        tenantSlug,
        tenantName,
    });
}

/**
 * Send list of docker hosts to client
 * All team members can see all docker hosts belonging to their tenant.
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<Bean[]>} List of docker hosts
 */
async function sendDockerHostList(socket) {
    const timeLogger = new TimeLogger();

    let result = [];
    // Filter by tenant_id only - all team members see all tenant docker hosts
    let list = ensureArray(await R.find("docker_host", " tenant_id = ? ", [
        socket.tenantId || 1,
    ]));

    for (let bean of list) {
        result.push(bean.toJSON());
    }

    io.to(socket.userID).emit("dockerHostList", result);

    timeLogger.print("Send Docker Host List");

    return list;
}

/**
 * Send list of remote browsers to client
 * All team members can see all remote browsers belonging to their tenant.
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<Bean[]>} List of remote browsers
 */
async function sendRemoteBrowserList(socket) {
    const timeLogger = new TimeLogger();

    let result = [];
    // Filter by tenant_id only - all team members see all tenant remote browsers
    let list = ensureArray(await R.find("remote_browser", " tenant_id = ? ", [
        socket.tenantId || 1,
    ]));

    for (let bean of list) {
        result.push(bean.toJSON());
    }

    io.to(socket.userID).emit("remoteBrowserList", result);

    timeLogger.print("Send Remote Browser List");

    return list;
}

/**
 * Send list of monitor types to client
 * @param {Socket} socket Socket.io socket instance
 * @returns {Promise<void>}
 */
async function sendMonitorTypeList(socket) {
    const result = Object.entries(UptimeKumaServer.monitorTypeList).map(([ key, type ]) => {
        return [ key, {
            supportsConditions: type.supportsConditions,
            conditionVariables: type.conditionVariables.map(v => {
                return {
                    id: v.id,
                    operators: v.operators.map(o => {
                        return {
                            id: o.id,
                            caption: o.caption,
                        };
                    }),
                };
            }),
        }];
    });

    io.to(socket.userID).emit("monitorTypeList", Object.fromEntries(result));
}

module.exports = {
    sendNotificationList,
    sendImportantHeartbeatList,
    sendHeartbeatList,
    sendProxyList,
    sendAPIKeyList,
    sendInfo,
    sendDockerHostList,
    sendRemoteBrowserList,
    sendMonitorTypeList,
};
