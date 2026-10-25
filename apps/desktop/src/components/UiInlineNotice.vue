<template>
  <!--
    UiInlineNotice —— 一行/两行文字的内联提示条（非弹窗、非浮层）。

    定位：desktop-ui-consistency「反馈原语统一」下的**内联**分支 —— 与
    UiModal（模态）/ ElMessage（浮层 toast）分工：本组件只做「就地、不打断、可关闭」的
    一行说明，形态为用户指定的绿色参考：浅绿底 + 绿描边 + 左侧对勾 + 右侧关闭钮。

    三条硬约束（契约测试 src/components/UiInlineNotice.test.js 看守）：
    ① 颜色一律取自 tokens.css 的 --color-inline-notice-* 语义槽，禁止就地写字面量；
    ② 关闭钮必须可键盘聚焦且带 aria-label，读屏能播报「关闭」；
    ③ 播报容器**常驻**（role=status + aria-live=polite 挂在本元素上，v-if 只切内层提示条），
       与 OfflineIndicator 同款 —— 若 v-if 挂在根节点上，关闭时整个 live region 被移出 DOM，
       之后任何一次播报都不会被读屏听到（OfflineIndicator 的 QM-6 i2 正是这个教训）。
  -->
  <div
    class="ui-inline-notice-slot"
    :class="{ 'is-empty-slot': !visible }"
    role="status"
    aria-live="polite"
    :data-testid="testId ? `${testId}-live` : undefined"
  >
    <div v-if="visible" class="ui-inline-notice" :data-testid="testId || undefined">
      <span class="ui-inline-notice-icon" aria-hidden="true">
        <CheckIcon :size="iconSize" />
      </span>
      <span class="ui-inline-notice-text">{{ text }}</span>
      <button
        v-if="closable"
        type="button"
        class="ui-inline-notice-close"
        :aria-label="resolvedCloseLabel || undefined"
        data-testid="ui-inline-notice-close"
        @click="close"
      >
        <svg viewBox="0 0 24 24" :width="iconSize" :height="iconSize" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import CheckIcon from './icons/CheckIcon.vue'

const props = defineProps({
  // 提示文案。由调用方从 i18n 词条取值传入（本组件不内置任何硬编码中文）。
  text: { type: String, required: true },
  // 是否显示关闭钮。默认显示 —— 参考截图带 ×，且不可关闭的提示会永久占位。
  closable: { type: Boolean, default: true },
  // 关闭钮的无障碍名称。调用方传入本地化词条，缺省时退化为空串并由 CSS 兜底视觉。
  closeLabel: { type: String, default: '' },
  // 固定 data-testid，便于回归测试与像素视图定位；不传则不渲染该属性。
  testId: { type: String, default: '' },
  // 图标与关闭钮尺寸（px）。默认 14 与一行文字同高。
  iconSize: { type: [Number, String], default: 14 },
})

const emit = defineEmits(['close'])

// 组件自持 visible：关闭即消失。父级若需在关闭后重置，用 v-if 重新挂载即可
// （key 变化会重建内部 ref，这正是「提示一次性」的常规用法）。
//
// 关于「关闭后 live region 里残留旧文案」（deep-review i4）：
// 不需要额外的 announced/liveText 机制 —— visible 为假时内层提示条整体移出 DOM，
// 外层 slot 靠 :empty 隐藏，残留文本无从播报。这一点由测试
// 「关闭后 live region 内不再残留旧文案」直接断言（实测：把 text 绑回 v-if 外的
// 常驻节点不会变红，因为 v-if 已经把内层整块摘掉了；该测试锁住的是这个事实本身）。
const visible = ref(true)

const close = () => {
  visible.value = false
  emit('close')
}

// 关闭钮的 aria-label 兜底：调用方漏传时不渲染空属性（空 aria-label 会被读成无名按钮）。
const resolvedCloseLabel = computed(() => (props.closeLabel || '').trim())
</script>

<style scoped>
/* 常驻播报槽：必须留在可访问性树里（role=status/aria-live 才能生效）。
   曾经用「内容即盒子」的显示方式做空态不占位，但那个值会让多数屏幕阅读器
   把元素移出可访问性树，live region 随之失效（deep-review i1 实测论证）。
   也**不能**靠 :empty —— Vue 的 v-if 为 false 时留下一个注释占位节点，
   而 :empty 要求零子节点，注释让它永不命中，空盒会一直占位
   （deep-review i2，已用 childNodes 探针实测：关闭后 slot 内是 1 个 #comment）。
   正确做法：由 visible 驱动 is-empty-slot 类，显式 display:none。 */
.ui-inline-notice-slot.is-empty-slot { display: none; }
.ui-inline-notice {
  display: flex;
  align-items: center;
  gap: var(--spacing-2, 8px);
  padding: 8px 12px;
  border: 1px solid var(--color-inline-notice-border);
  border-radius: var(--radius-sm, 8px);
  background: var(--color-inline-notice-bg);
  color: var(--color-inline-notice-text);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.ui-inline-notice-icon {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--color-inline-notice-ink);
}
.ui-inline-notice-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ui-inline-notice-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  padding: 2px;
  border: none;
  border-radius: var(--radius-xs, 4px);
  background: transparent;
  color: var(--color-inline-notice-text);
  cursor: pointer;
  line-height: 1;
}
.ui-inline-notice-close:hover {
  background: var(--color-inline-notice-hover);
  color: var(--color-inline-notice-ink);
}
.ui-inline-notice-close:focus-visible {
  outline: 2px solid var(--color-inline-notice-ink);
  outline-offset: 1px;
}
</style>
