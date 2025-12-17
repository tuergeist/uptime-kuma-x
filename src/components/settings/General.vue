<template>
    <div>
        <form class="my-4" autocomplete="off" @submit.prevent="saveGeneral">
            <!-- Client side Timezone -->
            <div class="mb-4">
                <label for="timezone" class="form-label">
                    {{ $t("Display Timezone") }}
                </label>
                <select id="timezone" v-model="$root.userTimezone" class="form-select">
                    <option value="auto">
                        {{ $t("Auto") }}: {{ guessTimezone }}
                    </option>
                    <option
                        v-for="(timezone, index) in timezoneList"
                        :key="index"
                        :value="timezone.value"
                    >
                        {{ timezone.name }}
                    </option>
                </select>
            </div>

            <!-- Search Engine -->
            <div class="mb-4">
                <label class="form-label">
                    {{ $t("Search Engine Visibility") }}
                </label>

                <div class="form-check">
                    <input
                        id="searchEngineIndexYes"
                        v-model="settings.searchEngineIndex"
                        class="form-check-input"
                        type="radio"
                        name="searchEngineIndex"
                        :value="true"
                        required
                    />
                    <label class="form-check-label" for="searchEngineIndexYes">
                        {{ $t("Allow indexing") }}
                    </label>
                </div>
                <div class="form-check">
                    <input
                        id="searchEngineIndexNo"
                        v-model="settings.searchEngineIndex"
                        class="form-check-input"
                        type="radio"
                        name="searchEngineIndex"
                        :value="false"
                        required
                    />
                    <label class="form-check-label" for="searchEngineIndexNo">
                        {{ $t("Discourage search engines from indexing site") }}
                    </label>
                </div>
            </div>

            <!-- Save Button -->
            <div>
                <button class="btn btn-primary" type="submit">
                    {{ $t("Save") }}
                </button>
            </div>
        </form>
    </div>
</template>

<script>
import dayjs from "dayjs";
import { timezoneList } from "../../util-frontend";

export default {

    data() {
        return {
            timezoneList: timezoneList(),
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
        },
        guessTimezone() {
            return dayjs.tz.guess();
        }
    },

    methods: {
        /**
         * Save the settings
         * @returns {void}
         */
        saveGeneral() {
            localStorage.timezone = this.$root.userTimezone;
            this.saveSettings();
        },
    },
};
</script>

