/**
 * SSRF Protection Module
 * Validates URLs and IP addresses to prevent Server-Side Request Forgery attacks
 * in multi-tenant SaaS environment.
 */

const { Address4, Address6 } = require("ip-address");
const dns = require("dns").promises;
const { URL } = require("url");

// Private/reserved IPv4 ranges to block
const BLOCKED_IPV4_RANGES = [
    "0.0.0.0/8",        // "This" network
    "10.0.0.0/8",       // Private-Use (RFC 1918)
    "127.0.0.0/8",      // Loopback
    "169.254.0.0/16",   // Link-Local (includes AWS metadata 169.254.169.254)
    "172.16.0.0/12",    // Private-Use (RFC 1918)
    "192.0.0.0/24",     // IETF Protocol Assignments
    "192.0.2.0/24",     // Documentation (TEST-NET-1)
    "192.168.0.0/16",   // Private-Use (RFC 1918)
    "198.18.0.0/15",    // Benchmarking
    "198.51.100.0/24",  // Documentation (TEST-NET-2)
    "203.0.113.0/24",   // Documentation (TEST-NET-3)
    "224.0.0.0/4",      // Multicast
    "240.0.0.0/4",      // Reserved for Future Use
    "255.255.255.255/32", // Broadcast
];

// Private/reserved IPv6 ranges to block
const BLOCKED_IPV6_RANGES = [
    "::1/128",          // Loopback
    "::/128",           // Unspecified
    "::ffff:0:0/96",    // IPv4-mapped (will check underlying IPv4)
    "64:ff9b::/96",     // IPv4/IPv6 translation
    "100::/64",         // Discard-Only
    "2001::/32",        // Teredo
    "2001:2::/48",      // Benchmarking
    "2001:db8::/32",    // Documentation
    "2001:10::/28",     // ORCHID
    "2002::/16",        // 6to4
    "fc00::/7",         // Unique-Local (private)
    "fe80::/10",        // Link-Local
    "ff00::/8",         // Multicast
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
];

/**
 * Check if an IPv4 address is in a blocked range
 * @param {string} ip IPv4 address
 * @returns {boolean} true if blocked
 */
function isBlockedIPv4(ip) {
    try {
        const addr = new Address4(ip);
        for (const range of BLOCKED_IPV4_RANGES) {
            const subnet = new Address4(range);
            if (addr.isInSubnet(subnet)) {
                return true;
            }
        }
        return false;
    } catch (e) {
        // Invalid IP address format - block it to be safe
        return true;
    }
}

/**
 * Check if an IPv6 address is in a blocked range
 * @param {string} ip IPv6 address
 * @returns {boolean} true if blocked
 */
function isBlockedIPv6(ip) {
    try {
        const addr = new Address6(ip);

        // Check if it's an IPv4-mapped address (::ffff:x.x.x.x)
        if (addr.is4()) {
            const ipv4 = addr.to4().address;
            return isBlockedIPv4(ipv4);
        }

        for (const range of BLOCKED_IPV6_RANGES) {
            const subnet = new Address6(range);
            if (addr.isInSubnet(subnet)) {
                return true;
            }
        }
        return false;
    } catch (e) {
        // Invalid IP address format - block it to be safe
        return true;
    }
}

/**
 * Check if any IP address is blocked
 * @param {string} ip IP address (v4 or v6)
 * @returns {boolean} true if blocked
 */
function isBlockedIP(ip) {
    if (!ip) {
        return true;
    }

    // Try IPv4 first (contains dots, no colons)
    if (ip.includes(".") && !ip.includes(":")) {
        return isBlockedIPv4(ip);
    }
    // Try IPv6
    return isBlockedIPv6(ip);
}

/**
 * Check if hostname is blocked
 * @param {string} hostname Hostname to check
 * @returns {boolean} true if blocked
 */
function isBlockedHostname(hostname) {
    if (!hostname) {
        return true;
    }
    const lower = hostname.toLowerCase().trim();
    return BLOCKED_HOSTNAMES.includes(lower);
}

/**
 * Resolve hostname and check if any resolved IPs are blocked
 * @param {string} hostname Hostname to resolve
 * @returns {Promise<{blocked: boolean, reason?: string, resolvedIPs?: string[]}>}
 */
