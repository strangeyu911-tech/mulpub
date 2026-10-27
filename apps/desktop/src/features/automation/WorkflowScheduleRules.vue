<template>
  <div class="wf-schedule-rules">
    <div class="wf-row">
      <label class="wf-label">{{ t('automation.wfTimezone') }}</label>
      <select v-model="draft.timezone" class="wf-input" data-testid="wf-schedule-timezone" @change="emitChange">
        <option v-for="tz in timezoneOptions" :key="tz" :value="tz">{{ tz }}</option>
      </select>
    </div>
    <div class="wf-row">
      <label class="wf-label">{{ t('automation.wfWeekdays') }}</label>
      <div class="wf-chips">
        <label v-for="day in weekdays" :key="'wd-' + day" class="wf-chip" :class="{ 'wf-chip--on': draft.weekdays.includes(day) }">
          <input type="checkbox" :checked="draft.weekdays.includes(day)" @change="toggleWeekday(day)" />
          {{ t('automation.wfWeekdayShort.' + day) }}
        </label>
      </div>
    </div>
    <div class="wf-row">
      <label class="wf-label">{{ t('automation.wfQuietHours') }}</label>
      <input v-model="draft.quietHours.start" type="time" class="wf-input wf-input--sm" data-testid="wf-quiet-start" @change="emitChange" />
      <span>—</span>
      <input v-model="draft.quietHours.end" type="time" class="wf-input wf-input--sm" data-testid="wf-quiet-end" @change="emitChange" />
      <span class="wf-hint">{{ t('automation.wfQuietHoursHint') }}</span>
    </div>
    <div class="wf-hint">{{ t('automation.wfScheduleRulesHint') }}</div>
  </div>
</template>

<script setup>
import { reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  modelValue: { type: Object, required: true },
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()
const weekdays = [1, 2, 3, 4, 5, 6, 7]
const timezoneOptions = ['Asia/Shanghai', 'Asia/Tokyo', 'UTC', 'Europe/London', 'America/New_York']

const draft = reactive(clone(props.modelValue))
watch(() => props.modelValue, (value) => {
  const next = clone(value)
  Object.assign(draft, next)
  draft.quietHours = next.quietHours
  draft.weekdays = next.weekdays
}, { deep: true })

function clone (value) {
  return {
    ...value,
    weekdays: Array.isArray(value.weekdays) ? [...value.weekdays] : [],
    quietHours: value.quietHours && typeof value.quietHours === 'object'
      ? { ...value.quietHours }
      : { start: '23:00', end: '07:00' },
  }
}

function emitChange () {
  emit('update:modelValue', clone(draft))
}

function toggleWeekday (day) {
  const idx = draft.weekdays.indexOf(day)
  if (idx >= 0) draft.weekdays.splice(idx, 1)
  else draft.weekdays.push(day)
  draft.weekdays.sort((a, b) => a - b)
  emitChange()
}
</script>
