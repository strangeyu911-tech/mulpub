<template>
  <Teleport to="body">
    <div v-if="request" class="mq-overlay" data-testid="model-quota-overlay">
      <button
        class="mq-backdrop"
        type="button"
        :aria-label="t('modelQuota.dialog.close')"
        :disabled="deciding"
        @click="onCancel"
      />
      <div
        ref="dialogEl"
        class="mq-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mq-dialog-title"
        tabindex="-1"
        @keydown.esc="onCancel"
      >
        <div class="mq-head">
          <div>
            <h2 id="mq-dialog-title" class="mq-title">{{ t('modelQuota.dialog.title') }}</h2>
            <p class="mq-subtitle">{{ t('modelQuota.dialog.description', { provider: providerName, model: modelName }) }}</p>
          </div>
          <button class="mq-close" type="button" :aria-label="t('modelQuota.dialog.close')" :disabled="deciding" @click="onCancel">×</button>
        </div>

        <div class="mq-facts">
          <div class="mq-fact">
            <span class="mq-fact-label">{{ t('modelQuota.dialog.failureLabel') }}</span>
            <span class="mq-fact-value">{{ failureLabel }}</span>
          </div>
          <div class="mq-fact">
            <span class="mq-fact-label">{{ t('modelQuota.dialog.estimateLabel') }}</span>
            <span class="mq-fact-value">{{ estimateLabel }}</span>
          </div>
          <div class="mq-fact">
            <span class="mq-fact-label">{{ t('modelQuota.dialog.balanceLabel') }}</span>
            <span class="mq-fact-value">{{ balanceLabel }}</span>
          </div>
          <div class="mq-fact">
            <span class="mq-fact-label">{{ t('modelQuota.dialog.capLabel') }}</span>
            <span class="mq-fact-value">{{ request.cap ?? '—' }}</span>
          </div>
        </div>

        <p v-if="!officialAvailable" class="mq-warn" data-testid="model-quota-disabled-reason">{{ disabledReason }}</p>

        <label v-if="canRemember" class="mq-remember">
          <input v-model="remember" type="checkbox" :disabled="deciding">
          <span>{{ t('modelQuota.dialog.remember') }}</span>
        </label>
        <p v-if="canRemember" class="mq-remember-hint">{{ t('modelQuota.dialog.rememberHint') }}</p>

        <p v-if="failed" class="mq-error" role="alert">{{ t('modelQuota.dialog.decideFailed') }}</p>

        <div class="mq-actions">
          <button
            class="cohere-btn-secondary"
            type="button"
            :disabled="deciding"
            data-testid="model-quota-cancel"
            @click="onCancel"
          >
            {{ t('modelQuota.dialog.cancel') }}
          </button>
          <button
            class="cohere-btn-secondary"
            type="button"
            :disabled="deciding"
            data-testid="model-quota-settings"
            @click="onSettings"
          >
            {{ t('modelQuota.dialog.settings') }}
          </button>
          <button
            class="cohere-btn-primary"
            type="button"
            :disabled="!officialAvailable || deciding"
            data-testid="model-quota-official"
            @click="onOfficial"
          >
            {{ deciding ? t('modelQuota.dialog.deciding') : t('modelQuota.dialog.official') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModelQuotaFallback } from '@/composables/useModelQuotaFallback'
import { stateLabelKey } from '@/views/model-quota-labels'

const emit = defineEmits(['settings'])
const { t, te } = useI18n()
const { currentRequest: request, deciding, failed, useOfficial, goSettings, cancel } = useModelQuotaFallback()
const remember = ref(false)
const dialogEl = ref(null)

watch(request, async (value) => {
  remember.value = false
  if (value) {
    await nextTick()
    dialogEl.value?.focus()
  }
})

const providerName = computed(() => request.value?.providerName || request.value?.providerId || '—')
const modelName = computed(() => request.value?.model || t('modelQuota.dialog.defaultModel'))
const officialAvailable = computed(() => Boolean(request.value?.official?.available))
const canRemember = computed(() => Boolean(request.value))

const failureLabel = computed(() => t(stateLabelKey(request.value?.failure?.state)))

const estimateLabel = computed(() => {
  const credits = request.value?.estimate?.credits
  return credits == null ? t('modelQuota.dialog.unknown') : t('modelQuota.dialog.credits', { credits })
})

const balanceLabel = computed(() => {
  const balance = request.value?.official?.balance
  return balance == null ? t('modelQuota.dialog.unknown') : t('modelQuota.dialog.credits', { credits: balance })
})

const disabledReason = computed(() => {
  if (officialAvailable.value) return ''
  const reason = request.value?.official?.reason || 'not_configured'
  const key = `modelQuota.officialReason.${reason}`
  return te(key) ? t(key) : t('modelQuota.officialDisabledHint')
})

async function onOfficial () {
  await useOfficial(remember.value)
}

async function onSettings () {
  const ok = await goSettings(remember.value)
  if (ok) emit('settings')
}

async function onCancel () {
  await cancel()
}
</script>

<style scoped>
.mq-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 3000);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}
.mq-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: default;
}
.mq-dialog {
  position: relative;
  z-index: 1;
  width: min(560px, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 20px;
  border-radius: 12px;
  background: var(--card-bg, #fff);
  color: var(--text-primary, #111827);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  outline: none;
}
.mq-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.mq-title {
  margin: 0 0 6px;
  font-size: var(--font-size-md);
  font-weight: 600;
}
.mq-subtitle {
  margin: 0;
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.mq-close {
  border: 0;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-xl);
  line-height: 1;
  cursor: pointer;
}
.mq-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0;
}
.mq-fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
}
.mq-fact-label {
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-xs);
}
.mq-fact-value {
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.mq-warn {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  font-size: var(--font-size-xs);
  line-height: 1.5;
}
.mq-remember {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-xs);
}
.mq-remember-hint {
  margin: 0 0 12px;
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-xs);
  line-height: 1.45;
}
.mq-error {
  margin: 0 0 12px;
  color: #b91c1c;
  font-size: var(--font-size-xs);
}
.mq-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
[data-theme="dark"] .mq-dialog {
  background: var(--card-bg, #1f2937);
  color: var(--text-primary, #f9fafb);
}
[data-theme="dark"] .mq-warn {
  background: #431407;
  color: #fdba74;
}
</style>

