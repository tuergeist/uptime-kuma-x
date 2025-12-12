<template>
    <form @submit.prevent="submit">
        <!-- Invite Form Modal -->
        <div ref="inviteModal" class="modal fade" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            {{ $t("Invite Member") }}
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
                    </div>
                    <div class="modal-body">
                        <!-- Email -->
                        <div class="mb-3">
                            <label for="invite-email" class="form-label">{{ $t("Email") }}</label>
                            <input
                                id="invite-email"
                                v-model="email"
                                type="email"
                                class="form-control"
                                :placeholder="$t('Enter email address')"
                                required
                            >
                        </div>

                        <!-- Role -->
                        <div class="mb-3">
                            <label for="invite-role" class="form-label">{{ $t("Role") }}</label>
                            <select id="invite-role" v-model="role" class="form-select">
                                <option value="member">{{ $t("Member") }}</option>
                                <option value="admin">{{ $t("Admin") }}</option>
                            </select>
                            <div class="form-text">
                                {{ roleDescription }}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            {{ $t("Cancel") }}
                        </button>
                        <button
                            class="btn btn-primary"
                            type="submit"
                            :disabled="processing"
                        >
                            <span v-if="processing" class="spinner-border spinner-border-sm me-1"></span>
                            {{ $t("Send Invitation") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Success Modal with Invite Link -->
        <div ref="successModal" class="modal fade" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <font-awesome-icon icon="check-circle" class="text-success me-2" />
                            {{ $t("Invitation Sent") }}
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
                    </div>

                    <div class="modal-body">
                        <div v-if="emailSent" class="alert alert-success">
                            {{ $t("Invitation email sent to {email}", { email: lastInviteEmail }) }}
                        </div>
                        <div v-else class="alert alert-warning">
                            {{ $t("Email not configured. Please share the invitation link manually.") }}
                        </div>

                        <div class="mb-3">
                            <label class="form-label">{{ $t("Invitation Link") }}</label>
                            <div class="input-group">
                                <input
                                    type="text"
                                    class="form-control"
                                    :value="inviteUrl"
                                    readonly
                                >
                                <button
                                    class="btn btn-outline-secondary"
                                    type="button"
                                    @click="copyLink"
                                >
                                    <font-awesome-icon icon="copy" /> {{ $t("Copy") }}
                                </button>
                            </div>
                            <div class="form-text">
                                {{ $t("This link expires in 7 days.") }}
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                            {{ $t("Done") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </form>
</template>

<script>
import { Modal } from "bootstrap";

export default {
    emits: [ "invited" ],
    data() {
        return {
            inviteModal: null,
            successModal: null,
            processing: false,
            email: "",
            role: "member",
            inviteUrl: "",
            lastInviteEmail: "",
            emailSent: false,
        };
    },

    computed: {
        /**
         * Get role description
         * @returns {string} Role description
         */
        roleDescription() {
            if (this.role === "admin") {
                return this.$t("Admins can manage monitors, notifications, and settings");
            }
            return this.$t("Members can manage monitors and notifications");
        },
    },

    mounted() {
        this.inviteModal = new Modal(this.$refs.inviteModal);
        this.successModal = new Modal(this.$refs.successModal);
    },

    methods: {
        /**
         * Show the invite modal
         * @returns {void}
         */
        show() {
            this.email = "";
            this.role = "member";
            this.inviteModal.show();
        },

        /**
         * Submit invitation
         * @returns {void}
         */
        submit() {
            this.processing = true;

            this.$root.getSocket().emit("createInvitation", {
                email: this.email,
                role: this.role,
            }, (res) => {
                this.processing = false;

                if (res.ok) {
                    this.inviteModal.hide();

                    // Store result for success modal
                    this.inviteUrl = res.invitation.inviteUrl;
                    this.lastInviteEmail = res.invitation.email;
                    this.emailSent = res.emailSent;

                    // Show success modal
                    this.successModal.show();

                    // Emit event to refresh list
                    this.$emit("invited");
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * Copy invite link to clipboard
         * @returns {void}
         */
        async copyLink() {
            try {
                await navigator.clipboard.writeText(this.inviteUrl);
                this.$root.toastSuccess(this.$t("Copied to clipboard"));
            } catch (err) {
                this.$root.toastError(this.$t("Failed to copy"));
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.dark {
    .modal-dialog .form-text {
        color: $dark-font-color;
    }
}
</style>
