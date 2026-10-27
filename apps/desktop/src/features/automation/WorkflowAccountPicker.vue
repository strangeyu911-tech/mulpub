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
import { computed } from 'vue'
import { useAccountSelection } from './useAccountSelection'

const props = defineProps({
  accounts: { type: Array, default: () => [] },
  meta: { type: Object, required: true },
})
const targets = defineModel({ type: Array, required: true })
const {
  t, accountSearch, recentAccounts, filteredAccountGroups, usableCount, unusableCount,
  selectedCount, accountStatus, accountLabel, isAccountUsable, hasAccount,
  toggleAccount, selectAllVisible, clearAccounts,
} = useAccountSelection({
  accounts: computed(() => props.accounts),
  targets,
  meta: computed(() => props.meta),
})
</script>


