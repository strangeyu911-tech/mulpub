<script setup>
/**
 * FilmDoctrinePanel — 「方法论」标签页的只读分区
 *
 * 归属：change `kit-import-rollback-and-template-health`（拆分动机：`FilmEngineeringView.vue`
 * 已 800+ 行、贴着 `check-max-lines` 上限，继续在这个文件里加东西 = 每次都靠容差过关）。
 *
 * ⚠ **纯只读**：只渲染 kit 里的 `prompt-doctrine.json`（blocks / rules / recipes /
 * failureLedger / glossary），没有任何 `@click` / `v-model` / 输入框 / 按钮 ——
 * 方法论是资产，不是可编辑配置；编辑入口一旦出现就必须先有写路径与审计。
 * 该只读性由 `film-engineering-methodology.test.js` 的源码级断言钉住。
 *
 * 数据源：父组件传 `doctrine`（`null` = kit 未就绪 ⇒ 整块不渲染，**不渲染空卡片**）。
 */
import { useI18n } from 'vue-i18n'

defineProps({
  /** `prompt-doctrine.json` 的解析结果；`null`/undefined ⇒ 不渲染 */
  doctrine: { type: Object, default: null },
})

const { t } = useI18n()
</script>

<template>
  <div v-if="doctrine" class="fe-doctrine">
    <el-card shadow="never" class="fe-card">
      <template #header>{{ t('filmEngineering.doctrine.blocks') }}</template>
      <div v-for="b in doctrine.blocks" :key="b.key" class="fe-doctrine-block">
        <div class="fe-doctrine-label">{{ b.label }}</div>
        <div class="fe-doctrine-zh">{{ b.zh }}</div>
        <div class="fe-doctrine-en">{{ t('filmEngineering.doctrine.en') }}：{{ b.en }}</div>
      </div>
    </el-card>
    <el-card shadow="never" class="fe-card">
      <template #header>{{ t('filmEngineering.doctrine.rules') }}</template>
      <div v-for="(r, i) in doctrine.rules" :key="r.key" class="fe-doctrine-rule">
        <b>{{ i + 1 }}. {{ r.title }}</b>
        <div class="fe-doctrine-zh">{{ r.zh }}</div>
      </div>
    </el-card>
    <!-- 影视工程 v2 · F-H：配方与失败台账（数据早已在 kit 里，此前未渲染；只读，无写操作） -->
    <el-card shadow="never" class="fe-card" data-testid="fe-doctrine-recipes">
      <template #header>{{ t('filmEngineering.doctrine.recipes') }}</template>
      <div v-for="r in (doctrine.recipes || [])" :key="r.key" class="fe-doctrine-rule">
        <b>{{ r.label }}</b>
        <div class="fe-doctrine-zh">{{ r.zh }}</div>
        <div class="fe-doctrine-blockkeys">
          {{ t('filmEngineering.doctrine.recipeBlocks') }}：{{ (r.blockKeys || []).join(' / ') }}
        </div>
      </div>
    </el-card>
    <el-card shadow="never" class="fe-card" data-testid="fe-doctrine-failure-ledger">
      <template #header>{{ t('filmEngineering.doctrine.failureLedger') }}</template>
      <div v-for="f in (doctrine.failureLedger || [])" :key="f.id" class="fe-doctrine-rule">
        <b>{{ f.id }} · {{ t('filmEngineering.doctrine.failureSymptom') }}：{{ f.symptom }}</b>
        <div class="fe-doctrine-zh">{{ t('filmEngineering.doctrine.failureCause') }}：{{ f.cause }}</div>
        <div class="fe-doctrine-zh">{{ t('filmEngineering.doctrine.failureFix') }}：{{ f.fix }}</div>
        <div class="fe-doctrine-blockkeys">
          {{ t('filmEngineering.doctrine.failureTags') }}：
          <el-tag v-for="tg in (f.tags || [])" :key="tg" size="small" type="info">{{ tg }}</el-tag>
        </div>
      </div>
    </el-card>
    <el-card shadow="never" class="fe-card">
      <template #header>{{ t('filmEngineering.doctrine.glossary') }}</template>
      <div v-for="g in doctrine.glossary" :key="g.term" class="fe-doctrine-glossary">
        <el-tag size="small" type="info">{{ g.term }}</el-tag>
        <span class="fe-doctrine-glossary-zh">{{ g.zh }}</span>
      </div>
      <div class="fe-hint fe-doctrine-note">{{ t('filmEngineering.doctrine.linkNote') }}</div>
    </el-card>
  </div>
</template>

<style scoped>
/* ⚠ `.fe-card` / `.fe-hint` 是父视图的 scoped 类：scoped 样式不跨组件生效，
   所以这里自带一份**最小**副本（只保留本组件用到的属性），不复刻父视图的整套样式。 */
.fe-card { margin-bottom: 12px; }
.fe-hint { color: #909399; font-size: var(--font-size-xs); font-weight: 400; margin-left: 8px; }
.fe-doctrine-block, .fe-doctrine-rule { margin-bottom: 14px; }
.fe-doctrine-label { font-weight: 600; color: var(--el-color-primary); font-size: var(--font-size-sm); }
.fe-doctrine-zh { color: #303133; font-size: var(--font-size-sm); margin-top: 4px; line-height: 1.6; }
.fe-doctrine-en { color: #909399; font-size: var(--font-size-xs); margin-top: 2px; }
.fe-doctrine-glossary { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fe-doctrine-blockkeys { color: #909399; font-size: var(--font-size-xs); margin-top: 2px; line-height: 1.6; }
.fe-doctrine-glossary-zh { font-size: var(--font-size-sm); color: #303133; }
.fe-doctrine-note { margin-top: 12px; }
</style>
