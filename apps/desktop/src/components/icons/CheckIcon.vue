<script setup>
// 图标几何取自 Lucide（https://lucide.dev，ISC License）的 check：一条折线对勾。
defineProps({ size: { type: [Number, String], default: 16 } })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
</template>