async function checkHostname(hostname) {
    if (!hostname) {
        return {
            blocked: true,
            reason: "Hostname is empty"
        };
    }

    // Check if hostname itself is blocked
    if (isBlockedHostname(hostname)) {
        return {
            blocked: true,
            reason: `Hostname "${hostname}" is not allowed`
        };
    }

    // Check if hostname is actually an IP address
    if (isBlockedIP(hostname)) {
        return {
            blocked: true,
            reason: `IP address ${hostname} is in a blocked private range`
        };
    }

    // Check if it's a valid IP that's NOT blocked (skip DNS resolution)
    try {
        // Try parsing as IPv4
        new Address4(hostname);
        return { blocked: false, resolvedIPs: [hostname] };
    } catch (e) {
        // Not an IPv4
    }

    try {
        // Try parsing as IPv6
        new Address6(hostname);
        return { blocked: false, resolvedIPs: [hostname] };
    } catch (e) {
        // Not an IPv6
    }

    // It's a hostname - resolve DNS and check each IP
    try {
        const addresses = await dns.resolve4(hostname).catch(() => []);
        const addresses6 = await dns.resolve6(hostname).catch(() => []);
        const allAddresses = [...addresses, ...addresses6];

        if (allAddresses.length === 0) {
            // DNS resolution failed - allow but warn (might be temporary)
            return {
                blocked: false,
                reason: `DNS resolution returned no addresses for ${hostname}`
            };
        }

        for (const ip of allAddresses) {
            if (isBlockedIP(ip)) {
                return {
                    blocked: true,
                    reason: `Hostname "${hostname}" resolves to blocked IP ${ip}`,
                    resolvedIPs: allAddresses
                };
            }
        }

        return { blocked: false, resolvedIPs: allAddresses };
    } catch (e) {
        // DNS resolution failed - allow with warning (could be temporary network issue)
        return {
            blocked: false,
            reason: `DNS resolution error: ${e.message}`
        };
    }
}

/**
 * Validate a URL for SSRF vulnerabilities
 * @param {string} urlString URL to validate
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function validateURL(urlString) {
    if (!urlString) {
        return {
            valid: false,
            reason: "URL is empty"
        };
    }

    let url;
    try {
        url = new URL(urlString);
    } catch (e) {
        return {
            valid: false,
            reason: `Invalid URL format: ${e.message}`
        };
    }

    // Only allow http and https
    if (!["http:", "https:"].includes(url.protocol)) {
        return {
            valid: false,
            reason: `Protocol "${url.protocol}" is not allowed. Only http and https are permitted.`
        };
    }

    // Check hostname
    const result = await checkHostname(url.hostname);
    if (result.blocked) {
        return {
            valid: false,
            reason: result.reason
        };
    }

    return { valid: true };
}

/**
 * Validate hostname for non-HTTP monitors (TCP, DNS, etc.)
 * @param {string} hostname Hostname to validate
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function validateHostname(hostname) {
    const result = await checkHostname(hostname);
    if (result.blocked) {
        return {
            valid: false,
            reason: result.reason
        };
    }
    return { valid: true };
}

/**
 * Synchronously check if a URL appears to target a private IP
 * (For quick checks without DNS resolution)
 * @param {string} urlString URL to check
 * @returns {{valid: boolean, reason?: string}}
 */
function validateURLSync(urlString) {
    if (!urlString) {
        return { valid: false, reason: "URL is empty" };
    }

    let url;
    try {
        url = new URL(urlString);
    } catch (e) {
        return { valid: false, reason: `Invalid URL: ${e.message}` };
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        return {
            valid: false,
            reason: `Protocol "${url.protocol}" is not allowed`
        };
    }

    if (isBlockedHostname(url.hostname)) {
        return {
            valid: false,
            reason: `Hostname "${url.hostname}" is not allowed`
        };
    }

    if (isBlockedIP(url.hostname)) {
        return {
            valid: false,
            reason: `IP address ${url.hostname} is in a blocked range`
        };
    }

    return { valid: true };
}

module.exports = {
    isBlockedIP,
    isBlockedIPv4,
    isBlockedIPv6,
    isBlockedHostname,
    checkHostname,
    validateURL,
    validateHostname,
    validateURLSync,
    BLOCKED_IPV4_RANGES,
    BLOCKED_IPV6_RANGES,
    BLOCKED_HOSTNAMES,
};
