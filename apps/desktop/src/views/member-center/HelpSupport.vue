<template>
  <div class="member-center-help">
    <section class="member-center-card" data-testid="member-center-about">
      <div class="member-center-card-title">{{ t('memberCenter.aboutCardTitle') }}</div>
      <div class="member-center-about-row">
        <span class="member-center-about-label">{{ t('memberCenter.versionLabel') }}</span>
        <span data-testid="member-center-version">{{ version || '—' }}</span>
      </div>
    </section>

    <!--
      问题反馈（2026-10-26）。
      复用既有 feedback:submit 链路（主进程 → 运营中心 /api/v1/feedback），
      不新造第二条上报通道：这条链路本来就在设置页服务，只是会员中心没有入口。
    -->
    <section class="member-center-card" data-testid="member-center-feedback">
      <div class="member-center-card-title">{{ t('memberCenter.feedbackTitle') }}</div>
      <p class="member-center-empty-hint">{{ t('memberCenter.feedbackHint') }}</p>

      <label class="member-center-field">
        <span class="member-center-field-label">{{ t('memberCenter.feedbackCategory') }}</span>
        <select
          v-model="category"
          class="member-center-field-input"
          data-testid="feedback-category"
          :disabled="submitting"
        >
          <option value="" disabled>{{ t('memberCenter.feedbackCategoryPlaceholder') }}</option>
          <option v-for="option in CATEGORIES" :key="option.value" :value="option.value">
            {{ t(option.labelKey) }}
          </option>
        </select>
      </label>

      <label class="member-center-field">
        <span class="member-center-field-label">{{ t('memberCenter.feedbackMessage') }}</span>
        <textarea
          v-model="message"
          class="member-center-field-input member-center-field-textarea"
          data-testid="feedback-message"
          rows="5"
          :maxlength="MESSAGE_MAX"
          :placeholder="t('memberCenter.feedbackMessagePlaceholder')"
          :disabled="submitting"
        />
      </label>
      <p class="member-center-field-meta">
        <span>{{ t('memberCenter.feedbackMessageCount', { count: messageLength, max: MESSAGE_MAX }) }}</span>
        <!-- 只在「已经动了笔但还不够」时提示，空着不红 -->
        <span
          v-if="messageTooShort"
          class="member-center-field-error"
          data-testid="feedback-message-error"
        >{{ t('memberCenter.feedbackMessageTooShort') }}</span>
      </p>

      <label class="member-center-field">
        <span class="member-center-field-label">{{ t('memberCenter.feedbackContact') }}</span>
        <input
          v-model="contact"
          class="member-center-field-input"
          data-testid="feedback-contact"
          type="text"
          :maxlength="CONTACT_MAX"
          :placeholder="t('memberCenter.feedbackContactPlaceholder')"
          :disabled="submitting"
        >
      </label>

      <div class="member-center-field member-center-feedback-options">
        <button
          class="cohere-btn-secondary"
          type="button"
          data-testid="feedback-copy-diagnostics"
          :disabled="copying"
          @click="copyDiagnostics"
        >
          {{ copied ? t('memberCenter.feedbackCopied') : t('memberCenter.feedbackCopyDiagnostics') }}
        </button>
        <p class="member-center-field-meta">{{ t('memberCenter.feedbackDiagnosticsHint') }}</p>
        <label class="member-center-checkbox">
          <input v-model="attachDiagnostics" type="checkbox" data-testid="feedback-attach-diagnostics" :disabled="submitting">
          <span>{{ t('memberCenter.feedbackAttachDiagnostics') }}</span>
        </label>
        <label class="member-center-checkbox">
          <input v-model="attachLogs" type="checkbox" data-testid="feedback-attach-logs" :disabled="submitting">
          <span>{{ t('memberCenter.feedbackAttachLogs') }}</span>
        </label>
      </div>

      <button
        class="cohere-btn-primary"
        data-testid="feedback-submit"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ submitting ? t('memberCenter.feedbackSubmitting') : t('memberCenter.feedbackSubmit') }}
      </button>

      <p
        v-if="result"
        class="member-center-feedback-result"
        :class="'is-' + result.tone"
        :data-testid="'feedback-result-' + result.tone"
        role="status"
      >{{ result.text }}</p>
    </section>
  </div>
</template>

<script setup>
/**
 * HelpSupport — 会员中心「帮助与支持」。
 *
 * 2026-10-26：从「版本号 + 一句提示」的死页，改成**能真正提交反馈**的入口。
 *
 * 三条设计约束：
 *   ① 复用既有链路：`feedback:submit` → 主进程 `services/feedback.js` →
 *      运营中心 `/api/v1/feedback`（X-Catalog-Key）。不新造第二条上报通道。
 *   ② 诊断信息**默认附带**、可一键复制：用户来反馈时最值钱的就是「当时到底
 *      发生了什么」，但多数人不会自己去翻日志。诊断文本由主进程组装并脱敏。
 *   ③ 拼装后的 message 必须 ≤ 10000 字（服务端 MAX_MESSAGE_LENGTH）：客户端先
 *      截断正文，而不是让服务端 400 回来——那会让用户白写一遍。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi, invoke } from '@/api/electron-bridge'
import { identityDiagnosticReport } from '@/api/identity'
import { writeClipboard } from '@/utils/clipboard'

const { t } = useI18n()

const MESSAGE_MIN = 10
const MESSAGE_MAX = 1000
const CONTACT_MAX = 100
const DIAGNOSTICS_MAX = 4000
/** 与服务端 feedback.js 的 MAX_MESSAGE_LENGTH 同值（镜像，不是第二真源）。 */
const MESSAGE_HARD_MAX = 10000

