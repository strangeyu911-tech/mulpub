<template>
  <!--
    全局更新提示宿主（App.vue 全局唯一实例）
    - 新版本入口统一收敛到侧边栏底部「新版本」按钮（SidebarUpdateButton），此处不再弹窗打断用户
    - 本组件只保留「结果提示」：当前已最新 / 更新失败，并负责启动更新监听（start/cleanup）
  -->
  <div v-if="showNotAvailable" class="update-notice" data-testid="update-not-available">
    <UiInlineNotice
      :text="t('update.latestVersion')"
      :close-label="t('update.latestVersionClose')"
      test-id="update-not-available-toast"
    />
  </div>
  <div v-if="showError" class="update-notice" data-testid="update-error">
    <el-alert
      :title="t('update.failedPrefix') + updateError"
      type="warning"
      show-icon
      :closable="true"
      @close="showError = false"
    />
  </div>
</template>

<script setup>
/**
 * UpdateNotification —— 自动更新结果提示宿主
 *
 * 状态来源：useAutoUpdate（模块级共享单例），与侧边栏「新版本」按钮同源；
 * start()/cleanup() 由本组件持有（App 级生命周期），保证只有一处注册 update:status 监听与启动检查。
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAutoUpdate } from '@/composables/useAutoUpdate'
import UiInlineNotice from './UiInlineNotice.vue'

const { t } = useI18n()
const {
  showNotAvailable,
  showError,
  updateError,
  start: startAutoUpdate,
  cleanup: cleanupAutoUpdate,
} = useAutoUpdate()

onMounted(() => {
  startAutoUpdate()
})

onBeforeUnmount(() => {
  cleanupAutoUpdate()
})
</script>

<style>
/* 右下角提示条宿主：right 88px 避让「回到顶部」浮标占位（BackToTop 44px + 间距）。
   提示条本体样式在 UiInlineNotice.vue（inline-notice-green 2026-10-26 统一收编），
   此处只留定位。 */
.update-notice {
  position: fixed;
  bottom: 16px;
  right: 88px;
  z-index: 2000;
}
</style>
