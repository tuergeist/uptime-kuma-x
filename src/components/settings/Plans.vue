<template>
    <div>
        <!-- Loading state -->
        <div v-if="loading" class="d-flex align-items-center justify-content-center my-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>

        <!-- Non-super-admin message -->
        <div
            v-else-if="!isSuperAdmin"
            class="mt-5 d-flex flex-column align-items-center justify-content-center my-3"
        >
            <font-awesome-icon icon="lock" size="3x" class="mb-3 text-muted" />
            <p class="text-muted">{{ $t("Plan management is only available to super admins") }}</p>
        </div>

        <!-- Super-admin view -->
        <div v-else>
            <!-- Add Plan button -->
            <div class="add-btn">
                <button class="btn btn-primary" type="button" @click="openPlanDialog(null)">
                    <font-awesome-icon icon="plus" /> {{ $t("Add Plan") }}
                </button>
            </div>

            <!-- Plans Table -->
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>{{ $t("Name") }}</th>
                            <th>{{ $t("Slug") }}</th>
                            <th>{{ $t("Monitors") }}</th>
                            <th>{{ $t("Users") }}</th>
                            <th>{{ $t("Check Interval") }}</th>
                            <th>{{ $t("Price") }}</th>
                            <th>{{ $t("Status") }}</th>
                            <th>{{ $t("Actions") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="plan in plans" :key="plan.id" :class="{ 'table-secondary': !plan.is_active }">
                            <td>
                                <strong>{{ plan.name }}</strong>
                            </td>
                            <td>
                                <code>{{ plan.slug }}</code>
                            </td>
                            <td>{{ formatLimit(plan.monitor_limit) }}</td>
                            <td>{{ formatLimit(plan.users_limit) }}</td>
                            <td>{{ plan.check_interval_min }}s</td>
                            <td>
                                <span v-if="plan.price_monthly > 0">
                                    ${{ plan.price_monthly }}/mo
                                </span>
                                <span v-else class="text-muted">Free</span>
                            </td>
                            <td>
                                <span
                                    class="badge"
                                    :class="plan.is_active ? 'bg-success' : 'bg-secondary'"
                                >
                                    {{ plan.is_active ? $t("Active") : $t("Inactive") }}
                                </span>
                            </td>
                            <td>
                                <div class="btn-group btn-group-sm">
                                    <button
                                        class="btn btn-outline-primary"
                                        :title="$t('Edit')"
                                        @click="openPlanDialog(plan)"
                                    >
                                        <font-awesome-icon icon="edit" />
                                    </button>
                                    <button
                                        class="btn btn-outline-danger"
                                        :title="$t('Delete')"
                                        @click="confirmDelete(plan)"
                                    >
                                        <font-awesome-icon icon="trash" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="plans.length === 0" class="text-center text-muted my-5">
                {{ $t("No plans configured yet") }}
            </div>
        </div>

        <!-- Plan Dialog -->
        <div ref="planModal" class="modal fade" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            {{ editingPlan.id ? $t("Edit Plan") : $t("Add Plan") }}
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form @submit.prevent="savePlan">
                            <div class="row">
                                <!-- Basic Info -->
                                <div class="col-md-6">
                                    <h6 class="mb-3">{{ $t("Basic Info") }}</h6>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Plan Name") }} <span class="text-danger">*</span></label>
                                        <input
                                            v-model="editingPlan.name"
                                            type="text"
                                            class="form-control"
                                            required
                                            @input="generateSlug"
                                        >
                                    </div>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Slug") }} <span class="text-danger">*</span></label>
                                        <input
                                            v-model="editingPlan.slug"
                                            type="text"
                                            class="form-control"
                                            pattern="[a-z0-9-]+"
                                            required
                                        >
                                        <div class="form-text">{{ $t("Lowercase letters, numbers, and dashes only") }}</div>
                                    </div>

                                    <div class="mb-3">
                                        <div class="form-check form-switch">
                                            <input
                                                id="planActive"
                                                v-model="editingPlan.is_active"
                                                class="form-check-input"
                                                type="checkbox"
                                            >
                                            <label class="form-check-label" for="planActive">
                                                {{ $t("Active") }}
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <!-- Limits -->
                                <div class="col-md-6">
                                    <h6 class="mb-3">{{ $t("Limits") }}</h6>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Monitor Limit") }}</label>
                                        <input
                                            v-model.number="editingPlan.monitor_limit"
                                            type="number"
                                            class="form-control"
                                            min="-1"
                                        >
                                        <div class="form-text">{{ $t("-1 for unlimited") }}</div>
                                    </div>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Users Limit") }}</label>
                                        <input
                                            v-model.number="editingPlan.users_limit"
                                            type="number"
                                            class="form-control"
                                            min="-1"
                                        >
                                    </div>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Status Pages Limit") }}</label>
                                        <input
                                            v-model.number="editingPlan.status_pages_limit"
                                            type="number"
                                            class="form-control"
                                            min="-1"
                                        >
                                    </div>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Min Check Interval (seconds)") }}</label>
                                        <input
                                            v-model.number="editingPlan.check_interval_min"
                                            type="number"
                                            class="form-control"
                                            min="1"
                                        >
                                    </div>

                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Retention Days") }}</label>
                                        <input
                                            v-model.number="editingPlan.retention_days"
                                            type="number"
                                            class="form-control"
                                            min="1"
                                        >
                                    </div>
                                </div>
                            </div>

                            <!-- Pricing -->
                            <h6 class="mt-4 mb-3">{{ $t("Pricing") }}</h6>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Monthly Price") }} ($)</label>
                                        <input
                                            v-model.number="editingPlan.price_monthly"
                                            type="number"
                                            class="form-control"
                                            min="0"
                                            step="0.01"
                                        >
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Yearly Price") }} ($)</label>
                                        <input
                                            v-model.number="editingPlan.price_yearly"
                                            type="number"
                                            class="form-control"
                                            min="0"
                                            step="0.01"
                                        >
                                    </div>
                                </div>
                            </div>

                            <!-- Stripe IDs (optional) -->
                            <h6 class="mt-4 mb-3">{{ $t("Payment Integration") }} <small class="text-muted">({{ $t("Optional") }})</small></h6>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Stripe Monthly Price ID") }}</label>
                                        <input
                                            v-model="editingPlan.stripe_price_id_monthly"
                                            type="text"
                                            class="form-control"
                                            placeholder="price_xxx"
                                        >
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="mb-3">
                                        <label class="form-label">{{ $t("Stripe Yearly Price ID") }}</label>
                                        <input
                                            v-model="editingPlan.stripe_price_id_yearly"
                                            type="text"
                                            class="form-control"
                                            placeholder="price_xxx"
                                        >
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            {{ $t("Cancel") }}
                        </button>
                        <button
                            type="button"
                            class="btn btn-primary"
                            :disabled="saving"
                            @click="savePlan"
                        >
                            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
                            {{ $t("Save") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Confirm Delete -->
        <Confirm
            ref="confirmDelete"
            btn-style="btn-danger"
            :yes-text="$t('Delete')"
            :no-text="$t('Cancel')"
            @yes="deletePlan"
        >
            {{ $t("Are you sure you want to delete the plan '{name}'?", { name: selectedPlan?.name }) }}
            <div v-if="selectedPlan" class="alert alert-warning mt-3 mb-0">
                {{ $t("If tenants are using this plan, it will be deactivated instead of deleted.") }}
            </div>
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import { Modal } from "bootstrap";

export default {
    components: {
        Confirm,
    },
    data() {
        return {
            loading: true,
            isSuperAdmin: false,
            plans: [],
            editingPlan: this.getEmptyPlan(),
            selectedPlan: null,
            saving: false,
            planModal: null,
        };
    },
    mounted() {
        this.loadData();
    },
    methods: {
        /**
         * Get empty plan object
         * @returns {object} Empty plan
         */
        getEmptyPlan() {
            return {
                id: null,
                name: "",
                slug: "",
                monitor_limit: 10,
                retention_days: 30,
                status_pages_limit: 1,
                users_limit: 1,
                check_interval_min: 60,
                price_monthly: 0,
                price_yearly: 0,
                stripe_price_id_monthly: "",
                stripe_price_id_yearly: "",
                features: {},
                is_active: true,
            };
        },

        /**
         * Load super-admin status and plans
         * @returns {void}
         */
        loadData() {
            this.$root.getSocket().emit("getSuperAdminStatus", (res) => {
                if (res.ok) {
                    this.isSuperAdmin = res.isSuperAdmin;

                    if (this.isSuperAdmin) {
                        this.loadPlans();
                    } else {
                        this.loading = false;
                    }
                } else {
                    this.loading = false;
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * Load all plans
         * @returns {void}
         */
        loadPlans() {
            this.$root.getSocket().emit("getPlans", (res) => {
                this.loading = false;
                if (res.ok) {
                    this.plans = res.plans;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * Format limit value for display
         * @param {number} limit Limit value
         * @returns {string} Formatted limit
         */
        formatLimit(limit) {
            if (limit === -1 || limit === null) {
                return this.$t("Unlimited");
            }
            return limit.toString();
        },

        /**
         * Generate slug from plan name
         * @returns {void}
         */
        generateSlug() {
            if (!this.editingPlan.id) {
                this.editingPlan.slug = this.editingPlan.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "");
            }
        },

        /**
         * Open plan dialog for create/edit
         * @param {object|null} plan Plan to edit, or null for new
         * @returns {void}
         */
        openPlanDialog(plan) {
            if (plan) {
                this.editingPlan = { ...plan };
            } else {
                this.editingPlan = this.getEmptyPlan();
            }

            if (!this.planModal) {
                this.planModal = new Modal(this.$refs.planModal);
            }
            this.planModal.show();
        },

        /**
         * Save plan (create or update)
         * @returns {void}
         */
        savePlan() {
            if (!this.editingPlan.name || !this.editingPlan.slug) {
                this.$root.toastError(this.$t("Name and slug are required"));
                return;
            }

            this.saving = true;

            this.$root.getSocket().emit("savePlan", this.editingPlan, (res) => {
                this.saving = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.planModal.hide();
                    this.loadPlans();
                }
            });
        },

        /**
         * Show delete confirmation
         * @param {object} plan Plan to delete
         * @returns {void}
         */
        confirmDelete(plan) {
            this.selectedPlan = plan;
            this.$refs.confirmDelete.show();
        },

        /**
         * Delete plan
         * @returns {void}
         */
        deletePlan() {
            if (!this.selectedPlan) {
                return;
            }

            this.$root.getSocket().emit("deletePlan", this.selectedPlan.id, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadPlans();
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.add-btn {
    padding-top: 20px;
    padding-bottom: 20px;
}

.table th {
    white-space: nowrap;
}

code {
    background-color: rgba(0, 0, 0, 0.05);
    padding: 2px 6px;
    border-radius: 4px;
}

.dark code {
    background-color: rgba(255, 255, 255, 0.1);
}
</style>
