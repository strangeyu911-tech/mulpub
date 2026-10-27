// @ts-check
/**
 * useAccountSelection.js — 复合工作流「自由多选账号」的纯逻辑
 *
 * 从 WorkflowAccountPicker.vue 抽出：账号分组、搜索、健康状态、最近使用、targets 增删。
 * UI 只负责渲染，逻辑可独立单测；同平台多账号没有平台级默认限制。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ACCOUNT_STATUS from '../../../shared/workflow-account-status.json'

export const UNUSABLE_ACCOUNT_STATUS = new Set(Array.isArray(ACCOUNT_STATUS.unusable) ? ACCOUNT_STATUS.unusable : [])

export function hasAccountId (acc) {
  return Boolean(acc) && acc.id !== undefined && acc.id !== null && acc.id !== ''
}

export function accountLabel (acc) {
  return acc.name || acc.nickname || acc.remark || String(acc.id)
}

export function isAccountUsable (acc) {
  return !UNUSABLE_ACCOUNT_STATUS.has(String((acc && acc.status) || ''))
}

export function useAccountSelection ({ accounts, targets, meta }) {
  const { t } = useI18n()
  const accountSearch = ref('')
  const recentAccountIds = ref(readRecentAccounts())

  function platformLabel (id) {
    const found = ((meta && meta.value && meta.value.platforms) || []).find((p) => p.id === id)
    return found ? found.label : id
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
    for (const acc of (accounts && accounts.value) || []) {
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
  const usableCount = computed(() => ((accounts && accounts.value) || []).filter((a) => hasAccountId(a) && isAccountUsable(a)).length)
  const unusableCount = computed(() => ((accounts && accounts.value) || []).filter((a) => hasAccountId(a) && !isAccountUsable(a)).length)
  const selectedCount = computed(() => ((targets && targets.value) || []).filter((x) => x.accountId).length)
  const recentAccounts = computed(() => {
    const byId = new Map(((accounts && accounts.value) || []).filter(hasAccountId).map((a) => [String(a.id), a]))
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
    return ((targets && targets.value) || []).some((x) => x.platform === acc.platform && String(x.accountId) === String(acc.id))
  }

  function toggleAccount (acc) {
    if (!isAccountUsable(acc)) return
    rememberAccount(acc)
    const list = (targets && targets.value) || []
    const idx = list.findIndex((x) => x.platform === acc.platform && String(x.accountId) === String(acc.id))
    if (idx >= 0) list.splice(idx, 1)
    else list.push({ platform: acc.platform, accountId: String(acc.id) })
  }

  function selectAllVisible () {
    const list = (targets && targets.value) || []
    for (const acc of visibleAccounts.value) {
      if (isAccountUsable(acc) && !hasAccount(acc)) list.push({ platform: acc.platform, accountId: String(acc.id) })
    }
  }

  function clearAccounts () {
    ;((targets && targets.value) || []).splice(0)
  }

  return {
    t, accountSearch, recentAccounts, accountGroups, filteredAccountGroups, visibleAccounts,
    usableCount, unusableCount, selectedCount, targets, platformLabel, accountStatus, accountLabel,
    isAccountUsable, hasAccount, toggleAccount, selectAllVisible, clearAccounts,
  }
}
