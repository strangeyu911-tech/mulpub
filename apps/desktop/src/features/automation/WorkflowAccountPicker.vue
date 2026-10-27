<template>
  <div v-if="!accounts.length" class="wf-hint wf-hint--warn" data-testid="wf-accounts-empty">
    {{ t('automation.wfAccountsEmpty') }}
  </div>
  <div v-else class="wf-account-groups">
    <div class="wf-account-toolbar">
      <input v-model="accountSearch" class="wf-input wf-input--full" :placeholder="t('automation.wfAccountSearchPlaceholder')" data-testid="wf-account-search" />
      <button type="button" class="cohere-btn-text" data-testid="wf-account-select-all" @click="selectAllVisible">{{ t('automation.wfAccountSelectAll') }}</button>
      <button type="button" class="cohere-btn-text" data-testid="wf-account-clear" @click="clearAccounts">{{ t('automation.wfAccountClear') }}</button>
      <span class="wf-hint" data-testid="wf-account-health">{{ t('automation.wfAccountHealth', { usable: usableCount, unusable: unusableCount }) }}</span>
    </div>
    <div v-if="recentAccounts.length" class="wf-recent" data-testid="wf-recent-accounts">
      <span class="wf-label">{{ t('automation.wfRecentAccounts') }}</span>
      <button v-for="acc in recentAccounts" :key="'recent-' + acc.id" type="button" class="wf-chip wf-recent-chip" :class="{ 'wf-chip--on': hasAccount(acc) }" @click="toggleAccount(acc)">
        {{ accountLabel(acc) }}
      </button>
    </div>
    <div v-if="!filteredAccountGroups.length" class="wf-hint" data-testid="wf-account-no-result">{{ t('automation.wfAccountNoResult') }}</div>
    <div v-for="group in filteredAccountGroups" :key="group.platform" class="wf-account-group">
      <div class="wf-account-group__title">{{ group.label }}</div>
      <div class="wf-chips">
        <label
          v-for="acc in group.accounts"
          :key="acc.id"
          class="wf-chip"
          :class="{ 'wf-chip--on': hasAccount(acc), 'wf-chip--off': !isAccountUsable(acc) }"
          :data-testid="'wf-account-' + acc.id"
        >
          <input type="checkbox" :checked="hasAccount(acc)" :disabled="!isAccountUsable(acc)" @change="toggleAccount(acc)" />
          {{ accountLabel(acc) }}
          <span v-if="accountStatus(acc)" class="wf-account-status">{{ accountStatus(acc) }}</span>
        </label>
      </div>
    </div>
    <div class="wf-hint">{{ t('automation.wfAccountsHint') }}</div>
    <div class="wf-hint" data-testid="wf-accounts-selected">{{ t('automation.wfAccountsSelected', { count: selectedCount }) }}</div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ACCOUNT_STATUS from '../../../shared/workflow-account-status.json'

const props = defineProps({
  accounts: { type: Array, default: () => [] },
  meta: { type: Object, required: true },
})
const targets = defineModel({ type: Array, required: true })
const { t } = useI18n()
const accountSearch = ref('')
const recentAccountIds = ref(readRecentAccounts())
const UNUSABLE_ACCOUNT_STATUS = new Set(Array.isArray(ACCOUNT_STATUS.unusable) ? ACCOUNT_STATUS.unusable : [])

function hasAccountId (acc) {
  return Boolean(acc) && acc.id !== undefined && acc.id !== null && acc.id !== ''
}
function platformLabel (id) {
  const found = (props.meta.platforms || []).find((p) => p.id === id)
  return found ? found.label : id
}
function isAccountUsable (acc) {
  return !UNUSABLE_ACCOUNT_STATUS.has(String((acc && acc.status) || ''))
}
function accountLabel (acc) {
  return acc.name || acc.nickname || acc.remark || String(acc.id)
}
function accountStatus (acc) {
  const status = String(acc.status || '')
  if (!status || status === 'active' || status === 'online') return ''
  if (status === 'expired') return t('automation.wfAccountExpired')
  if (status === 'inactive') return t('automation.wfAccountInactive')
  return status
}
const accountGroups = computed(() => {
  const groups = new Map()
  for (const acc of props.accounts || []) {
    if (!hasAccountId(acc) || !acc.platform) continue
    if (!groups.has(acc.platform)) groups.set(acc.platform, { platform: acc.platform, label: platformLabel(acc.platform), accounts: [] })
    groups.get(acc.platform).accounts.push(acc)
  }
  return Array.from(groups.values())
})
const filteredAccountGroups = computed(() => {
  const q = accountSearch.value.trim().toLowerCase()
  if (!q) return accountGroups.value
  return accountGroups.value.map((g) => ({
    ...g,
    accounts: g.accounts.filter((acc) => [accountLabel(acc), acc.platform, g.label, acc.status || '', acc.remark || '', acc.id].join(' ').toLowerCase().includes(q)),
  })).filter((g) => g.accounts.length > 0)
})
const visibleAccounts = computed(() => filteredAccountGroups.value.flatMap((g) => g.accounts))
const usableCount = computed(() => (props.accounts || []).filter((a) => hasAccountId(a) && isAccountUsable(a)).length)
const unusableCount = computed(() => (props.accounts || []).filter((a) => hasAccountId(a) && !isAccountUsable(a)).length)
const selectedCount = computed(() => (targets.value || []).filter((t) => t.accountId).length)
const recentAccounts = computed(() => {
  const byId = new Map((props.accounts || []).filter(hasAccountId).map((a) => [String(a.id), a]))
  return recentAccountIds.value.map((id) => byId.get(String(id))).filter((a) => a && isAccountUsable(a)).slice(0, 5)
})
function readRecentAccounts () {
  try {
    const raw = window.localStorage.getItem('workflow_recent_accounts')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch (_) { return [] }
}
function rememberAccount (acc) {
  const id = String(acc.id)
  const next = [id, ...recentAccountIds.value.filter((x) => x !== id)].slice(0, 10)
  recentAccountIds.value = next
  try { window.localStorage.setItem('workflow_recent_accounts', JSON.stringify(next)) } catch (_) { /* 隐私模式忽略 */ }
}
function hasAccount (acc) {
  return (targets.value || []).some((t) => t.platform === acc.platform && String(t.accountId) === String(acc.id))
}
function toggleAccount (acc) {
  if (!isAccountUsable(acc)) return
  rememberAccount(acc)
  const list = targets.value || []
  const idx = list.findIndex((t) => t.platform === acc.platform && String(t.accountId) === String(acc.id))
  if (idx >= 0) list.splice(idx, 1)
  else list.push({ platform: acc.platform, accountId: String(acc.id) })
}
function selectAllVisible () {
  const list = targets.value || []
  for (const acc of visibleAccounts.value) {
    if (isAccountUsable(acc) && !hasAccount(acc)) list.push({ platform: acc.platform, accountId: String(acc.id) })
  }
}
function clearAccounts () {
  ;(targets.value || []).splice(0)
}
</script>
