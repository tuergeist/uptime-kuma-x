<template>
    <div>
        <div class="my-4">
            <label for="keepDataPeriodDays" class="form-label">
                {{
                    $t("clearDataOlderThan", [
                        settings.keepDataPeriodDays,
                    ])
                }}
                {{ $t("infiniteRetention") }}
            </label>
            <input
                id="keepDataPeriodDays"
                v-model="settings.keepDataPeriodDays"
                type="number"
                class="form-control"
                required
                min="0"
                step="1"
            />
            <div v-if="settings.keepDataPeriodDays < 0" class="form-text">
                {{ $t("dataRetentionTimeError") }}
            </div>
        </div>
        <div class="my-4">
            <button class="btn btn-primary" type="button" @click="saveSettings()">
                {{ $t("Save") }}
            </button>
        </div>
        <div class="my-4">
            <button
                id="clearAllStats-btn"
                class="btn btn-outline-danger me-2 mb-2"
                @click="confirmClearStatistics"
            >
                {{ $t("Clear all statistics") }}
            </button>
        </div>
        <Confirm
            ref="confirmClearStatistics"
            btn-style="btn-danger"
            :yes-text="$t('Yes')"
            :no-text="$t('No')"
            @yes="clearStatistics"
        >
            {{ $t("confirmClearStatisticsMsg") }}
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../../components/Confirm.vue";

export default {
    components: {
        Confirm,
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
        },
    },

    methods: {
        /**
         * Show the dialog to confirm clearing stats
         * @returns {void}
         */
        confirmClearStatistics() {
            this.$refs.confirmClearStatistics.show();
        },

        /**
         * Send the request to clear stats
         * @returns {void}
         */
        clearStatistics() {
            this.$root.clearStatistics((res) => {
                if (res.ok) {
                    this.$router.go();
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
    },
};
</script>
