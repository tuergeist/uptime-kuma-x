const { R } = require("redbean-node");

class TwoFA {

    /**
     * Disable 2FA for specified user
     * @param {number} userID ID of user to disable
     * @returns {Promise<void>}
     */
    static async disable2FA(userID) {
        // Use double quotes and false for PostgreSQL compatibility
        return await R.exec("UPDATE \"user\" SET twofa_status = false WHERE id = ? ", [
            userID,
        ]);
    }

}

module.exports = TwoFA;
