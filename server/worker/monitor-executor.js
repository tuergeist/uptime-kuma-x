/**
 * Monitor Executor - Stateless check execution for workers
 *
 * Extracts the core check logic from Monitor.beat() into a stateless function
 * that can be called by distributed workers.
 *
 * Key differences from Monitor.beat():
 * - No closure state (previousBeat, retries passed as params)
 * - Returns result object instead of storing directly
 * - No setTimeout scheduling (handled by worker)
 * - No Socket.IO emit (handled by pub/sub)
 */
const { R } = require("redbean-node");
const dayjs = require("dayjs");
const { log } = require("../../src/util");
const { UP, DOWN, PENDING, MAINTENANCE } = require("../../src/util");
const { flipStatus } = require("../../src/util");

// These will be imported from the main monitor.js to reuse existing logic
let Monitor = null;
let UptimeKumaServer = null;

/**
 * Initialize the executor with required dependencies
 * Must be called before executeCheck()
 * @param {object} monitorModel - The Monitor model class
 * @param {object} serverInstance - The UptimeKumaServer class
 */
function initExecutor(monitorModel, serverInstance) {
    Monitor = monitorModel;
    UptimeKumaServer = serverInstance;
}

/**
 * Execute a single monitor check
 *
 * @param {object} monitor - Monitor bean from database
 * @param {object|null} previousBeat - Previous heartbeat (null for first beat)
 * @param {number} retries - Current retry count
 * @returns {Promise<object>} Check result
 */
async function executeCheck(monitor, previousBeat = null, retries = 0) {
    const startTime = dayjs();
    const isFirstBeat = !previousBeat;

    // Create heartbeat bean
    let bean = R.dispense("heartbeat");
    bean.monitor_id = monitor.id;
    bean.tenant_id = monitor.tenant_id || 1;
    bean.time = R.isoDateTimeMillis(dayjs.utc());
    bean.status = DOWN;
    bean.downCount = previousBeat?.downCount || 0;

    // Handle upside down mode
    if (monitor.upside_down) {
        bean.status = flipStatus(bean.status);
    }

    // Runtime patch timeout
    let timeout = monitor.timeout;
    if (!timeout || timeout <= 0) {
        timeout = monitor.interval * 1000 * 0.8;
    }

    // TLS info for https monitors
    let tlsInfo = undefined;

    try {
        // Check maintenance status
        if (await Monitor.isUnderMaintenance(monitor.id)) {
            bean.msg = "Monitor under maintenance";
            bean.status = MAINTENANCE;
        } else {
            // Delegate to monitor type handler
            const result = await executeMonitorType(monitor, bean, timeout);
            tlsInfo = result.tlsInfo;
        }

        // Handle upside down flip
        if (monitor.upside_down) {
            bean.status = flipStatus(bean.status);

            if (bean.status === DOWN) {
                throw new Error("Flip UP to DOWN");
            }
        }

        retries = 0;

    } catch (error) {
        if (error?.name === "CanceledError") {
            bean.msg = `timeout by AbortSignal (${timeout}s)`;
        } else {
            bean.msg = error.message;
        }

        // Handle upside down retry logic
        if (monitor.upside_down && bean.status === UP) {
            retries = 0;
        } else if ((monitor.maxretries > 0) && (retries < monitor.maxretries)) {
            retries++;
            bean.status = PENDING;
        } else {
            retries++;
        }
    }

    bean.retries = retries;

    // Determine if this beat is important (status changed)
    const isImportant = Monitor.isImportantBeat(isFirstBeat, previousBeat?.status, bean.status);
    bean.important = isImportant;

    // Handle down count for resend interval
    if (!isImportant && bean.status === DOWN && monitor.resendInterval > 0) {
        bean.downCount++;
    } else if (isImportant) {
        bean.downCount = 0;
    }

    // Calculate effective interval for next check
    let nextInterval = monitor.interval;
    if (bean.status === PENDING && monitor.retryInterval > 0) {
        nextInterval = monitor.retryInterval;
    }

    // Calculate ping if not set
    if (!bean.ping) {
        bean.ping = dayjs().valueOf() - startTime.valueOf();
    }

    return {
        heartbeat: bean,
        tlsInfo: tlsInfo,
        isFirstBeat: isFirstBeat,
        isImportant: isImportant,
        shouldNotify: isImportant && Monitor.isImportantForNotification(isFirstBeat, previousBeat?.status, bean.status),
        shouldResendNotification: !isImportant && bean.status === DOWN &&
            monitor.resendInterval > 0 && bean.downCount >= monitor.resendInterval,
        nextInterval: nextInterval,
        retries: retries,
    };
}

