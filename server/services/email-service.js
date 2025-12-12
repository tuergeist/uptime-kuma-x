const nodemailer = require("nodemailer");
const { log } = require("../../src/util");

/**
 * Email service for sending system emails (invitations, etc.)
 * Configuration via environment variables:
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (default: 587)
 * - SMTP_SECURE: Use TLS (default: false)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM: Sender email address
 * - APP_URL: Application base URL for links
 */

/**
 * Check if email is configured
 * @returns {boolean} True if SMTP is configured
 */
function isEmailConfigured() {
    return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

/**
 * Get the configured transporter
 * @returns {object|null} Nodemailer transporter or null if not configured
 */
function getTransporter() {
    if (!isEmailConfigured()) {
        return null;
    }

    const config = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        tls: {
            rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
        },
    };

    if (process.env.SMTP_USER || process.env.SMTP_PASS) {
        config.auth = {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        };
    }

    return nodemailer.createTransport(config);
}

/**
 * Get the application URL
 * @returns {string} Application base URL
 */
function getAppUrl() {
    return process.env.APP_URL || "http://localhost:3000";
}

/**
 * Send an invitation email
 * @param {string} email Recipient email
 * @param {string} token Invitation token
 * @param {string} tenantName Name of the organization
 * @param {string} inviterName Name of the person who sent the invite
 * @param {string} role Role being assigned
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendInvitationEmail(email, token, tenantName, inviterName, role) {
    const transporter = getTransporter();

    if (!transporter) {
        log.warn("email", "Email not configured - invitation email not sent");
        return false;
    }

    const appUrl = getAppUrl();
    const inviteUrl = `${appUrl}/invite/${token}`;

    const subject = `You've been invited to join ${tenantName} on Uptime Kuma`;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #5cdd8b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #5cdd8b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Uptime Kuma</h1>
        </div>
        <div class="content">
            <h2>You're invited!</h2>
            <p>${inviterName ? `<strong>${inviterName}</strong> has invited you` : "You have been invited"} to join <strong>${tenantName}</strong> as a <strong>${role}</strong>.</p>
            <p>Click the button below to create your account and join the team:</p>
            <p style="text-align: center;">
                <a href="${inviteUrl}" class="button">Accept Invitation</a>
            </p>
            <p style="font-size: 12px; color: #666;">
                Or copy this link: <br>
                <a href="${inviteUrl}">${inviteUrl}</a>
            </p>
            <p style="font-size: 12px; color: #666;">
                This invitation expires in 7 days.
            </p>
        </div>
        <div class="footer">
            <p>Uptime Kuma - A fancy self-hosted monitoring tool</p>
        </div>
    </div>
</body>
</html>
    `.trim();

    const text = `
You've been invited to join ${tenantName} on Uptime Kuma

${inviterName ? `${inviterName} has invited you` : "You have been invited"} to join ${tenantName} as a ${role}.

Click the link below to create your account and join the team:
${inviteUrl}

This invitation expires in 7 days.

---
Uptime Kuma - A fancy self-hosted monitoring tool
    `.trim();

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: email,
            subject: subject,
            text: text,
            html: html,
        });

        log.info("email", `Invitation email sent to ${email}`);
        return true;
    } catch (error) {
        log.error("email", `Failed to send invitation email to ${email}: ${error.message}`);
        return false;
    }
}

/**
 * Send a welcome email after registration
 * @param {string} email Recipient email
 * @param {string} username Username
 * @param {string} tenantName Name of the organization
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendWelcomeEmail(email, username, tenantName) {
    const transporter = getTransporter();

    if (!transporter) {
        log.warn("email", "Email not configured - welcome email not sent");
        return false;
    }

    const appUrl = getAppUrl();

    const subject = `Welcome to Uptime Kuma, ${username}!`;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #5cdd8b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #5cdd8b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to Uptime Kuma!</h1>
        </div>
        <div class="content">
            <h2>Hi ${username}!</h2>
            <p>Your organization <strong>${tenantName}</strong> has been created successfully.</p>
            <p>You can now start adding monitors to track the uptime of your websites and services.</p>
            <p style="text-align: center;">
                <a href="${appUrl}/dashboard" class="button">Go to Dashboard</a>
            </p>
        </div>
        <div class="footer">
            <p>Uptime Kuma - A fancy self-hosted monitoring tool</p>
        </div>
    </div>
</body>
</html>
    `.trim();

    const text = `
Welcome to Uptime Kuma, ${username}!

Your organization ${tenantName} has been created successfully.

You can now start adding monitors to track the uptime of your websites and services.

Go to your dashboard: ${appUrl}/dashboard

---
Uptime Kuma - A fancy self-hosted monitoring tool
    `.trim();

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: email,
            subject: subject,
            text: text,
            html: html,
        });

        log.info("email", `Welcome email sent to ${email}`);
        return true;
    } catch (error) {
        log.error("email", `Failed to send welcome email to ${email}: ${error.message}`);
        return false;
    }
}

module.exports = {
    isEmailConfigured,
    sendInvitationEmail,
    sendWelcomeEmail,
    getAppUrl,
};
