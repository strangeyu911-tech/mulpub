<template>
  <div class="member-center-overview">
    <!--
      账号摘要行（Phase 2「真概览」改造）。
      原先是整卡复制「账号与安全」tab 的账号卡（P1-1 三重复制）——
      概览只承担「让用户一眼看到自己在哪、是什么状态」的导览职责，
      完整账号信息与设备管理留在「账号与安全」。
    -->
    <section class="member-center-card member-center-account-summary" data-testid="member-center-account-summary">
      <span class="member-center-avatar" aria-hidden="true">{{ avatarInitial }}</span>
      <div class="member-center-account-main">
        <strong class="member-center-account-name">{{ displayName }}</strong>
        <span v-if="user?.username" class="member-center-account-username">@{{ user.username }}</span>
      </div>
      <span class="member-center-status-badge" :class="`status-${status}`">{{ statusLabel }}</span>
      <!--
        data-testid="member-center-account" 保留：既有测试与可能的 e2e
        选择器继续可用（容器从「卡」变为「摘要行」，语义不变）。
      -->
      <span hidden data-testid="member-center-account" />
    </section>

    <!--
      版本与权益合并且一卡（A2 单一真源）：
      登录且有服务端权益快照时同源展示 entitlement.plan；缺失时回退本地 license。
      原「版本卡」「权益卡」两卡展示同一 plan 是重复，Phase 2 合并。
    -->
    <section class="member-center-card" data-testid="member-center-license">
      <div class="member-center-card-title">{{ t('memberCenter.licenseCardTitle') }}</div>
      <div class="member-center-license-row">
        <div class="member-center-plan-block">
          <span class="member-center-plan-name" data-testid="member-center-plan">{{ licenseLabel }}</span>
          <span class="member-center-plan-meta" data-testid="member-center-entitlement-plan">{{ planLabel }}</span>
        </div>
        <span v-if="isProActive" class="member-center-plan-check" data-testid="member-center-pro-active" aria-hidden="true">✓</span>
      </div>
      <!-- P1-b：升级提示按档位收敛。对 Pro 用户说「解锁全平台发布…」是错误陈述
           （用户已经拥有），也会让人怀疑会员是否生效。 -->
      <p
        v-if="!isProActive"
        class="member-center-upgrade-hint"
        data-testid="member-center-upgrade-hint"
      >{{ t('memberCenter.upgradeHint') }}</p>
    </section>

    <!-- 快捷入口：把「概览」变成真正的导览页 -->
    <section class="member-center-card" data-testid="member-center-shortcuts">
      <div class="member-center-card-title">{{ t('memberCenter.shortcutsTitle') }}</div>
      <div class="member-center-shortcut-row">
        <button
          v-for="shortcut in SHORTCUTS"
          :key="shortcut.key"
          class="member-center-shortcut"
          type="button"
          :data-testid="`shortcut-${shortcut.key}`"
          @click="emit('navigate', shortcut.key)"
        >
          <span class="member-center-shortcut-label">{{ t(shortcut.navKey) }}</span>
          <span class="member-center-shortcut-desc">{{ t(shortcut.descKey) }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { useIdentityStore } from '@/stores/identity'
import { useLicenseStore } from '@/stores/license'
import { avatarInitialOf, isProActiveOf, licenseLabelOf, planLabelOf, statusLabelOf } from './labels'

const { t } = useI18n()
const identityStore = useIdentityStore()
const licenseStore = useLicenseStore()
const { status, user, displayName } = useIdentity()

const emit = defineEmits(['navigate'])

const entitlement = computed(() => identityStore.entitlement)
const avatarInitial = computed(() => avatarInitialOf(displayName.value))
const licenseLabel = computed(() => licenseLabelOf(t, licenseStore, entitlement.value))
const planLabel = computed(() => planLabelOf(t, entitlement.value?.plan))
const isProActive = computed(() => isProActiveOf(licenseStore, entitlement.value))
const statusLabel = computed(() => statusLabelOf(t, status.value))

// 快捷入口：只放「用户在概览最可能想去」的三个分区，不做全量导航复制
// （左侧七栏已是全量导航，概览入口是导流不是重复）。
const SHORTCUTS = [
  { key: 'subscription', navKey: 'memberCenter.navSubscription', descKey: 'memberCenter.shortcutSubscriptionDesc' },
  { key: 'orders', navKey: 'memberCenter.navOrders', descKey: 'memberCenter.shortcutOrdersDesc' },
  { key: 'messages', navKey: 'memberCenter.navMessages', descKey: 'memberCenter.shortcutMessagesDesc' },
]
</script>

<style scoped>
.member-center-account-summary {
  display: flex;
  align-items: center;
  gap: 12px;
}
.member-center-shortcut-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.member-center-shortcut {
  flex: 1 1 160px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  background: var(--soft-stone);
  cursor: pointer;
  text-align: left;
}
.member-center-shortcut:hover,
.member-center-shortcut:focus-visible {
  border-color: var(--card-border);
  background: var(--surface);
}
.member-center-shortcut-label {
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.member-center-shortcut-desc {
  color: var(--muted);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}
</style>
