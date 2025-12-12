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
            <p class="text-muted">{{ $t("Team management is only available to owners") }}</p>
            <p class="text-muted">
                {{ $t("Your role") }}: <strong>{{ userRole }}</strong>
            </p>
        </div>

        <!-- Owner view -->
        <div v-else>
            <!-- Invite button -->
            <div class="add-btn">
                <button class="btn btn-primary me-2" type="button" @click="$refs.inviteDialog.show()">
                    <font-awesome-icon icon="user-plus" /> {{ $t("Invite Member") }}
                </button>
            </div>

            <!-- Team Members Section -->
            <h5 class="mt-4 mb-3">{{ $t("Team Members") }}</h5>

            <div v-if="members.length === 0" class="text-center text-muted my-3">
                {{ $t("No team members yet") }}
            </div>

            <div
                v-for="member in members"
                :key="member.id"
                class="item"
                :class="getRoleClass(member.role)"
            >
                <div class="left-part">
                    <div class="avatar">
                        <font-awesome-icon icon="user" />
                    </div>
                    <div class="info">
                        <div class="title">
                            {{ member.username }}
                            <span v-if="member.username === $root.username" class="badge bg-secondary ms-2">{{ $t("You") }}</span>
                        </div>
                        <div class="email text-muted">{{ member.email || "-" }}</div>
                        <div class="role-badge" :class="'role-' + member.role">
                            {{ $t(capitalizeRole(member.role)) }}
                        </div>
                    </div>
                </div>

                <div v-if="member.username !== $root.username && member.role !== 'owner'" class="buttons">
                    <div class="btn-group" role="group">
                        <button
                            class="btn btn-outline-secondary"
                            :title="$t('Change Role')"
                            @click="openRoleDialog(member)"
                        >
                            <font-awesome-icon icon="user-shield" />
                        </button>
                        <button
                            class="btn btn-outline-danger"
                            :title="$t('Remove')"
                            @click="confirmRemoveMember(member)"
                        >
                            <font-awesome-icon icon="user-minus" />
                        </button>
                    </div>
                </div>
            </div>

            <!-- Pending Invitations Section -->
            <h5 class="mt-5 mb-3">{{ $t("Pending Invitations") }}</h5>

            <div v-if="invitations.length === 0" class="text-center text-muted my-3">
                {{ $t("No pending invitations") }}
            </div>

            <div
                v-for="invite in invitations"
                :key="invite.id"
                class="item pending"
            >
                <div class="left-part">
                    <div class="avatar pending">
                        <font-awesome-icon icon="envelope" />
                    </div>
                    <div class="info">
                        <div class="title">{{ invite.email }}</div>
                        <div class="role-badge" :class="'role-' + invite.role">
                            {{ $t(capitalizeRole(invite.role)) }}
                        </div>
                        <div class="date">
                            {{ $t("Expires") }}: {{ formatDate(invite.expires_at) }}
                        </div>
                    </div>
                </div>

                <div class="buttons">
                    <button
                        class="btn btn-outline-danger"
                        :title="$t('Cancel')"
                        @click="confirmCancelInvitation(invite)"
                    >
                        <font-awesome-icon icon="times" /> {{ $t("Cancel") }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Invite Dialog -->
        <InviteDialog ref="inviteDialog" @invited="loadData" />

        <!-- Confirm Remove Member -->
        <Confirm
            ref="confirmRemove"
            btn-style="btn-danger"
            :yes-text="$t('Remove')"
            :no-text="$t('Cancel')"
            @yes="removeMember"
        >
            {{ $t("Are you sure you want to remove {username} from the team?", { username: selectedMember?.username }) }}
        </Confirm>

        <!-- Confirm Cancel Invitation -->
        <Confirm
            ref="confirmCancel"
            btn-style="btn-danger"
            :yes-text="$t('Yes')"
            :no-text="$t('No')"
            @yes="cancelInvitation"
        >
            {{ $t("Are you sure you want to cancel the invitation to {email}?", { email: selectedInvitation?.email }) }}
        </Confirm>

        <!-- Change Role Dialog -->
        <div ref="roleModal" class="modal fade" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">{{ $t("Change Role") }}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>{{ $t("Change role for {username}", { username: selectedMember?.username }) }}</p>
                        <div class="form-group">
                            <label class="form-label">{{ $t("Role") }}</label>
                            <select v-model="newRole" class="form-select">
                                <option value="member">{{ $t("Member") }}</option>
                                <option value="admin">{{ $t("Admin") }}</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            {{ $t("Cancel") }}
                        </button>
                        <button type="button" class="btn btn-primary" @click="updateRole">
                            {{ $t("Save") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import InviteDialog from "../InviteDialog.vue";
import { Modal } from "bootstrap";

export default {
    components: {
        Confirm,
        InviteDialog,
    },
    data() {
        return {
            loading: true,
            isOwner: false,
            userRole: "member",
            members: [],
            invitations: [],
            selectedMember: null,
            selectedInvitation: null,
            newRole: "member",
            roleModal: null,
        };
    },
    mounted() {
        this.loadData();
    },
    methods: {
        /**
         * Load team data
         * @returns {void}
         */
        loadData() {
            // Get current user role first
            this.$root.getSocket().emit("getMyRole", (res) => {
                if (res.ok) {
                    this.isOwner = res.isOwner;
                    this.userRole = res.role;

                    if (this.isOwner) {
                        this.loadMembers();
                        this.loadInvitations();
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
         * Load team members
         * @returns {void}
         */
        loadMembers() {
            this.$root.getSocket().emit("getTeamMembers", (res) => {
                if (res.ok) {
                    this.members = res.members;
                } else {
                    this.$root.toastError(res.msg);
                }
                this.loading = false;
            });
        },

        /**
         * Load pending invitations
         * @returns {void}
         */
        loadInvitations() {
            this.$root.getSocket().emit("getPendingInvitations", (res) => {
                if (res.ok) {
                    this.invitations = res.invitations;
                }
            });
        },

        /**
         * Get CSS class for role
         * @param {string} role User role
         * @returns {string} CSS class
         */
        getRoleClass(role) {
            return role === "owner" ? "owner" : "";
        },

        /**
         * Capitalize role name
         * @param {string} role Role name
         * @returns {string} Capitalized role
         */
        capitalizeRole(role) {
            return role.charAt(0).toUpperCase() + role.slice(1);
        },

        /**
         * Format date for display
         * @param {string} dateStr ISO date string
         * @returns {string} Formatted date
         */
        formatDate(dateStr) {
            if (!dateStr) {
                return "-";
            }
            const date = new Date(dateStr);
            return date.toLocaleDateString();
        },

        /**
         * Show remove member confirmation
         * @param {object} member Member to remove
         * @returns {void}
         */
        confirmRemoveMember(member) {
            this.selectedMember = member;
            this.$refs.confirmRemove.show();
        },

        /**
         * Remove member from team
         * @returns {void}
         */
        removeMember() {
            if (!this.selectedMember) {
                return;
            }

            this.$root.getSocket().emit("removeTeamMember", this.selectedMember.id, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadMembers();
                }
            });
        },

        /**
         * Show cancel invitation confirmation
         * @param {object} invite Invitation to cancel
         * @returns {void}
         */
        confirmCancelInvitation(invite) {
            this.selectedInvitation = invite;
            this.$refs.confirmCancel.show();
        },

        /**
         * Cancel invitation
         * @returns {void}
         */
        cancelInvitation() {
            if (!this.selectedInvitation) {
                return;
            }

            this.$root.getSocket().emit("cancelInvitation", this.selectedInvitation.id, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadInvitations();
                }
            });
        },

        /**
         * Open role change dialog
         * @param {object} member Member to change role
         * @returns {void}
         */
        openRoleDialog(member) {
            this.selectedMember = member;
            this.newRole = member.role;

            if (!this.roleModal) {
                this.roleModal = new Modal(this.$refs.roleModal);
            }
            this.roleModal.show();
        },

        /**
         * Update member role
         * @returns {void}
         */
        updateRole() {
            if (!this.selectedMember) {
                return;
            }

            this.$root.getSocket().emit("updateMemberRole", {
                userId: this.selectedMember.id,
                role: this.newRole,
            }, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.loadMembers();
                    this.roleModal.hide();
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../assets/vars.scss";

.add-btn {
    padding-top: 20px;
    padding-bottom: 20px;
}

.item {
    display: flex;
    align-items: center;
    gap: 10px;
    border-radius: 10px;
    transition: all ease-in-out 0.15s;
    justify-content: space-between;
    padding: 10px;
    min-height: 70px;
    margin-bottom: 5px;

    &:hover {
        background-color: $highlight-white;
    }

    &.owner {
        .avatar {
            background-color: $primary;
        }
    }

    &.pending {
        opacity: 0.8;

        .avatar {
            background-color: $warning;
        }
    }

    .left-part {
        display: flex;
        gap: 12px;
        align-items: center;

        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: #6c757d;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;

            &.pending {
                background-color: $warning;
            }
        }

        .info {
            .title {
                font-weight: bold;
                font-size: 16px;
            }

            .email {
                font-size: 13px;
            }
        }
    }

    .buttons {
        display: flex;
        gap: 8px;
    }
}

.role-badge {
    display: inline-block;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    margin-top: 4px;

    &.role-owner {
        background-color: $primary;
        color: white;
    }

    &.role-admin {
        background-color: #0dcaf0;
        color: white;
    }

    &.role-member {
        background-color: #6c757d;
        color: white;
    }
}

.date {
    margin-top: 5px;
    display: block;
    font-size: 12px;
    color: $dark-font-color;
}

.dark {
    .item {
        &:hover {
            background-color: $dark-bg2;
        }
    }
}
</style>
