<template>
    <div>
        <div v-if="settingsLoaded" class="my-4">
            <!-- Change Password -->
            <p>
                {{ $t("Current User") }}: <strong>{{ $root.username }}</strong>
                <button id="logout-btn" class="btn btn-danger ms-4 me-2 mb-2" @click="$root.logout">{{ $t("Logout") }}</button>
            </p>

            <h5 class="my-4 settings-subheading">{{ $t("Change Password") }}</h5>
            <form class="mb-3" @submit.prevent="savePassword">
                <div class="mb-3">
                    <label for="current-password" class="form-label">
                        {{ $t("Current Password") }}
                    </label>
                    <input
                        id="current-password"
                        v-model="password.currentPassword"
                        type="password"
                        class="form-control"
                        autocomplete="current-password"
                        required
                    />
                </div>

                <div class="mb-3">
                    <label for="new-password" class="form-label">
                        {{ $t("New Password") }}
                    </label>
                    <input
                        id="new-password"
                        v-model="password.newPassword"
                        type="password"
                        class="form-control"
                        autocomplete="new-password"
                        required
                    />
                </div>

                <div class="mb-3">
                    <label for="repeat-new-password" class="form-label">
                        {{ $t("Repeat New Password") }}
                    </label>
                    <input
                        id="repeat-new-password"
                        v-model="password.repeatNewPassword"
                        type="password"
                        class="form-control"
                        :class="{ 'is-invalid': invalidPassword }"
                        autocomplete="new-password"
                        required
                    />
                    <div class="invalid-feedback">
                        {{ $t("passwordNotMatchMsg") }}
                    </div>
                </div>

                <div>
                    <button class="btn btn-primary" type="submit">
                        {{ $t("Update Password") }}
                    </button>
                </div>
            </form>

            <div class="mt-5 mb-3">
                <h5 class="my-4 settings-subheading">
                    {{ $t("Two Factor Authentication") }}
                </h5>
                <div class="mb-4">
                    <button
                        class="btn btn-primary me-2"
                        type="button"
                        @click="$refs.TwoFADialog.show()"
                    >
                        {{ $t("2FA Settings") }}
                    </button>
                </div>
            </div>

        </div>

        <TwoFADialog ref="TwoFADialog" />
    </div>
</template>

<script>
import TwoFADialog from "../../components/TwoFADialog.vue";

export default {
    components: {
        TwoFADialog
    },

    data() {
        return {
            invalidPassword: false,
            password: {
                currentPassword: "",
                newPassword: "",
                repeatNewPassword: "",
            }
        };
    },

    computed: {
        settings() {
            return this.$parent.$parent.$parent.settings;
        },
        saveSettings() {
            return this.$parent.$parent.$parent.saveSettings;
        },
        settingsLoaded() {
            return this.$parent.$parent.$parent.settingsLoaded;
        }
    },

    watch: {
        "password.repeatNewPassword"() {
            this.invalidPassword = false;
        },
    },

    methods: {
        /**
         * Check new passwords match before saving them
         * @returns {void}
         */
        savePassword() {
            if (this.password.newPassword !== this.password.repeatNewPassword) {
                this.invalidPassword = true;
            } else {
                this.$root
                    .getSocket()
                    .emit("changePassword", this.password, (res) => {
                        this.$root.toastRes(res);
                        if (res.ok) {
                            this.password.currentPassword = "";
                            this.password.newPassword = "";
                            this.password.repeatNewPassword = "";

                            // Update token of the current session
                            if (res.token) {
                                this.$root.storage().token = res.token;
                                this.$root.socket.token = res.token;
                            }
                        }
                    });
            }
        },

    },
};
</script>