const CATEGORIES = [
  { value: 'account', labelKey: 'memberCenter.feedbackCategoryAccount' },
  { value: 'payment', labelKey: 'memberCenter.feedbackCategoryPayment' },
  { value: 'publish', labelKey: 'memberCenter.feedbackCategoryPublish' },
  { value: 'ai', labelKey: 'memberCenter.feedbackCategoryAi' },
  { value: 'ui', labelKey: 'memberCenter.feedbackCategoryUi' },
  { value: 'other', labelKey: 'memberCenter.feedbackCategoryOther' },
]

const version = ref('')
const category = ref('')
const message = ref('')
const contact = ref('')
const attachDiagnostics = ref(true)
const attachLogs = ref(false)
const submitting = ref(false)
const copying = ref(false)
const copied = ref(false)
const result = ref(null)
const diagnosticsText = ref('')

const messageLength = computed(() => message.value.trim().length)
const messageTooShort = computed(() => messageLength.value > 0 && messageLength.value < MESSAGE_MIN)
const canSubmit = computed(() => (
  !submitting.value
  && category.value !== ''
  && messageLength.value >= MESSAGE_MIN
  && messageLength.value <= MESSAGE_MAX
))

const categoryLabelKey = computed(() => {
  const hit = CATEGORIES.find((option) => option.value === category.value)
  return hit ? hit.labelKey : ''
})

/** 诊断文本懒加载 + 缓存：只在需要时走一次 IPC。 */
async function loadDiagnostics () {
  if (diagnosticsText.value) return diagnosticsText.value
  const res = await identityDiagnosticReport()
  const text = res && res.code === 0 && res.data && typeof res.data.text === 'string' ? res.data.text : ''
  diagnosticsText.value = text.slice(0, DIAGNOSTICS_MAX)
  return diagnosticsText.value
}

async function copyDiagnostics () {
  copying.value = true
  try {
    const text = await loadDiagnostics()
    if (!text) {
      result.value = { tone: 'error', text: t('memberCenter.feedbackCopyFailed') }
      return
    }
    const ok = await writeClipboard(text)
    if (ok) {
      copied.value = true
      setTimeout(() => { copied.value = false }, 2000)
    } else {
      result.value = { tone: 'error', text: t('memberCenter.feedbackCopyFailed') }
    }
  } finally {
    copying.value = false
  }
}

/**
 * 拼装上报正文：结构化抬头 + 用户正文。
 * 抬头是为了让运营**不必打开详情就能分诊**（分类/联系方式在列表预览里可见）。
 */
function buildMessage (diagnostics) {
  const header = [`${t('memberCenter.feedbackPayloadCategory')}${t(categoryLabelKey.value)}`]
  const trimmedContact = contact.value.trim()
  if (trimmedContact) {
    header.push(`${t('memberCenter.feedbackPayloadContact')}${trimmedContact.slice(0, CONTACT_MAX)}`)
  }
  if (diagnostics) {
    header.push(t('memberCenter.feedbackPayloadDiagnostics'), diagnostics, '---')
  }
  const body = message.value.trim()
  const assembled = `${header.join('\n')}\n${body}`
  // 硬上限：宁可截断正文，也不让服务端 400 把整次提交打回
  return assembled.length > MESSAGE_HARD_MAX ? assembled.slice(0, MESSAGE_HARD_MAX) : assembled
}

async function submit () {
  if (!canSubmit.value) return
  submitting.value = true
  result.value = null
  try {
    const diagnostics = attachDiagnostics.value ? await loadDiagnostics() : ''
    const response = await invoke('feedback:submit', {
      message: buildMessage(diagnostics),
      category: category.value,
      source: 'member-center',
      includeLogs: attachLogs.value,
    })
    if (!response || response.code !== 0) {
      // 服务端的 message 已经是人话（如「未配置运营后台同步（地址/Key）」），
      // 但那是部署问题，不该原样丢给终端用户 ⇒ 统一走可读文案。
      const detail = response && typeof response.message === 'string' ? response.message : ''
      const unreachable = /未配置|未就绪|连接|network|fetch/i.test(detail)
      result.value = {
        tone: 'error',
        text: t(unreachable ? 'memberCenter.feedbackUnavailable' : 'memberCenter.feedbackFailed'),
      }
      return
    }
    result.value = { tone: 'success', text: t('memberCenter.feedbackSuccess') }
    message.value = ''
    contact.value = ''
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  const api = getApi()
  if (api && typeof api.getVersion === 'function') {
    try {
      const res = await api.getVersion()
      if (res && res.code === 0 && res.data) version.value = String(res.data)
    } catch {
      version.value = ''
    }
  }
})
</script>

<style scoped>
.member-center-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
.member-center-field-label {
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.member-center-field-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: var(--font-size-sm);
  box-sizing: border-box;
}
.member-center-field-textarea {
  resize: vertical;
  min-height: 96px;
  font-family: inherit;
  line-height: 1.6;
}
.member-center-field-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 0 0;
  color: var(--muted);
  font-size: var(--font-size-xs);
}
.member-center-field-error {
  color: var(--danger, #d14343);
}
.member-center-feedback-options {
  gap: 8px;
}
.member-center-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink);
  font-size: var(--font-size-sm);
}
.member-center-feedback-result {
  margin: 10px 0 0;
  font-size: var(--font-size-sm);
}
.member-center-feedback-result.is-success {
  color: var(--success, #2e7d32);
}
.member-center-feedback-result.is-error {
  color: var(--danger, #d14343);
}
</style>
