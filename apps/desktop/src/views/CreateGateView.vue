<template>
  <MemberFeatureGate feature-key="video_create" :title="t('memberCenter.videoCreateTitle')">
    <CreateView />
  </MemberFeatureGate>
</template>

<script setup>
/**
 * CreateGateView — `/create` 的会员功能门禁壳（P1-1）。
 *
 * 为什么包一层而不是改 CreateView 根模板：
 * - CreateView 已 5299 行，行数门禁只剩有限增长余量；在根模板加 v-if 会把
 *   门禁逻辑、锁定页、i18n 一起塞进超大文件。
 * - 锁定态不应挂载 CreateView：它的 mounted 会拉流水线列表/渲染状态，
 *   免费用户看到「加载完再被挡住」既不诚实也浪费 IPC。
 */
import { useI18n } from 'vue-i18n'
import CreateView from './CreateView.vue'
import MemberFeatureGate from '@/features/member/components/MemberFeatureGate.vue'

const { t } = useI18n()
</script>
