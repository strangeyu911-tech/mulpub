<template>
  <button class="account-add-button primary" type="button" data-testid="account-add" @click="handleClick">
    <Plus />{{ t('accountsPage.addAccount') }}
  </button>
  <UiModal
    :visible="limitVisible"
    :title="t('accountsPage.accountLimitTitle')"
    size="sm"
    @close="limitVisible = false"
  >
    <p class="account-limit-body" data-testid="account-limit-body">
      {{ t('accountsPage.accountLimitBody', { current: current, limit: limitState.limit }) }}
    </p>
    <template #footer>
      <UiButton variant="ghost" @click="limitVisible = false">{{ t('accountsPage.cancel') }}</UiButton>
      <UiButton data-testid="account-limit-upgrade" @click="goUpgrade">{{ t('accountsPage.accountLimitUpgrade') }}</UiButton>
    </template>
  </UiModal>
</template>

<script setup>
/**
 * AccountAddAction — 「添加账号」按钮 + 绑定账号上限弹窗（v3.1 P0）
 *
 * 为什么抽成组件：`Accounts.vue` 被 `check-max-lines` 的 targets 点名（零增长容差），
 * 上限弹窗与按钮状态放进去会把视图推过 1578 行；这里把「按钮 + 上限弹窗 + 判据」
 * 收成一处，视图只留一个 ref 与一个 @open。
 *
 * 语义：
 * - 未达上限：emit('open')，由 Accounts.vue 打开登录弹窗。
 * - 已达上限：只打开本组件的上限弹窗，不 emit、不触登录 IPC。
 * - `open()` 暴露给平台卡片入口：返回 false 表示已弹上限，调用方不得再开登录弹窗。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import { accountLimitState } from '@/features/member/plan-limits'

const props = defineProps({
  entitlement: { type: Object, default: null },
  current: { type: Number, default: 0 },
})
const emit = defineEmits(['open'])
const { t } = useI18n()
const router = useRouter()
const limitVisible = ref(false)
const limitState = computed(() => accountLimitState(props.entitlement, props.current))

/** 返回 false = 已达上限（已弹窗）；true = 可继续打开登录弹窗。 */
function open () {
  if (limitState.value.atLimit) {
    limitVisible.value = true
    return false
  }
  return true
}

function handleClick () {
  if (open()) emit('open')
}

function goUpgrade () {
  limitVisible.value = false
  router.push('/member-center?section=subscription')
}

defineExpose({ open })
</script>

<style scoped>
/* 不能复用 Accounts.vue 的 `.page-button`：本组件是多根节点（button + Teleport modal），
   父组件的 scoped 样式不会落到 fragment 的根节点上，按钮会退化成无样式的巨型图标。
   这里按 `.page-button` 的同一套度量复刻，保证默认态与旧按钮逐像素一致。 */
.account-add-button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: #4d4e57;
  font-size: var(--font-size-sm);
  cursor: pointer;
  white-space: nowrap;
}

.account-add-button svg {
  width: 15px;
  height: 15px;
}

.account-add-button.primary {
  border-color: #5048e5;
  background: #5048e5;
  color: #fff;
}

.account-add-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.account-add-button:focus-visible {
  outline: 2px solid #5048e5;
  outline-offset: 2px;
}

:global(html[data-theme='dark']) .account-add-button {
  color: var(--color-text-secondary);
}

.account-limit-body {
  margin: 0;
  color: var(--color-text-secondary, #5c5c66);
  line-height: 1.7;
  font-size: var(--font-size-base, 14px);
}
</style>
