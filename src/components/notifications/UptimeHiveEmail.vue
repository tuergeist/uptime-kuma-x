<template>
    <div>
        <div class="alert alert-info mb-3">
            <font-awesome-icon icon="envelope" class="me-2" />
            {{ $t("uptimehiveEmailDescription") }}
        </div>

        <div class="mb-3">
            <label for="to-email" class="form-label">{{ $t("To Email") }} <span class="text-danger">*</span></label>
            <input
                id="to-email"
                v-model="$parent.notification.uptimehiveEmailTo"
                type="email"
                class="form-control"
                autocomplete="false"
                placeholder="user@example.com"
                :required="!hasRecipient"
            >
            <div class="form-text">{{ $t("uptimehiveEmailToHint") }}</div>
        </div>

        <div class="mb-3">
            <label for="to-cc" class="form-label">{{ $t("smtpCC") }}</label>
            <input
                id="to-cc"
                v-model="$parent.notification.uptimehiveEmailCC"
                type="text"
                class="form-control"
                autocomplete="false"
                placeholder="cc1@example.com, cc2@example.com"
            >
        </div>

        <div class="mb-3">
            <label for="to-bcc" class="form-label">{{ $t("smtpBCC") }}</label>
            <input
                id="to-bcc"
                v-model="$parent.notification.uptimehiveEmailBCC"
                type="text"
                class="form-control"
                autocomplete="false"
                placeholder="bcc@example.com"
            >
        </div>

        <ToggleSection :heading="$t('Customize Email Template')">
            <div class="mb-3">
                <label for="subject-email" class="form-label">{{ $t("emailCustomSubject") }}</label>
                <TemplatedInput
                    id="subject-email"
                    v-model="$parent.notification.customSubject"
                    :required="false"
                    :placeholder="defaultSubject"
                ></TemplatedInput>
                <div class="form-text">{{ $t("leave blank for default subject") }}</div>
            </div>

            <div class="mb-3">
                <label for="body-email" class="form-label">{{ $t("emailCustomBody") }}</label>
                <TemplatedTextarea
                    id="body-email"
                    v-model="$parent.notification.customBody"
                    :required="false"
                    :placeholder="$t('uptimehiveEmailBodyPlaceholder')"
                ></TemplatedTextarea>
                <div class="form-text">{{ $t("leave blank for default body") }}</div>
            </div>

            <div class="mb-3">
                <div class="form-check">
                    <input
                        id="use-html-body"
                        v-model="$parent.notification.htmlBody"
                        class="form-check-input"
                        type="checkbox"
                        value=""
                    >
                    <label class="form-check-label" for="use-html-body">
                        {{ $t("Use HTML for custom E-mail body") }}
                    </label>
                </div>
            </div>
        </ToggleSection>
    </div>
</template>

<script>
import TemplatedInput from "../TemplatedInput.vue";
import TemplatedTextarea from "../TemplatedTextarea.vue";
import ToggleSection from "../ToggleSection.vue";

export default {
    components: {
        TemplatedInput,
        TemplatedTextarea,
        ToggleSection,
    },
    data() {
        return {
            defaultSubject: "{{STATUS}} {{NAME}}",
        };
    },
    computed: {
        /**
         * Check if at least one recipient is specified
         * @returns {boolean} True if any recipient field is filled
         */
        hasRecipient() {
            return !!(
                this.$parent.notification.uptimehiveEmailTo ||
                this.$parent.notification.uptimehiveEmailCC ||
                this.$parent.notification.uptimehiveEmailBCC
            );
        }
    },
    mounted() {
        // Default HTML body to true
        if (typeof this.$parent.notification.htmlBody === "undefined") {
            this.$parent.notification.htmlBody = true;
        }
    }
};
</script>
