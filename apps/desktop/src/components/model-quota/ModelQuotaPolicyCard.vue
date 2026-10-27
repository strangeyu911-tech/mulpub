<template>
  <section v-if="visible" class="model-quota-card" data-testid="model-quota-policy-card">
    <div class="quota-head">
      <div>
        <h3 class="quota-title">{{ t('modelQuota.title') }}</h3>
        <p class="quota-subtitle">{{ t('modelQuota.subtitle') }}</p>
      </div>
      <div class="quota-status" :class="official.available ? 'is-ok' : 'is-off'" data-testid="model-quota-official-status">
        <span class="status-dot" />
        <span>{{ officialLabel }}</span>
      </div>
    </div>

    <div class="quota-options" role="radiogroup" :aria-label="t('modelQuota.policyLabel')">
      <label
        v-for="option in options"
        :key="option.value"
        class="quota-option"
        :class="{ 'is-disabled': isOptionDisabled(option) }"
      >
        <input
          v-model="policy"
          type="radio"
          :value="option.value"
          :disabled="isOptionDisabled(option)"
          @change="markDirty"
        >
        <span class="option-copy">
          <span class="option-label">{{ t(option.labelKey) }}</span>
          <span class="option-hint">{{ t(option.hintKey) }}</span>
          <span v-if="isOptionDisabled(option)" class="option-disabled-hint">{{ t('modelQuota.officialDisabledHint') }}</span>
        </span>
      </label>
    </div>

    <div class="quota-cap-row">
      <label class="cap-label" for="model-quota-cap">{{ t('modelQuota.capLabel') }}</label>
      <input
        id="model-quota-cap"
        v-model.number="cap"
        class="cap-input"
        type="number"
        min="1"
        max="100000"
        step="1"
        :disabled="saving || loading"
        @input="markDirty"
      >
      <span class="cap-hint">{{ t('modelQuota.capHint') }}</span>
    </div>

    <div class="quota-actions">
      <button class="cohere-btn-primary" type="button" :disabled="saving || loading" @click="save">
        {{ saving ? t('modelQuota.saving') : t('modelQuota.save') }}
      </button>
      <span v-if="saved" class="save-ok" data-testid="model-quota-saved">{{ t('modelQuota.saved') }}</span>
      <span v-if="error" class="save-error" role="alert">{{ error }}</span>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { modelQuotaGetPolicy, modelQuotaSetPolicy } from '@/api/model-quota'

const { t, te } = useI18n()

const loading = ref(true)
const saving = ref(false)
const policy = ref('ask')
const cap = ref(500)
const official = ref({ available: false, reason: 'not_configured', balance: null, currency: 'credit' })
const saved = ref(false)
const error = ref('')

const options = [
  { value: 'ask', labelKey: 'modelQuota.policyAsk', hintKey: 'modelQuota.policyAskHint' },
  { value: 'official', labelKey: 'modelQuota.policyOfficial', hintKey: 'modelQuota.policyOfficialHint' },
  { value: 'byok', labelKey: 'modelQuota.policyByok', hintKey: 'modelQuota.policyByokHint' },
]

// P2 前 official.available 恒为 false；默认 ask 时整张卡片隐藏，避免空承诺。
// 用户已显式设置过 byok/official，或官方已接入时才展示。
// 读取失败时 error 非空也必须可见，否则用户只看到一张消失的卡片、不知道发生了什么。
const visible = computed(() => Boolean(official.value.available) || policy.value !== 'ask' || Boolean(error.value))

const officialLabel = computed(() => {
  if (official.value.available) {
    return t('modelQuota.officialAvailable', { balance: official.value.balance ?? '—' })
  }
  const key = `modelQuota.officialReason.${official.value.reason || 'not_configured'}`
  return te(key) ? t(key) : t('modelQuota.officialUnavailable')
})

function isOptionDisabled (option) {
  return option.value === 'official' && !official.value.available
}

function markDirty () {
  saved.value = false
  error.value = ''
}

async function load () {
  loading.value = true
  try {
    const res = await modelQuotaGetPolicy()
    if (res && res.code === 0 && res.data) {
      policy.value = res.data.policy || 'ask'
      cap.value = res.data.cap ?? 500
      official.value = res.data.official || official.value
    } else if (res && res.code !== 0) {
      // 旧 preload / 单测 / 视觉基线没有该桥接时不制造可见错误卡片；
      // 真实主进程错误（db locked 等）仍显示错误。
      if (res.message !== 'electronAPI not available') error.value = t('modelQuota.loadFailed')
    }
  } catch (_) {
    error.value = t('modelQuota.loadFailed')
  } finally {
    loading.value = false
  }
}

async function save () {
  const value = Number(cap.value)
  if (!Number.isInteger(value) || value < 1 || value > 100000) {
    error.value = t('modelQuota.invalidCap')
    return
  }
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    const res = await modelQuotaSetPolicy({ policy: policy.value, cap: value })
    if (!res || res.code !== 0) {
      error.value = (res && res.message) || t('modelQuota.saveFailed')
      return
    }
    policy.value = res.data.policy
    cap.value = res.data.cap
    saved.value = true
  } catch (_) {
    error.value = t('modelQuota.saveFailed')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.model-quota-card {
  margin: 0 0 var(--space-lg);
  padding: var(--space-lg);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-lg, 12px);
  background: var(--card-bg, #fff);
}
.quota-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.quota-title {
  margin: 0 0 4px;
  font-size: var(--font-size-md);
  font-weight: 600;
}
.quota-subtitle {
  margin: 0;
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.quota-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  background: #f3f4f6;
  color: #4b5563;
}
.quota-status.is-ok {
  background: #ecfdf5;
  color: #047857;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.quota-options {
  display: grid;
  gap: 8px;
  margin-bottom: var(--space-md);
}
.quota-option {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
}
.quota-option.is-disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.option-copy {
  display: grid;
  gap: 2px;
}
.option-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.option-hint,
.option-disabled-hint {
  font-size: var(--font-size-xs);
  color: var(--text-secondary, #6b7280);
  line-height: 1.45;
}
.quota-cap-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: var(--space-md);
}
.cap-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.cap-input {
  width: 120px;
  padding: 6px 8px;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: var(--radius-sm, 6px);
  background: var(--input-bg, #fff);
}
.cap-hint {
  width: 100%;
  color: var(--text-secondary, #6b7280);
  font-size: var(--font-size-xs);
}
.quota-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.save-ok {
  color: #047857;
  font-size: var(--font-size-sm);
}
.save-error {
  color: #b91c1c;
  font-size: var(--font-size-sm);
}
</style>
