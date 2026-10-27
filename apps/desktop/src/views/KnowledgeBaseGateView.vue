<template>
  <MemberFeatureGate feature-key="knowledge_base" :title="t('memberCenter.knowledgeBaseTitle')">
    <KnowledgeBasePage />
  </MemberFeatureGate>
</template>

<script setup>
/**
 * KnowledgeBaseGateView — `/knowledge-base` 的会员功能门禁壳（P1-2）。
 *
 * 与 CreateGateView 同构：锁定态不挂载 KnowledgeBasePage，避免免费用户
 * 先触发知识库列表/同步等 IPC 再被挡。
 */
import { useI18n } from 'vue-i18n'
import KnowledgeBasePage from './KnowledgeBasePage.vue'
import MemberFeatureGate from '@/features/member/components/MemberFeatureGate.vue'

const { t } = useI18n()
</script>
