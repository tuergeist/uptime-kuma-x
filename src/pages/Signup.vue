<template>
    <div class="form-container">
        <div class="form">
            <form @submit.prevent="submit">
                <div>
                    <object width="64" height="64" data="/icon.svg" />
                    <div style="font-size: 28px; font-weight: bold; margin-top: 5px;">
                        Uptime Kuma
                    </div>
                </div>

                <p class="mt-3">
                    {{ $t("Create your account") }}
                </p>

                <div class="form-floating">
                    <select id="language" v-model="$root.language" class="form-select">
                        <option v-for="(lang, i) in $i18n.availableLocales" :key="`Lang${i}`" :value="lang">
                            {{ $i18n.messages[lang].languageName }}
                        </option>
                    </select>
                    <label for="language" class="form-label">{{ $t("Language") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input
                        id="tenantName"
                        v-model="tenantName"
                        type="text"
                        class="form-control"
                        :placeholder="$t('Organization Name')"
                        required
                    >
                    <label for="tenantName">{{ $t("Organization Name") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input
                        id="username"
                        v-model="username"
                        type="text"
                        class="form-control"
                        :placeholder="$t('Username')"
                        required
                        minlength="3"
                    >
                    <label for="username">{{ $t("Username") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input
                        id="email"
                        v-model="email"
                        type="email"
                        class="form-control"
                        :placeholder="$t('Email')"
                        required
                    >
                    <label for="email">{{ $t("Email") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input
                        id="password"
                        v-model="password"
                        type="password"
                        class="form-control"
                        :placeholder="$t('Password')"
                        required
                        minlength="6"
                    >
                    <label for="password">{{ $t("Password") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input
                        id="repeatPassword"
                        v-model="repeatPassword"
                        type="password"
                        class="form-control"
                        :placeholder="$t('Repeat Password')"
                        required
                    >
                    <label for="repeatPassword">{{ $t("Repeat Password") }}</label>
                </div>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    <span v-if="processing" class="spinner-border spinner-border-sm me-1"></span>
                    {{ $t("Create Account") }}
                </button>

                <p class="mt-3 text-muted">
                    {{ $t("Already have an account?") }}
                    <router-link to="/dashboard">{{ $t("Login") }}</router-link>
                </p>
            </form>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            processing: false,
            tenantName: "",
            username: "",
            email: "",
            password: "",
            repeatPassword: "",
        };
    },
    mounted() {
        // If already logged in, redirect to dashboard
        if (this.$root.loggedIn) {
            this.$router.push("/dashboard");
        }
    },
    methods: {
        /**
         * Submit registration form
         * @returns {void}
         */
        submit() {
            this.processing = true;

            // Validate passwords match
            if (this.password !== this.repeatPassword) {
                this.$root.toastError("PasswordsDoNotMatch");
                this.processing = false;
                return;
            }

            // Validate password length
            if (this.password.length < 6) {
                this.$root.toastError("Password must be at least 6 characters");
                this.processing = false;
                return;
            }

            // Validate username length
            if (this.username.trim().length < 3) {
                this.$root.toastError("Username must be at least 3 characters");
                this.processing = false;
                return;
            }

            this.$root.getSocket().emit("register", {
                tenantName: this.tenantName.trim(),
                username: this.username.trim(),
                email: this.email.trim(),
                password: this.password,
            }, (res) => {
                this.processing = false;

                if (res.ok) {
                    // Store token and log in
                    this.$root.storage().token = res.token;
                    this.$root.socket.token = res.token;
                    this.$root.loggedIn = true;
                    this.$root.username = this.username;

                    this.$root.toastSuccess("Registration successful! Welcome to Uptime Kuma.");

                    // Refresh the page to trigger full login flow
                    setTimeout(() => {
                        window.location.href = "/dashboard";
                    }, 500);
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.form-container {
    display: flex;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 40px;
    min-height: 100vh;
}

.form-floating {
    > .form-select {
        padding-left: 1.3rem;
        padding-top: 1.525rem;
        line-height: 1.35;

        ~ label {
            padding-left: 1.3rem;
        }
    }

    > label {
        padding-left: 1.3rem;
    }

    > .form-control {
        padding-left: 1.3rem;
    }
}

.form {
    width: 100%;
    max-width: 400px;
    padding: 15px;
    margin: auto;
    text-align: center;
}
</style>
