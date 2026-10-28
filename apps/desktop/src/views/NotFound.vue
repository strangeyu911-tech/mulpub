<template>
  <div class="nf-page" data-testid="not-found-page">
    <div class="nf-card">
      <h1 class="nf-title">{{ $t('notFound.title') }}</h1>
      <p class="nf-desc">{{ $t('notFound.description') }}</p>

      <p class="nf-path-label">{{ $t('notFound.pathLabel') }}</p>
      <p class="nf-path" data-testid="not-found-path"><code>{{ attemptedPath }}</code></p>

      <div class="nf-actions">
        <button
          type="button"
          class="cohere-btn cohere-btn-primary"
          data-testid="not-found-home"
          @click="goHome"
        >
          {{ $t('notFound.actionHome') }}
        </button>
        <button
          v-if="canGoBack"
          type="button"
          class="cohere-btn cohere-btn-secondary"
          data-testid="not-found-back"
          @click="goBack"
        >
          {{ $t('notFound.actionBack') }}
        </button>
      </div>

      <p class="nf-hint">{{ $t('notFound.hint') }}</p>
    </div>
  </div>
</template>

<script setup>
// 阶段 1.9「未知路由兜底页」（UX 审计 2026-10-17）。
//
// 动因：router/index.js 原来没有 catch-all，未登记路径落到 vue-router 的「无匹配 ⇒ 不渲染」，
// 用户看到的是一段空白应用外壳 —— 侧边栏在、内容区空，既没有提示也没有出口。
// 造出这类路径的现实来源有三条：运营中心深链、旧标签页残留 URL、手输/复制错地址。
//
// 三条设计约束（都不是审美选择）：
//  1. **路径原样回显，不截断。** 用户要核对的就是这几个字符，截了反而没法用；
//     宽度由容器承载（overflow-wrap: anywhere 折行），不由 JS 截断承载。
//     这也是"别把截断加回来"的锁的对应物 —— 本仓展示口径正在收敛到 Unicode 码点（PR #4424），
//     兜底页没有理由自带第五份截断实现，而截断对"核对地址"这个用途是净损失。
//  2. **必须有出口。** 只写一句"页面不存在"等于让用户手动改地址栏 —— 与审计里
//     「提示了问题但不给出口」是同一形状。回首页用 replace 不用 push：兜底页不该留在历史里，
//     否则用户每前进一次就要多点一次"返回"。
//  3. **「返回上一页」只在真能返回时出现。** 深链直达（history.state.back 为 null）时给一个
//     点了没反应的按钮，比不给更糟 —— 本仓既有口径：不得制造"看着能点"的死锚点。
//
// 无障碍：h1 是唯一标题；文案全部走 locale（不在渲染端硬编码中文，CI Gate 7 同域）；
// 出口是原生 button（可聚焦、Enter/Space 天然可达），所以**不做** autofocus ——
// 兜底页不是对话框，抢焦点会打断读屏对标题的朗读（WCAG 2.4.3 焦点顺序）。
// 不声明第二个 live region：这整页就是一次的状态呈现，播报交给标题本身。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const attemptedPath = computed(() => (route && typeof route.fullPath === 'string' ? route.fullPath : ''))

// vue-router 的 history.state 是**普通对象、不是响应式的**：不挂 route 作依赖时，这个 computed
// 只在挂载时求值一次，之后用户再怎么前进/后退，按钮的有无都停在首帧读数（翻转正控实测到这点）。
// 读一次 route.fullPath 把导航挂成依赖，任何一次前进/后退都会重算。
const canGoBack = computed(() => {
  // history.state 是普通对象、不响应式 ⇒ 必须把 route 挂成依赖，否则值在挂载那刻被冻住（翻转正控实测）。
  void route.fullPath
  const back = router.options?.history?.state?.back
  if (!back) return false
  // back 只证明"存在上一个 location"，不证明"回去值得去"：连续访问两个未登记地址时 back 指向的
  // 也是 404 页，go(-1) 只是把用户从 404 挪到 404（评审 i1）。所以再解析一次上一个地址。
  let prevName
  try { prevName = router.resolve(back).name } catch { return false }
  return prevName !== 'NotFound'
})

function goHome () {
  router.replace('/')
}

function goBack () {
  router.go(-1)
}
</script>

<style scoped>
.nf-page {
  display: flex;
  justify-content: center;
  padding: var(--space-xxl, 32px) var(--space-xl, 24px);
}
.nf-card {
  width: 100%;
  max-width: 640px;
}
.nf-title {
  margin: 0 0 var(--space-sm, 8px);
  font-size: var(--font-size-xl, 20px);
}
.nf-desc {
  margin: 0 0 var(--spacing-5, 20px);
  color: var(--color-text-secondary, #666);
}
.nf-path-label {
  margin: 0 0 var(--spacing-1, 4px);
  font-size: var(--font-size-sm, 13px);
  color: var(--color-text-secondary, #666);
}
.nf-path {
  margin: 0 0 var(--spacing-5, 20px);
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  border: 1px solid var(--color-border-default, #ddd);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-bg-secondary, #f7f7f7);
  overflow-wrap: anywhere;
  word-break: break-all;
}
.nf-path code {
  font-size: var(--font-size-sm, 13px);
}
.nf-actions {
  display: flex;
  gap: var(--space-md, 12px);
  margin-bottom: var(--space-lg, 16px);
}
.nf-hint {
  margin: 0;
  font-size: var(--font-size-sm, 13px);
  color: var(--color-text-secondary, #666);
}
</style>
