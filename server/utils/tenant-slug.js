/**
 * Tenant Slug Utility
 *
 * Generates URL-friendly slugs from company names with collision handling.
 * If "vsx" exists, returns "vsx2", "vsx3", etc.
 */

const { R } = require("redbean-node");

/**
 * Generate a URL-friendly slug from a name
 * @param {string} name - Company/organization name
 * @returns {string} URL-friendly slug
 */
function generateSlug(name) {
    if (!name || typeof name !== "string") {
        return "org";
    }

    return name
        .toLowerCase()
        .trim()
        // Replace spaces and underscores with dashes
        .replace(/[\s_]+/g, "-")
        // Remove all non-alphanumeric characters except dashes
        .replace(/[^a-z0-9-]/g, "")
        // Replace multiple consecutive dashes with single dash
        .replace(/-+/g, "-")
        // Remove leading/trailing dashes
        .replace(/^-+|-+$/g, "")
        // Limit length to 63 characters (DNS label limit)
        .substring(0, 63)
        // Remove trailing dash if substring cut mid-word
        .replace(/-+$/, "")
        // Fallback if empty after processing
        || "org";
}

/**
 * Get a unique tenant slug, handling collisions by appending numbers
 * @param {string} name - Company/organization name
 * @returns {Promise<string>} Unique slug (e.g., "vsx", "vsx2", "vsx3")
 */
async function getUniqueTenantSlug(name) {
    const baseSlug = generateSlug(name);

    // Check if base slug is available
    const existing = await R.findOne("tenant", " slug = ? ", [baseSlug]);
    if (!existing) {
        return baseSlug;
    }

    // Find all slugs that match baseSlug or baseSlug + number pattern
    // e.g., for "vsx", find "vsx", "vsx2", "vsx3", etc.
    const similar = await R.getAll(
        "SELECT slug FROM tenant WHERE slug = ? OR slug ~ ?",
        [baseSlug, `^${baseSlug}[0-9]+$`]
    );

    // If regex isn't supported (SQLite), fall back to LIKE
    let slugs = similar;
    if (!slugs || slugs.length === 0) {
        slugs = await R.getAll(
            "SELECT slug FROM tenant WHERE slug = ? OR slug LIKE ?",
            [baseSlug, `${baseSlug}%`]
        );
    }

    // Extract numbers from matching slugs and find the highest
    let maxNumber = 1;
    const slugList = Array.isArray(slugs) ? slugs : [];

    for (const row of slugList) {
        const slug = row.slug;
        if (slug === baseSlug) {
            // Base slug exists, we need at least 2
            maxNumber = Math.max(maxNumber, 1);
        } else {
            // Extract number suffix
            const suffix = slug.substring(baseSlug.length);
            const num = parseInt(suffix, 10);
            if (!isNaN(num) && num > 0) {
                maxNumber = Math.max(maxNumber, num);
            }
        }
    }

    // Return base slug + next available number
    return `${baseSlug}${maxNumber + 1}`;
}

/**
 * Validate a slug format
 * @param {string} slug - Slug to validate
 * @returns {boolean} True if valid
 */
function isValidSlug(slug) {
    if (!slug || typeof slug !== "string") {
        return false;
    }
    // Must be lowercase alphanumeric with dashes, no consecutive dashes
    // Must start and end with alphanumeric
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) &&
           !slug.includes("--") &&
           slug.length <= 63;
}

module.exports = {
    generateSlug,
    getUniqueTenantSlug,
    isValidSlug,
};
