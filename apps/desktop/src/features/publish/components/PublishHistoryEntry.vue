<template>
  <button
    type="button"
    class="cohere-btn cohere-btn-secondary publish-history-entry"
    data-testid="publish-open-history"
    @click="openHistory"
  >
    <el-icon :size="15" aria-hidden="true"><Tickets /></el-icon>
    <span>{{ t('publishPage.publishHistory') }}</span>
  </button>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Tickets } from '@element-plus/icons-vue'

const { t } = useI18n()
const router = useRouter()

function openHistory () {
  router.push('/publish/history')
}
</script>

<style scoped>
.publish-history-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.publish-history-entry:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
  transition: outline-color 0s, outline-width 0s, outline-offset 0s;
}

@media (max-width: 900px) {
  .publish-history-entry { order: 4; }
}
</style>
