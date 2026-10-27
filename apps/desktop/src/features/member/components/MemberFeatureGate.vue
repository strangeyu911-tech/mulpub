<template>
  <div
    v-if="gateState === 'checking'"
    class="member-feature-gate-loading"
    data-testid="member-feature-gate-loading"
    role="status"
    aria-live="polite"
  >
    <span class="member-feature-gate-spinner" aria-hidden="true"></span>
    <span>{{ t('memberCenter.featureGateChecking') }}</span>
  </div>

  <div
    v-else-if="gateState === 'locked'"
    class="member-feature-gate"
    data-testid="member-feature-gate-locked"
    role="status"
  >
    <div class="member-feature-gate-card">
      <div class="member-feature-gate-icon" aria-hidden="true">
        <el-icon><Lock /></el-icon>
      </div>
      <h1 class="member-feature-gate-title">{{ title }}</h1>
      <p class="member-feature-gate-body">{{ t('memberCenter.featureLockedBody', { feature: title }) }}</p>
      <p class="member-feature-gate-hint">{{ t('memberCenter.featureLockedHint') }}</p>
      <UiButton
        data-testid="member-feature-gate-upgrade"
        variant="primary"
        size="md"
        @click="goUpgrade"
      >
        {{ t('memberCenter.featureLockedCta') }}
      </UiButton>
    </div>
  </div>

  <slot v-else />
</template>

<script setup>
/**
 * MemberFeatureGate — 会员功能整页门禁（P1-1 视频创作，P1-2 知识库复用）。
 *
 * 形态决策：不隐藏入口、不做假页面，而是整页「锁定 + 能解锁什么 + 查看套餐」。
 * 与 DashboardLockedPanel 同一产品逻辑：让免费用户知道功能存在且有升级路径。
 *
 * 数据纪律：`hasFeature` 返回 null（entitlement / features 缺失）时放行——旧快照
 * 不误拦付费用户；只有 features 非空且明确不含目标 key 时才锁定。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Lock } from '@element-plus/icons-vue'
import UiButton from '@/components/UiButton.vue'
import { useIdentityStore } from '@/stores/identity'
import { hasFeature } from '@/features/member/plan-features'

const props = defineProps({
  /** entitlement.features 里的 key，如 video_create */
  featureKey: { type: String, required: true },
  /** 页面标题（由调用方传入 i18n 后的值，组件内不再拼业务名） */
  title: { type: String, required: true },
})

const { t } = useI18n()
const router = useRouter()
const identityStore = useIdentityStore()

// 已有快照就直接判；没有则在挂载时补一次 load（App 启动可能尚未完成）。
const checked = ref(Boolean(identityStore.entitlement))
onMounted(async () => {
  if (checked.value) return
  try {
    await identityStore.load()
  } catch (_) {
    // load 自身已把错误落到 store；这里只负责结束「检查中」态，按缺失即放行处理。
  }
  checked.value = true
})

const allowed = computed(() => hasFeature(identityStore.entitlement, props.featureKey) !== false)
const gateState = computed(() => {
  if (!checked.value) return 'checking'
  return allowed.value ? 'allowed' : 'locked'
})

function goUpgrade() {
  router.push({ path: '/member-center', query: { section: 'subscription' } })
}
</script>

<style scoped>
.member-feature-gate-loading,
.member-feature-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 48px 24px;
  box-sizing: border-box;
}

.member-feature-gate-loading {
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.member-feature-gate-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: member-feature-gate-spin 0.8s linear infinite;
}

.member-feature-gate-card {
  width: min(480px, 100%);
  padding: 40px 32px;
  text-align: center;
  background: var(--canvas);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-1);
}

.member-feature-gate-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 18px;
  color: var(--color-primary);
  background: var(--surface-sunken);
  border-radius: 50%;
  font-size: var(--font-size-xl);
}

.member-feature-gate-title {
  margin: 0 0 10px;
  color: var(--color-text-primary);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.member-feature-gate-body {
  margin: 0 0 8px;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  line-height: 1.6;
}

.member-feature-gate-hint {
  margin: 0 0 22px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

@keyframes member-feature-gate-spin {
  to { transform: rotate(360deg); }
}
</style>
