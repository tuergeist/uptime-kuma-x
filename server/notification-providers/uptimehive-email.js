const nodemailer = require("nodemailer");
const NotificationProvider = require("./notification-provider");
const { log } = require("../../src/util");
const { checkEmailLimit, incrementEmailCount } = require("../plan-enforcement");

/**
 * Default email subject template
 */
const DEFAULT_SUBJECT = "{{STATUS}} {{NAME}}";

/**
 * Default email body template (HTML)
 */
const DEFAULT_BODY = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: {{status == '✅ Up' ? '#28a745' : '#dc3545'}};">{{STATUS}} {{NAME}}</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Monitor:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">{{NAME}}</td>
        </tr>
        <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Status:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">{{STATUS}}</td>
        </tr>
        {% if hostnameOrURL != "" %}
        <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>URL/Host:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">{{hostnameOrURL}}</td>
        </tr>
        {% endif %}
        {% if heartbeatJSON %}
        <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Time:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">{{heartbeatJSON.localDateTime}} ({{heartbeatJSON.timezone}})</td>
        </tr>
        {% endif %}
        {% if msg %}
        <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Message:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">{{msg}}</td>
        </tr>
        {% endif %}
    </table>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #666; font-size: 12px;">
        Sent by <a href="https://uptimehive.com" style="color: #007bff;">UptimeHive</a>
    </p>
</div>`;

class UptimeHiveEmail extends NotificationProvider {
    name = "uptimehive-email";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";

        // Check required environment variables
        if (!process.env.AWS_SES_SMTP_HOST || !process.env.AWS_SES_SMTP_USER || !process.env.AWS_SES_SMTP_PASS) {
            throw new Error("UptimeHive Email is not configured. Please contact support.");
        }

        // Get tenant ID from notification for rate limiting
        const tenantId = notification.tenant_id || 1;

        // Check email rate limit
        const limitCheck = await checkEmailLimit(tenantId);
        if (!limitCheck.allowed) {
            throw new Error(`Daily email limit reached (${limitCheck.current}/${limitCheck.limit}). Limit resets at midnight UTC.`);
        }

        // Configure AWS SES SMTP transport
        const config = {
            host: process.env.AWS_SES_SMTP_HOST,
            port: parseInt(process.env.AWS_SES_SMTP_PORT) || 465,
            secure: true,
            auth: {
                user: process.env.AWS_SES_SMTP_USER,
                pass: process.env.AWS_SES_SMTP_PASS,
            },
        };

        // Get from address from env or use default
        const fromName = process.env.AWS_SES_FROM_NAME || "UptimeHive";
        const fromEmail = process.env.AWS_SES_FROM_EMAIL || "notification@uptimehive.com";
        const from = `"${fromName}" <${fromEmail}>`;

        // Prepare subject and body
        let subject = msg;
        let body = msg;
        let useHTMLBody = true;

        if (heartbeatJSON) {
            body = `${msg}\nTime (${heartbeatJSON["timezone"]}): ${heartbeatJSON["localDateTime"]}`;
        }

        // Use custom templates if provided, otherwise use defaults
        if ((monitorJSON && heartbeatJSON) || msg.endsWith("Testing")) {
            const customSubject = notification.customSubject?.trim() || DEFAULT_SUBJECT;
            const customBody = notification.customBody?.trim() || DEFAULT_BODY;

            subject = await this.renderTemplate(customSubject, msg, monitorJSON, heartbeatJSON);
            body = await this.renderTemplate(customBody, msg, monitorJSON, heartbeatJSON);
            useHTMLBody = notification.htmlBody !== false; // Default to HTML
        }

        // Create transporter and send
        let transporter = nodemailer.createTransport(config);

        const mailOptions = {
            from: from,
            to: notification.uptimehiveEmailTo,
            subject: subject,
            [useHTMLBody ? "html" : "text"]: body,
        };

        // Add CC if provided
        if (notification.uptimehiveEmailCC) {
            mailOptions.cc = notification.uptimehiveEmailCC;
        }

        // Add BCC if provided
        if (notification.uptimehiveEmailBCC) {
            mailOptions.bcc = notification.uptimehiveEmailBCC;
        }

        await transporter.sendMail(mailOptions);

        // Increment email count after successful send
        await incrementEmailCount(tenantId);

        log.debug("uptimehive-email", `Email sent to ${notification.uptimehiveEmailTo} for tenant ${tenantId}`);

        return okMsg;
    }
}

module.exports = UptimeHiveEmail;
