<template>
  <div
    class="ui-error-state"
    :class="{ 'ui-error-state--compact': compact }"
    role="alert"
    :data-testid="testId || 'ui-error-state'"
  >
    <span class="ui-error-state__icon" aria-hidden="true">
      <el-icon :size="compact ? 16 : 22"><WarningFilled /></el-icon>
    </span>
    <p class="ui-error-state__title">{{ title }}</p>
    <p v-if="hint" class="ui-error-state__hint">{{ hint }}</p>
    <div v-if="hasActions || retryText" class="ui-error-state__actions">
      <slot name="actions">
        <button
          v-if="retryText"
          type="button"
          class="ui-error-state__retry"
          :data-testid="retryTestId"
          @click="$emit('retry')"
        >
          {{ retryText }}
        </button>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { useSlots } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'

// 审计 3.7：整块错误态的单一实现。根节点 role="alert" 是这条组件存在的理由——
// 迁移前 35 处自绘错误块里只有 4 处写了 role，其余站点读屏用户听不到"这次是失败"，
// 只看到空态或 0 值。这里刻意**不**再写 aria-live：role="alert" 已隐含 assertive，
// 重复声明会让同一段文案被朗读两遍（同 4.6 的 toast 结论）。
defineProps({
  title: { type: String, required: true },
  hint: { type: String, default: '' },
  retryText: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  testId: { type: String, default: '' },
  // 重试键自己的锚点：迁移前有些站点的按钮就挂着 data-testid，
  // 容器锚点保住了不代表按钮锚点保住了 —— 丢掉它，远处用例与像素基线会静默失锚（第二轮外部评审 i1 实测抓到）。
  retryTestId: { type: String, default: '' }
})

defineEmits(['retry'])

const slots = useSlots()
const hasActions = !!slots.actions
</script>

<style scoped>
.ui-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-lg);
  text-align: center;
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
}
.ui-error-state--compact {
  flex-direction: row;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  text-align: left;
}
.ui-error-state__icon {
  color: var(--color-danger);
  line-height: 1;
  display: inline-flex;
}
.ui-error-state__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
}
.ui-error-state__hint {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
.ui-error-state__actions {
  margin-top: var(--space-sm);
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.ui-error-state__retry {
  padding: var(--space-sm) var(--space-lg);
  background: var(--color-danger);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
  /* 刻意不写 transition: all —— 会把 outline-* 纳入淡入，焦点环在按 Tab 的瞬间看不见（3.6 实测） */
  transition: opacity .15s ease;
}
.ui-error-state__retry:hover {
  opacity: .88;
}
.ui-error-state__retry:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
</style>
