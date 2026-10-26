<template>
  <div
    class="mp-empty-state"
    :class="{ 'mp-empty-state--compact': compact, 'mp-empty-state--scaffold': scaffold }"
  >
    <div class="mp-empty-state__icon" aria-hidden="true">
      <slot name="icon">
        <el-icon v-if="iconComponent"><component :is="iconComponent" /></el-icon>
        <template v-else>{{ icon }}</template>
      </slot>
    </div>
    <p class="mp-empty-state__title">{{ title }}</p>
    <p v-if="description" class="mp-empty-state__hint">{{ description }}</p>
    <div v-if="hasActions || actionText" class="mp-empty-state__actions">
      <slot name="actions">
        <button class="mp-empty-state__action" type="button" @click="$emit('action')">
          {{ actionText }}
        </button>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { computed, useSlots } from 'vue'
import { Box, VideoCamera, TrendCharts, Document, Search, Promotion, User, Collection, Headset } from '@element-plus/icons-vue'

/** icon 属性白名单：命中的图标名渲染为 Element Plus 线性图标；未命中按纯文本回退（兼容历史调用） */
const ICON_COMPONENTS = { Box, VideoCamera, TrendCharts, Document, Search, Promotion, User, Collection, Headset }

const props = defineProps({
  icon: { type: String, default: 'Box' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionText: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  /**
   * 页面骨架层观感（ui-consistency-polish）：仅五个目标页开启。
   * 默认保持旧观感 —— EmptyState 是全站高频组件，全局换肤会让已登记的像素基线
   * （collection / viral-analysis / calendar 等）全部漂移，而本次范围只有五页。
   */
  scaffold: { type: Boolean, default: false }
})
defineEmits(['action'])

const iconComponent = computed(() => ICON_COMPONENTS[props.icon] || null)

const slots = useSlots()
const hasActions = !!slots.actions
</script>

<style scoped>
/* 默认观感（全站既有基线）——非目标页不变 */
.mp-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-3);
  min-height: 260px;
  padding: var(--spacing-6);
  text-align: center;
  color: var(--color-text-secondary);
}
.mp-empty-state--compact {
  min-height: 120px;
  gap: var(--spacing-2);
  padding: var(--spacing-3);
}
.mp-empty-state__icon {
  font-size: 38px;
  line-height: 1;
}
.mp-empty-state--compact .mp-empty-state__icon {
  font-size: var(--font-size-xl);
}
.mp-empty-state__title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
}
.mp-empty-state--compact .mp-empty-state__title {
  font-size: var(--font-size-sm);
}
.mp-empty-state__hint {
  margin: 0;
  font-size: var(--font-size-sm);
}
.mp-empty-state__actions {
  margin-top: var(--spacing-2);
}
.mp-empty-state__action {
  padding: var(--spacing-2) var(--spacing-5);
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.mp-empty-state__action:hover {
  background: var(--color-primary-hover);
}

/* 页面骨架观感（五个目标页）——图标底座 + 标题 + 说明 + CTA */
.mp-empty-state--scaffold {
  gap: 6px;
  min-height: 240px;
  padding: 32px 24px;
}
.mp-empty-state--scaffold.mp-empty-state--compact {
  min-height: 140px;
  padding: 16px;
}
.mp-empty-state--scaffold .mp-empty-state__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 6px;
  border-radius: var(--r-full);
  background: var(--brand-gradient-soft);
  color: var(--color-primary);
  font-size: var(--font-size-xl);
  flex-shrink: 0;
}
.mp-empty-state--scaffold.mp-empty-state--compact .mp-empty-state__icon {
  width: 38px;
  height: 38px;
  font-size: var(--font-size-base);
  margin-bottom: 2px;
}
.mp-empty-state--scaffold .mp-empty-state__title {
  color: var(--color-text-strong);
  font-family: var(--font-family-ui-display);
  font-size: var(--font-size-base);
  line-height: 1.4;
  letter-spacing: -0.1px;
}
.mp-empty-state--scaffold.mp-empty-state--compact .mp-empty-state__title {
  font-size: var(--font-size-sm);
}
.mp-empty-state--scaffold .mp-empty-state__hint {
  max-width: 420px;
  color: var(--color-text-muted);
  line-height: 1.65;
}
.mp-empty-state--scaffold .mp-empty-state__actions {
  margin-top: 10px;
}
.mp-empty-state--scaffold .mp-empty-state__action {
  height: 34px;
  padding: 0 18px;
  border-radius: 10px;
  font-family: var(--font-family-ui);
  font-weight: 500;
  transition: background-color var(--motion-fast) var(--ease-default), box-shadow var(--motion-fast) var(--ease-default);
}
.mp-empty-state--scaffold .mp-empty-state__action:hover {
  box-shadow: var(--shadow-sm);
}
.mp-empty-state--scaffold .mp-empty-state__action:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .mp-empty-state--scaffold .mp-empty-state__action { transition: none; }
}
</style>
