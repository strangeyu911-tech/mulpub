<template>
  <div v-if="modelValue" class="atd-mask">
    <div class="atd-dialog" data-testid="automation-dialog">
      <div class="atd-title">{{ task ? t('automation.editTitle') : t('automation.createTitle') }}</div>

      <div class="atd-field">
        <label class="atd-label">{{ t('automation.fieldName') }}</label>
        <input v-model="form.name" class="atd-input" :placeholder="t('automation.namePlaceholder')" />
      </div>

      <div class="atd-field">
        <label class="atd-label">{{ t('automation.wfActionType') }}</label>
        <label class="atd-check">
          <input v-model="form.actionType" type="radio" value="compositeWorkflow" data-testid="wf-action-composite" />
          {{ t('automation.wfActionComposite') }}
        </label>
        <label class="atd-check">
          <input v-model="form.actionType" type="radio" value="fullAutoPipeline" data-testid="wf-action-legacy" />
          {{ t('automation.wfActionLegacy') }}
        </label>
        <div class="atd-sub">{{ t('automation.wfActionHint') }}</div>
      </div>

      <div v-if="form.actionType === 'compositeWorkflow'" class="atd-field">
        <label class="atd-label">{{ t('automation.wfTemplate') }}</label>
        <div class="atd-row">
          <select v-model="templateId" class="atd-input" data-testid="wf-template-select">
            <option value="">{{ t('automation.wfTemplatePlaceholder') }}</option>
            <optgroup :label="t('automation.wfTemplateBuiltin')">
              <option v-for="tpl in templates.builtin" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
            </optgroup>
            <optgroup :label="t('automation.wfTemplateCustom')">
              <option v-for="tpl in templates.custom" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
            </optgroup>
          </select>
          <button class="cohere-btn-text" data-testid="wf-template-apply" @click="applyTemplate">
            {{ t('automation.wfTemplateApply') }}
          </button>
        </div>
        <div class="atd-row">
          <input v-model="templateName" class="atd-input" :placeholder="t('automation.wfTemplateNamePlaceholder')" />
          <button class="cohere-btn-text" data-testid="wf-template-save" @click="saveAsTemplate">
            {{ t('automation.wfTemplateSave') }}
          </button>
        </div>
        <div class="atd-sub">{{ t('automation.wfTemplateHint') }}</div>
      </div>

      <div v-if="form.actionType === 'compositeWorkflow' && workflowConfig && workflowMeta" class="atd-field">
        <WorkflowEditor v-model="workflowConfig" :meta="workflowMeta" :strategies="strategies" :accounts="accounts" />
        <div v-if="accountHint" class="atd-sub atd-sub--warn" data-testid="wf-account-hint">{{ accountHint }}</div>
        <div class="atd-row atd-preview">
          <button class="cohere-btn-text" data-testid="wf-preview" @click="refreshPreview">{{ t('automation.wfPreview') }}</button>
          <span v-if="planPreview" class="atd-sub">
            {{ t('automation.wfPreviewResult', { summary: planPreview.summary, minutes: planPreview.totalMinutes }) }}
          </span>
        </div>
      </div>

      <div class="atd-field">
        <label class="atd-label">{{ t('automation.fieldTriggers') }}</label>
        <div class="atd-sub">{{ t('automation.triggersHint') }}</div>

        <label class="atd-check">
          <input v-model="form.useAppStart" type="checkbox" data-testid="trigger-appstart" />
          {{ t('automation.triggerAppStart') }}
        </label>

        <label class="atd-check">
          <input v-model="form.useDaily" type="checkbox" data-testid="trigger-daily" />
          {{ t('automation.triggerDaily') }}
          <input v-model="form.dailyTime" type="time" class="atd-input atd-input--sm" :disabled="!form.useDaily" />
        </label>

        <label class="atd-check">
          <input v-model="form.useWeekly" type="checkbox" data-testid="trigger-weekly" />
          {{ t('automation.triggerWeekly') }}
          <input v-model="form.weeklyTime" type="time" class="atd-input atd-input--sm" :disabled="!form.useWeekly" />
        </label>
        <div v-if="form.useWeekly" class="atd-weekdays">
          <label v-for="d in 7" :key="d" class="atd-weekday">
            <input v-model="form.weekdays" type="checkbox" :value="d" /> {{ t('automation.weekdays.' + d) }}
          </label>
        </div>

        <label class="atd-check">
          <input v-model="form.useInterval" type="checkbox" data-testid="trigger-interval" />
          {{ t('automation.triggerInterval') }}
          <input
            v-model.number="form.intervalMinutes"
            type="number"
            min="5"
            max="1440"
            class="atd-input atd-input--sm"
            :disabled="!form.useInterval"
          />
          {{ t('automation.minutesUnit') }}
        </label>
      </div>

      <div class="atd-field">
        <label class="atd-label">{{ t('automation.fieldPolicy') }}</label>
        <label class="atd-check">
          <input v-model="form.failurePolicy" type="radio" value="skip" data-testid="policy-skip" />
          {{ t('automation.policySkip') }}
          <span class="atd-sub">— {{ t('automation.policySkipHint') }}</span>
        </label>
        <label class="atd-check">
          <input v-model="form.failurePolicy" type="radio" value="abort" data-testid="policy-abort" />
          {{ t('automation.policyAbort') }}
          <span class="atd-sub">— {{ t('automation.policyAbortHint') }}</span>
        </label>
      </div>

      <div class="atd-field">
        <label class="atd-label">{{ t('automation.fieldRetries') }}</label>
        <select v-model.number="form.maxRetries" class="atd-input atd-input--sm">
          <option :value="0">{{ t('automation.retryNone') }}</option>
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="3">3</option>
        </select>
      </div>

      <div v-if="formError" class="atd-error" data-testid="automation-form-error">{{ formError }}</div>

      <div class="atd-footer">
        <button class="cohere-btn-secondary" @click="close">{{ t('automation.cancel') }}</button>
        <button class="cohere-btn-primary" :disabled="saving" @click="save">{{ t('automation.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import ACCOUNT_STATUS from '../../../shared/workflow-account-status.json'
import {
  automationCreate, automationUpdate,
  listWorkflowTemplates, saveWorkflowTemplate, getWorkflowMeta, previewWorkflowPlan,
} from '@/api/automation'
import { aiListRewriteStrategies, listAccounts } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import WorkflowEditor from './WorkflowEditor.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  task: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const { t } = useI18n()
const { notifySuccess } = useNotify()

const form = ref(emptyForm())
const workflowMeta = ref(null)
const workflowConfig = ref(null)
const templates = ref({ builtin: [], custom: [] })
const strategies = ref([])
const accounts = ref([])
const accountsReady = ref(false)
const accountHint = ref('')
const templateId = ref('')
const templateName = ref('')
const planPreview = ref(null)
const saving = ref(false)
const formError = ref('')

function emptyForm () {
  return {
    id: '',
    name: '',
    actionType: 'compositeWorkflow',
    legacyConfig: null,
    useAppStart: false,
    useDaily: false,
    dailyTime: '09:00',
    useWeekly: false,
    weeklyTime: '09:00',
    weekdays: [],
    useInterval: false,
    intervalMinutes: 30,
    failurePolicy: 'skip',
    maxRetries: 0,
  }
}

function clone (v) { return JSON.parse(JSON.stringify(v)) }

const formTriggers = computed(() => {
  const list = []
  if (form.value.useAppStart) list.push({ type: 'onAppStart' })
  if (form.value.useDaily) list.push({ type: 'daily', time: form.value.dailyTime })
  if (form.value.useWeekly) list.push({ type: 'weekly', weekdays: [...form.value.weekdays], time: form.value.weeklyTime })
  if (form.value.useInterval) list.push({ type: 'interval', minutes: Number(form.value.intervalMinutes) })
  return list
})

function close () { emit('update:modelValue', false) }
function onKeydown (e) { if (e.key === 'Escape' && props.modelValue) close() }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

async function loadTemplates () {
  const res = await listWorkflowTemplates()
  if (res && res.code === 0 && res.data) {
    templates.value = { builtin: res.data.builtin || [], custom: res.data.custom || [] }
  }
}

async function loadMeta () {
  const [metaRes, strategyRes] = await Promise.all([getWorkflowMeta(), aiListRewriteStrategies()])
  if (metaRes && metaRes.code === 0 && metaRes.data) workflowMeta.value = metaRes.data
  if (strategyRes && strategyRes.code === 0 && Array.isArray(strategyRes.data)) strategies.value = strategyRes.data
}

async function loadAccounts () {
  try {
    const res = await listAccounts()
    const data = Array.isArray(res) ? res : (res && res.code === 0 ? res.data : [])
    accounts.value = (Array.isArray(data) ? data : []).filter((a) => a && a.id && a.platform)
    accountsReady.value = true
  } catch (_) {
    accounts.value = []
    accountsReady.value = false
  }
}

function platformLabel (id) {
  const found = ((workflowMeta.value && workflowMeta.value.platforms) || []).find((p) => p.id === id)
  return found ? found.label : id
}

function findAccount (platform, accountId) {
  return accounts.value.find((a) => a.platform === platform && String(a.id) === String(accountId))
}

/**
 * 模板只存平台建议，不存账号 ID（账号属于本机/本用户）；
 * 老任务里也可能残留空 accountId。这里统一清掉并给出可读提示。
 */
function sanitizePublishTargets (cfg) {
  if (!cfg || !cfg.publish || !Array.isArray(cfg.publish.targets)) return { config: cfg, hint: '' }
  if (!accountsReady.value) return { config: cfg, hint: t('automation.wfAccountsLoadFailed') }
  // 纯函数：不改调用方传入的对象，避免重复调用时逐次丢目标
  const next = clone(cfg)
  const kept = []
  const suggested = []
  let missing = false
  for (const target of next.publish.targets) {
    if (!target || !target.platform) continue
    if (!target.accountId) {
      suggested.push(platformLabel(target.platform))
      continue
    }
    const acc = findAccount(target.platform, target.accountId)
    if (acc) kept.push({ platform: acc.platform, accountId: String(acc.id) })
    else {
      missing = true
      suggested.push(platformLabel(target.platform))
    }
  }
  next.publish.targets = kept
  const parts = []
  if (suggested.length) {
    parts.push(t('automation.wfAccountsLegacy', { platforms: [...new Set(suggested)].join('、') }))
  }
  if (missing) parts.push(t('automation.wfAccountsUnavailable'))
  return { config: next, hint: parts.join('；') }
}

function hydrate (task) {
  formError.value = ''
  templateId.value = ''
  templateName.value = ''
  planPreview.value = null
  accountHint.value = ''
  if (!task) {
    form.value = emptyForm()
    const defaults = workflowMeta.value ? clone(workflowMeta.value.defaults) : null
    const sanitized = sanitizePublishTargets(defaults)
    workflowConfig.value = sanitized.config
    accountHint.value = sanitized.hint
    return
  }
  const f = emptyForm()
  f.id = task.id
  f.name = task.name
  for (const tr of task.triggers || []) {
    if (tr.type === 'onAppStart') f.useAppStart = true
    if (tr.type === 'daily') { f.useDaily = true; f.dailyTime = tr.time }
    if (tr.type === 'weekly') { f.useWeekly = true; f.weeklyTime = tr.time; f.weekdays = [...(tr.weekdays || [])] }
    if (tr.type === 'interval') { f.useInterval = true; f.intervalMinutes = tr.minutes }
  }
  f.failurePolicy = task.failurePolicy || 'skip'
  f.maxRetries = Number(task.maxRetries) || 0
  f.actionType = task.action && task.action.type === 'compositeWorkflow' ? 'compositeWorkflow' : 'fullAutoPipeline'
  // 旧任务的 URL/RSS 配置必须原样带回：编辑旧任务后再保存不能把采集源清空
  f.legacyConfig = f.actionType === 'fullAutoPipeline' ? clone((task.action && task.action.config) || {}) : null
  form.value = f
  if (f.actionType === 'compositeWorkflow') {
    const sanitized = sanitizePublishTargets(clone(task.action.config))
    workflowConfig.value = sanitized.config
    accountHint.value = sanitized.hint
  } else {
    const defaults = workflowMeta.value ? clone(workflowMeta.value.defaults) : null
    workflowConfig.value = defaults
    accountHint.value = ''
  }
}

function applyTemplate () {
  const all = [...templates.value.builtin, ...templates.value.custom]
  const tpl = all.find((x) => x.id === templateId.value)
  if (!tpl) return
  const sanitized = sanitizePublishTargets(clone(tpl.config))
  workflowConfig.value = sanitized.config
  accountHint.value = sanitized.hint
  if (!form.value.name) form.value.name = tpl.name
  templateName.value = tpl.name
}

async function saveAsTemplate () {
  if (!templateName.value.trim()) { formError.value = t('automation.wfTemplateNameRequired'); return }
  // 模板要可跨机器/跨用户分发：只保留平台建议，不写入本机账号 ID
  const templateConfig = clone(workflowConfig.value)
  if (templateConfig && templateConfig.publish && Array.isArray(templateConfig.publish.targets)) {
    templateConfig.publish.targets = templateConfig.publish.targets.map((x) => ({ platform: x.platform, accountId: '' }))
  }
  const res = await saveWorkflowTemplate({ name: templateName.value.trim(), config: templateConfig })
  if (!res || res.code !== 0 || !res.ok) {
    formError.value = res && res.reason === 'name:duplicate'
      ? t('automation.wfTemplateDuplicate')
      : t('automation.errSaveFailed')
    return
  }
  notifySuccess('automation.wfTemplateSaved')
  await loadTemplates()
}

async function refreshPreview () {
  if (!workflowConfig.value) return
  const res = await previewWorkflowPlan({
    config: workflowConfig.value,
    itemCount: Number(workflowConfig.value.guardrails.maxItemsPerRun) || 1,
  })
  planPreview.value = res && res.code === 0 && res.ok ? res : null
}

async function save () {
  formError.value = ''
  if (!form.value.name.trim()) { formError.value = t('automation.errNameEmpty'); return }
  if (form.value.name.trim().length > 40) { formError.value = t('automation.errNameTooLong'); return }
  if (formTriggers.value.length === 0) { formError.value = t('automation.errNoTrigger'); return }
  if (form.value.useWeekly && form.value.weekdays.length === 0) { formError.value = t('automation.errNoWeekday'); return }
  if (form.value.actionType === 'compositeWorkflow') {
    const content = workflowConfig.value && workflowConfig.value.content
    const targets = (workflowConfig.value && workflowConfig.value.publish && workflowConfig.value.publish.targets) || []
    if ((!content || content.type !== 'podcast') && !accountsReady.value) {
      formError.value = t('automation.wfAccountsLoadFailed')
      return
    }
    if ((!content || content.type !== 'podcast') && (!targets.length || targets.some((x) => !x.accountId))) {
      formError.value = t('automation.wfAccountsRequired')
      return
    }
    if (targets.some((x) => !findAccount(x.platform, x.accountId))) {
      formError.value = t('automation.wfAccountsUnavailable')
      return
    }
    const expired = targets.find((x) => {
      const acc = findAccount(x.platform, x.accountId)
      return acc && Array.isArray(ACCOUNT_STATUS.unusable) && ACCOUNT_STATUS.unusable.includes(String(acc.status || ''))
    })
    if (expired) {
      formError.value = t('automation.wfAccountsExpired')
      return
    }
  }

  const payload = {
    name: form.value.name.trim(),
    triggers: formTriggers.value,
    failurePolicy: form.value.failurePolicy,
    maxRetries: Number(form.value.maxRetries) || 0,
    action: form.value.actionType === 'compositeWorkflow'
      ? { type: 'compositeWorkflow', config: workflowConfig.value }
      : { type: 'fullAutoPipeline', config: form.value.legacyConfig || {} },
  }
  saving.value = true
  try {
    const res = form.value.id
      ? await automationUpdate(form.value.id, payload)
      : await automationCreate(payload)
    if (!res || res.code !== 0 || !res.ok) {
      const firstError = res && res.errors && res.errors[0]
      formError.value = firstError
        ? t('automation.wfConfigInvalid', { field: firstError.field, reason: firstError.reason })
        : ((res && res.message) || t('automation.errSaveFailed'))
      return
    }
    notifySuccess(form.value.id ? 'automation.saved' : 'automation.created')
    emit('saved')
    close()
  } catch (e) {
    formError.value = (e && e.message) || t('automation.errSaveFailed')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadMeta(), loadTemplates(), loadAccounts()])
  hydrate(props.task)
})

// 供父页面测试/编排读取：表单状态与提交动作仍只有这一份实现
defineExpose({ form, formTriggers, save, hydrate })
</script>

<style scoped>
.atd-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.atd-dialog { width: 760px; max-height: 86vh; overflow-y: auto; padding: 20px 24px; background: #fff; border-radius: 12px; }
.atd-title { margin-bottom: 16px; font-size: var(--font-size-lg, 16px); font-weight: 600; }
.atd-field { margin-bottom: 16px; }
.atd-label { display: block; margin-bottom: 6px; font-weight: 500; font-size: var(--font-size-sm, 13px); }
.atd-check { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: var(--font-size-sm, 13px); }
.atd-input { height: 32px; padding: 0 10px; border: 1px solid var(--color-border, #dcdfe6); border-radius: 6px; font-size: var(--font-size-sm, 13px); }
.atd-input--sm { width: 120px; height: 28px; }
.atd-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.atd-preview { margin-top: 10px; }
.atd-sub { display: block; color: #85858f; font-size: var(--font-size-xs, 12px); line-height: 1.5; }
.atd-sub--warn { color: #b26a00; }
.atd-weekdays { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 10px 24px; }
.atd-weekday { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs, 12px); }
.atd-error { padding: 8px 12px; border-radius: 6px; background: #fef0f0; color: #d9534f; font-size: var(--font-size-xs, 12px); }
.atd-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