/**
 * Execute the appropriate monitor type check
 * @private
 */
async function executeMonitorType(monitor, bean, timeout) {
    const type = monitor.type;
    let tlsInfo = undefined;

    // Check if it's a registered external monitor type
    if (type in UptimeKumaServer.monitorTypeList) {
        const startTime = dayjs().valueOf();
        const monitorType = UptimeKumaServer.monitorTypeList[type];

        // Create a Monitor-like object for the type handler
        const monitorWrapper = createMonitorWrapper(monitor);
        await monitorType.check(monitorWrapper, bean, UptimeKumaServer.getInstance());

        if (!monitorType.allowCustomStatus && bean.status !== UP) {
            throw new Error("The monitor implementation is incorrect, non-UP error must throw error inside check()");
        }

        if (!bean.ping) {
            bean.ping = dayjs().valueOf() - startTime;
        }
    } else {
        throw new Error(`Unknown monitor type: ${type}`);
    }

    return { tlsInfo };
}

/**
 * Create a Monitor-like wrapper object for monitor type handlers
 * This allows monitor types to work with both the original Monitor class
 * and our plain database objects
 * @private
 */
function createMonitorWrapper(monitorData) {
    // Create a proxy that mimics Monitor instance behavior
    return new Proxy(monitorData, {
        get(target, prop) {
            // Handle method calls that monitor types might use
            if (prop === "getIgnoreTls") {
                return () => target.ignoreTls || target.ignore_tls || false;
            }
            if (prop === "getAcceptedStatuscodes") {
                return () => {
                    try {
                        return JSON.parse(target.accepted_statuscodes || target.acceptedStatusCodes || '["200-299"]');
                    } catch {
                        return ["200-299"];
                    }
                };
            }
            if (prop === "isUpsideDown") {
                return () => target.upside_down || target.upsideDown || false;
            }
            if (prop === "encodeBase64") {
                return (user, pass) => Buffer.from(`${user}:${pass}`).toString("base64");
            }
            if (prop === "getTags") {
                return async () => {
                    // Fetch tags from database if needed
                    const tags = await R.getAll(`
                        SELECT t.*, mt.value
                        FROM tag t
                        JOIN monitor_tag mt ON t.id = mt.tag_id
                        WHERE mt.monitor_id = ?
                    `, [target.id]);
                    return tags;
                };
            }

            // Return property directly
            return target[prop];
        }
    });
}

/**
 * Get the previous heartbeat for a monitor
 * @param {number} monitorId - Monitor ID
 * @returns {Promise<object|null>}
 */
async function getPreviousBeat(monitorId) {
    const beat = await R.findOne("heartbeat", " monitor_id = ? ORDER BY time DESC", [monitorId]);
    return beat;
}

/**
 * Store heartbeat to database
 * @param {object} heartbeat - Heartbeat bean
 * @returns {Promise<void>}
 */
async function storeHeartbeat(heartbeat) {
    await R.store(heartbeat);
}

module.exports = {
    initExecutor,
    executeCheck,
    getPreviousBeat,
    storeHeartbeat,
    createMonitorWrapper,
};
