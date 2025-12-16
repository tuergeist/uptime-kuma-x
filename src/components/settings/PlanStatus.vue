<template>
    <div>
        <!-- Loading state -->
        <div v-if="loading" class="d-flex align-items-center justify-content-center my-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>

        <!-- Plan status content -->
        <div v-else class="plan-status-content">
            <!-- Current Plan Card -->
            <div class="plan-card mb-4" :class="planCardClass">
                <div class="plan-card-header">
                    <font-awesome-icon icon="gem" class="me-2" />
                    {{ $t("Current Plan") }}
                </div>
                <div class="plan-card-body">
                    <h2 class="plan-name">{{ planData.plan.name }}</h2>
                    <p class="plan-description">
                        <template v-if="planData.plan.slug === 'free'">
                            {{ $t("Get started with basic monitoring") }}
                        </template>
                        <template v-else-if="planData.plan.slug === 'pro'">
                            {{ $t("For growing teams and businesses") }}
                        </template>
                        <template v-else-if="planData.plan.slug === 'enterprise'">
                            {{ $t("Unlimited monitoring for large organizations") }}
                        </template>
                        <template v-else>
                            {{ $t("Custom plan") }}
                        </template>
                    </p>
                </div>
            </div>

            <!-- Usage Section -->
            <h5 class="mt-4 mb-3">{{ $t("Usage") }}</h5>

            <!-- Monitors Usage -->
            <div class="usage-item mb-3">
                <div class="d-flex justify-content-between mb-1">
                    <span>{{ $t("Monitors") }}</span>
                    <span class="usage-count">
                        {{ planData.usage.monitors }}
                        <template v-if="planData.limits.monitors !== null">
                            / {{ planData.limits.monitors }}
                        </template>
                        <template v-else>
                            <span class="text-muted">({{ $t("Unlimited") }})</span>
                        </template>
                    </span>
                </div>
                <div class="progress">
                    <div
                        class="progress-bar"
                        :class="getProgressClass(planData.usage.monitors, planData.limits.monitors)"
                        :style="{ width: getProgressWidth(planData.usage.monitors, planData.limits.monitors) }"
                    ></div>
                </div>
            </div>

            <!-- Status Pages Usage -->
            <div class="usage-item mb-3">
                <div class="d-flex justify-content-between mb-1">
                    <span>{{ $t("Status Pages") }}</span>
                    <span class="usage-count">
                        {{ planData.usage.statusPages }}
                        <template v-if="planData.limits.statusPages !== null">
                            / {{ planData.limits.statusPages }}
                        </template>
                        <template v-else>
                            <span class="text-muted">({{ $t("Unlimited") }})</span>
                        </template>
                    </span>
                </div>
                <div class="progress">
                    <div
                        class="progress-bar"
                        :class="getProgressClass(planData.usage.statusPages, planData.limits.statusPages)"
                        :style="{ width: getProgressWidth(planData.usage.statusPages, planData.limits.statusPages) }"
                    ></div>
                </div>
            </div>

            <!-- Team Members Usage -->
            <div class="usage-item mb-3">
                <div class="d-flex justify-content-between mb-1">
                    <span>{{ $t("Team Members") }}</span>
                    <span class="usage-count">
                        {{ planData.usage.users }}
                        <template v-if="planData.limits.users !== null">
                            / {{ planData.limits.users }}
                        </template>
                        <template v-else>
                            <span class="text-muted">({{ $t("Unlimited") }})</span>
                        </template>
                    </span>
                </div>
                <div class="progress">
                    <div
                        class="progress-bar"
                        :class="getProgressClass(planData.usage.users, planData.limits.users)"
                        :style="{ width: getProgressWidth(planData.usage.users, planData.limits.users) }"
                    ></div>
                </div>
            </div>

            <!-- Plan Features -->
            <h5 class="mt-5 mb-3">{{ $t("Plan Features") }}</h5>

            <div class="feature-list">
                <div class="feature-item">
                    <font-awesome-icon icon="check-circle" class="text-success me-2" />
                    <span>{{ $t("Minimum check interval") }}: </span>
                    <strong>{{ formatInterval(planData.limits.checkIntervalMin) }}</strong>
                </div>
                <div class="feature-item">
                    <font-awesome-icon icon="check-circle" class="text-success me-2" />
                    <span>{{ $t("Data retention") }}: </span>
                    <strong>{{ planData.limits.retentionDays }} {{ $t("days") }}</strong>
                </div>
            </div>

            <!-- Upgrade CTA (only show for non-enterprise plans) -->
            <div v-if="planData.plan.slug !== 'enterprise'" class="upgrade-section mt-5">
                <div class="upgrade-card">
                    <h5>{{ $t("Need more?") }}</h5>
                    <p class="text-muted mb-3">
                        {{ $t("Upgrade your plan to unlock more monitors, team members, and features.") }}
                    </p>
                    <a href="mailto:support@uptimehive.com?subject=Plan Upgrade Request" class="btn btn-primary">
                        <font-awesome-icon icon="arrow-alt-circle-up" class="me-2" />
                        {{ $t("Contact for Upgrade") }}
                    </a>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            loading: true,
            planData: {
                plan: {
                    id: null,
                    name: "Free",
                    slug: "free",
                },
                usage: {
                    monitors: 0,
                    statusPages: 0,
                    users: 0,
                },
                limits: {
                    monitors: 5,
                    statusPages: 1,
                    users: 1,
                    checkIntervalMin: 60,
                    retentionDays: 7,
                },
            },
        };
    },
    computed: {
        /**
         * Get CSS class for plan card based on plan type
         * @returns {string} CSS class
         */
        planCardClass() {
            const slug = this.planData.plan.slug;
            if (slug === "enterprise") {
                return "plan-enterprise";
            } else if (slug === "pro") {
                return "plan-pro";
            }
            return "plan-free";
        },
    },
    mounted() {
        this.loadPlanUsage();
    },
    methods: {
        /**
         * Load plan usage data from server
         * @returns {void}
         */
        loadPlanUsage() {
            this.$root.getSocket().emit("getPlanUsage", (res) => {
                this.loading = false;
                if (res.ok) {
                    this.planData = {
                        plan: res.plan,
                        usage: res.usage,
                        limits: res.limits,
                    };
                } else {
                    this.$root.toastError(res.msg || "Failed to load plan usage");
                }
            });
        },

        /**
         * Calculate progress bar width percentage
         * @param {number} current Current usage
         * @param {number|null} limit Maximum allowed (null = unlimited)
         * @returns {string} Width percentage
         */
        getProgressWidth(current, limit) {
            if (limit === null) {
                // For unlimited, show a small portion to indicate some usage
                return Math.min(current * 5, 30) + "%";
            }
            const percentage = Math.min((current / limit) * 100, 100);
            return percentage + "%";
        },

        /**
         * Get progress bar CSS class based on usage percentage
         * @param {number} current Current usage
         * @param {number|null} limit Maximum allowed
         * @returns {string} CSS class
         */
        getProgressClass(current, limit) {
            if (limit === null) {
                return "bg-success";
            }
            const percentage = (current / limit) * 100;
            if (percentage >= 100) {
                return "bg-danger";
            } else if (percentage >= 80) {
                return "bg-warning";
            }
            return "bg-success";
        },

        /**
         * Format interval in seconds to human readable format
         * @param {number} seconds Interval in seconds
         * @returns {string} Formatted interval
         */
        formatInterval(seconds) {
            if (seconds < 60) {
                return seconds + " " + this.$t("seconds");
            }
            const minutes = Math.floor(seconds / 60);
            return minutes + " " + this.$t("minutes");
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../assets/vars.scss";

.plan-status-content {
    max-width: 600px;
}

.plan-card {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #dee2e6;

    .dark & {
        border-color: $dark-border-color;
    }
}

.plan-card-header {
    padding: 12px 16px;
    font-weight: 600;
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.plan-card-body {
    padding: 20px;
}

.plan-name {
    margin: 0 0 8px 0;
    font-weight: 700;
}

.plan-description {
    margin: 0;
    color: $secondary-text;
}

// Plan card variants
.plan-free {
    .plan-card-header {
        background: linear-gradient(135deg, #6c757d, #495057);
        color: white;
    }
}

.plan-pro {
    .plan-card-header {
        background: linear-gradient(135deg, #0d6efd, #0a58ca);
        color: white;
    }
}

.plan-enterprise {
    .plan-card-header {
        background: linear-gradient(135deg, #7c3aed, #5b21b6);
        color: white;
    }
}

.usage-item {
    .usage-count {
        font-weight: 600;
    }
}

.progress {
    height: 8px;
    border-radius: 4px;
    background-color: #e9ecef;

    .dark & {
        background-color: $dark-bg;
    }
}

.feature-item {
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;

    .dark & {
        border-bottom-color: $dark-border-color;
    }

    &:last-child {
        border-bottom: none;
    }
}

.upgrade-section {
    .upgrade-card {
        background: linear-gradient(135deg, #f8f9fa, #e9ecef);
        border-radius: 12px;
        padding: 24px;
        text-align: center;

        .dark & {
            background: linear-gradient(135deg, $dark-bg2, $dark-bg);
        }

        h5 {
            margin-bottom: 8px;
        }
    }
}
</style>
