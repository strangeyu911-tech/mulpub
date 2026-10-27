<template>
  <!--
    价目卡的「月付价 + 年付价 + 促销角标」。
    抽成组件有三个理由：
      ① Subscription.vue 已贴 500 行债务基线，模板里再长 13 行就会超限；
      ② 促销文案必须**只由服务端字段驱动**（remainingDays / exhausted），
         组件边界让「金额硬编码」在代码评审里一眼可见；
      ③ 展示规则（不划线、不展示原价）集中在一处，避免将来两处各写一套。
  -->
  <span class="member-center-plan-price" :data-testid="testId">
    <template v-if="plan.priceMonthlyCents === 0">{{ t('memberCenter.planFree') }}</template>
    <template v-else>
      {{ formatPrice(plan.priceMonthlyCents, plan.currency) }} / {{ t('memberCenter.perMonth') }}
      <!-- 决策表第 5 行：不划线、不展示原价，只出一枚活动角标 -->
      <span
        v-if="plan.promotion && plan.promotion.exhausted === false"
        class="member-center-plan-promo-badge"
        :data-testid="`${testId}-promo`"
      >（{{ t('memberCenter.planPromoBadge', { days: plan.promotion.remainingDays }) }}）</span>
      <span class="member-center-plan-yearly">
        · {{ formatPrice(plan.priceYearlyCents, plan.currency) }} / {{ t('memberCenter.perYear') }}
      </span>
    </template>
  </span>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  plan: { type: Object, required: true },
  formatPrice: { type: Function, required: true },
  testId: { type: String, default: '' },
})

const { t } = useI18n()
</script>

<style scoped>
.member-center-plan-price {
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.member-center-plan-promo-badge {
  color: #07c160;
  font-weight: 600;
}
.member-center-plan-yearly {
  color: var(--muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}
</style>
