<template>
  <section v-if="officialEntries.length > 0" class="model-quota-task-banner" data-testid="model-quota-task-banner">
    <div class="quota-task-copy">
      <strong class="quota-task-title">{{ t('modelQuota.taskBanner.title') }}</strong>
      <p class="quota-task-desc">{{ t('modelQuota.taskBanner.description', { capabilities: capabilityText }) }}</p>
    </div>
    <div class="quota-task-actions">
      <button
        type="button"
        class="cohere-btn-secondary"
        data-testid="model-quota-switch-back"
        :disabled="switching"
        @click="switchBack"
      >
        {{ switching ? t('modelQuota.taskBanner.switching') : t('modelQuota.taskBanner.switchBack') }}
      </button>
      <span v-if="switched" class="quota-task-ok" data-testid="model-quota-switched">{{ t('modelQuota.taskBanner.switched') }}</span>
      <span v-if="error" class="quota-task-error" role="alert">{{ error }}</span>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { modelQuotaSwitchBack } from '@/api/model-quota'

const props = defineProps({
  runId: { type: String, default: '' },
  overrides: { type: Object, default: null },
})

const emit = defineEmits(['switched'])
const { t, te } = useI18n()
const switching = ref(false)
const switched = ref(false)
const error = ref('')

const officialEntries = computed(() => {
  const source = props.overrides && typeof props.overrides === 'object' && !Array.isArray(props.overrides)
    ? props.overrides
    : {}
  return Object.entries(source).filter(([, value]) => value && value.source === 'official')
})

const capabilityText = computed(() => officialEntries.value
  .map(([capability]) => {
    const key = `modelQuota.capability.${capability}`
    return te(key) ? t(key) : t('modelQuota.taskBanner.capabilityUnknown')
  })
  .join('、'))

async function switchBack () {
  if (!props.runId || switching.value || officialEntries.value.length === 0) return
  switching.value = true
  switched.value = false
  error.value = ''
  try {
    let switchedAny = false
    let failed = false
    for (const [capability] of officialEntries.value) {
      const result = await modelQuotaSwitchBack({ runId: props.runId, capability })
      if (result && result.code === 0) switchedAny = true
      else failed = true
    }
    if (switchedAny) emit('switched')
    if (failed) error.value = t('modelQuota.taskBanner.failed')
    else switched.value = true
  } catch (_) {
    error.value = t('modelQuota.taskBanner.failed')
  } finally {
    switching.value = false
  }
}
</script>

<style scoped>
.model-quota-task-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid var(--color-warning-border, #f5c26b);
  border-radius: 10px;
  background: var(--color-warning-bg, #fffbeb);
  color: var(--text-primary, #111827);
}
.quota-task-title { display: block; font-size: var(--font-size-sm); }
.quota-task-desc { margin: 4px 0 0; color: var(--text-secondary, #6b7280); font-size: var(--font-size-xs); }
.quota-task-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.quota-task-ok { color: var(--color-success, #15803d); font-size: var(--font-size-xs); }
.quota-task-error { color: var(--color-danger, #b91c1c); font-size: var(--font-size-xs); }
</style>
