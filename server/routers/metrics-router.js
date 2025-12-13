const express = require("express");
const { getMetrics, getContentType } = require("../services/prometheus-metrics");

const router = express.Router();

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get("/", async (req, res) => {
    try {
        const metrics = await getMetrics();
        res.set("Content-Type", getContentType());
        res.send(metrics);
    } catch (err) {
        res.status(500).send("Error collecting metrics: " + err.message);
    }
});

module.exports = router;
