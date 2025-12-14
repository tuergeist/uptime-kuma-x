<template>
    <div>
        <!-- Loading state -->
        <div v-if="loading" class="d-flex align-items-center justify-content-center my-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>

        <!-- Non-owner message -->
        <div
            v-else-if="!isOwner"
            class="mt-5 d-flex flex-column align-items-center justify-content-center my-3"
        >
            <font-awesome-icon icon="lock" size="3x" class="mb-3 text-muted" />
            <p class="text-muted">{{ $t("Organization settings are only available to owners") }}</p>
            <p class="text-muted">
                {{ $t("Your role") }}: <strong>{{ userRole }}</strong>
            </p>
        </div>

        <!-- Owner view -->
        <div v-else class="settings-content">
            <form @submit.prevent="save">
                <h5 class="mt-4 mb-4">{{ $t("Organization Info") }}</h5>

                <!-- Organization Name -->
                <div class="mb-3">
                    <label class="form-label" for="orgName">{{ $t("Organization Name") }} <span class="text-danger">*</span></label>
                    <input
                        id="orgName"
                        v-model="tenant.name"
                        type="text"
                        class="form-control"
                        required
                    >
                </div>

                <!-- Slug -->
                <div class="mb-3">
                    <label class="form-label" for="orgSlug">{{ $t("URL Slug") }}</label>
                    <div class="input-group">
                        <span class="input-group-text">/status/</span>
                        <input
                            id="orgSlug"
                            v-model="tenant.slug"
                            type="text"
                            class="form-control"
                            pattern="[a-z0-9-]+"
                            @input="validateSlug"
                        >
                        <span class="input-group-text">-yourpage</span>
                    </div>
                    <div class="form-text">
                        {{ $t("Used as prefix for status page URLs. Lowercase letters, numbers, and dashes only.") }}
                    </div>
                    <div v-if="slugError" class="text-danger mt-1">
                        {{ slugError }}
                    </div>
                </div>

                <h5 class="mt-5 mb-4">{{ $t("Company Details") }}</h5>

                <!-- Company Name -->
                <div class="mb-3">
                    <label class="form-label" for="companyName">{{ $t("Company Name") }}</label>
                    <input
                        id="companyName"
                        v-model="tenant.companyName"
                        type="text"
                        class="form-control"
                        :placeholder="$t('Legal company name')"
                    >
                </div>

                <!-- Company Address -->
                <div class="mb-3">
                    <label class="form-label" for="companyAddress">{{ $t("Address") }}</label>
                    <textarea
                        id="companyAddress"
                        v-model="tenant.companyAddress"
                        class="form-control"
                        rows="3"
                        :placeholder="$t('Company address')"
                    ></textarea>
                </div>

                <!-- Company Email -->
                <div class="mb-3">
                    <label class="form-label" for="companyEmail">{{ $t("Contact Email") }}</label>
                    <input
                        id="companyEmail"
                        v-model="tenant.companyEmail"
                        type="email"
                        class="form-control"
                        :placeholder="$t('contact@company.com')"
                    >
                </div>

                <!-- Company Phone -->
                <div class="mb-3">
                    <label class="form-label" for="companyPhone">{{ $t("Phone") }}</label>
                    <input
                        id="companyPhone"
                        v-model="tenant.companyPhone"
                        type="tel"
                        class="form-control"
                        :placeholder="$t('+1 234 567 890')"
                    >
                </div>

                <!-- Company Website -->
                <div class="mb-3">
                    <label class="form-label" for="companyWebsite">{{ $t("Website") }}</label>
                    <input
                        id="companyWebsite"
                        v-model="tenant.companyWebsite"
                        type="url"
                        class="form-control"
                        placeholder="https://www.company.com"
                    >
                </div>

                <!-- Save Button -->
                <div class="mt-4">
                    <button
                        type="submit"
                        class="btn btn-primary"
                        :disabled="saving || !!slugError"
                    >
                        <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
                        {{ $t("Save") }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            loading: true,
            saving: false,
            isOwner: false,
            userRole: "member",
            tenant: {
                name: "",
                slug: "",
                companyName: "",
                companyAddress: "",
                companyEmail: "",
                companyPhone: "",
                companyWebsite: "",
            },
            originalSlug: "",
            slugError: "",
        };
    },
    mounted() {
        this.loadData();
    },
    methods: {
        /**
         * Load organization data
         * @returns {void}
         */
        loadData() {
            // Get current user role first
            this.$root.getSocket().emit("getMyRole", (res) => {
                if (res.ok) {
                    this.isOwner = res.isOwner;
                    this.userRole = res.role;

                    if (this.isOwner) {
                        this.loadTenant();
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
         * Load tenant info
         * @returns {void}
         */
        loadTenant() {
            this.$root.getSocket().emit("getTenantInfo", (res) => {
                this.loading = false;
                if (res.ok) {
                    this.tenant = res.tenant;
                    this.originalSlug = res.tenant.slug;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * Validate slug format and availability
         * @returns {void}
         */
        validateSlug() {
            // Convert to lowercase
            this.tenant.slug = this.tenant.slug.toLowerCase();

            // Check format
            if (!/^[a-z0-9-]*$/.test(this.tenant.slug)) {
                this.slugError = this.$t("Only lowercase letters, numbers, and dashes allowed");
                return;
            }

            if (this.tenant.slug.includes("--")) {
                this.slugError = this.$t("No consecutive dashes allowed");
                return;
            }

            // If slug changed, check availability
            if (this.tenant.slug && this.tenant.slug !== this.originalSlug) {
                this.$root.getSocket().emit("checkSlugAvailable", this.tenant.slug, (res) => {
                    if (res.ok && !res.available) {
                        this.slugError = this.$t("This slug is already taken");
                    } else {
                        this.slugError = "";
                    }
                });
            } else {
                this.slugError = "";
            }
        },

        /**
         * Save organization settings
         * @returns {void}
         */
        save() {
            if (this.slugError) {
                return;
            }

            this.saving = true;

            this.$root.getSocket().emit("updateTenantInfo", this.tenant, (res) => {
                this.saving = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.originalSlug = this.tenant.slug;
                    // Refresh info to update tenant slug in app
                    this.$root.getSocket().emit("info");
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.settings-content {
    max-width: 600px;
}
</style>
