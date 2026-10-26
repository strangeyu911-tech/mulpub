<template>
  <div class="member-center-account-security">
    <section class="member-center-card">
      <div class="member-center-card-title">{{ t('memberCenter.accountCardTitle') }}</div>
      <div class="member-center-account-row">
        <span class="member-center-avatar" aria-hidden="true">{{ avatarInitial }}</span>
        <div class="member-center-account-main">
          <strong class="member-center-account-name">{{ displayName }}</strong>
          <span v-if="user?.username" class="member-center-account-username">@{{ user.username }}</span>
        </div>
        <span class="member-center-status-badge" :class="`status-${status}`">{{ statusLabel }}</span>
      </div>
      <div class="member-center-card-actions">
        <button class="cohere-btn-secondary" data-testid="member-center-switch" :disabled="loading || pending !== 'switch'" @click="handleSwitch">
          {{ pending === 'switch' ? t('memberCenter.switchingAccount') : t('memberCenter.switchAccount') }}
        </button>
        <button class="cohere-btn-secondary" data-testid="member-center-signout" :disabled="loading || pending !== 'sign-out'" @click="handleSignOut">
          {{ pending === 'sign-out' ? t('memberCenter.signingOut') : t('memberCenter.signOut') }}
        </button>
      </div>
    </section>

    <section class="member-center-card" data-testid="member-center-sessions">
      <div class="member-center-card-title">{{ t('memberCenter.sessionsTitle') }}</div>
      <div class="member-center-toolbar">
        <button class="cohere-btn-secondary" data-testid="member-center-revoke-others" :disabled="memberStore.loading || revoking || !memberStore.sessions.length" @click="handleRevoke">
          {{ revoking ? t('memberCenter.revokingOthers') : t('memberCenter.revokeOthers') }}
        </button>
      </div>
      <ul v-if="memberStore.sessions.length" class="member-center-list">
        <li v-for="(session, index) in memberStore.sessions" :key="session.id || index" class="member-center-list-item">
          <div class="member-center-list-main">
            <span class="member-center-list-title">{{ session.deviceName || session.deviceId || t('memberCenter.unknownDevice') }}</span>
            <span class="member-center-list-meta">{{ t('memberCenter.lastSeen') }}：{{ formatTimestamp(session.lastSeenAt || session.createdAt) }}</span>
          </div>
          <!--
            当前设备徽章（P1-4 + C1-13）：以主进程按 X-Device-Id 比对后下发的
            is_current 为准，**不再用 index === 0 猜服务端返回顺序**——
            服务端一旦改排序（按最近活跃等），位置猜测就会把徽章指向别人的设备。
          -->
          <!--
            当前设备徽章 + 单设备下线（2026-10-26）。
            当前设备那行**只给说明不给按钮**：服务端会 400 拒绝，UI 再挡一次，
            避免用户点一下就把自己登出且没有任何解释。
          -->
          <span v-if="session.is_current" class="member-center-status-badge" data-testid="member-center-current-device">{{ t('memberCenter.currentDevice') }}</span>
          <button
            v-else
            class="cohere-btn-secondary member-center-session-revoke"
            type="button"
            :data-testid="`session-revoke-${session.id}`"
            :disabled="revokingId === session.id"
            @click="handleRevokeOne(session)"
          >{{ revokingId === session.id ? t('memberCenter.sessionsRevokingOne') : t('memberCenter.sessionsRevokeOne') }}</button>
        </li>
      </ul>
      <!--
        合法态提示（C1-13）：没有一行被标为当前设备（当前设备未 upsert 或不在列表）
        时给出中性说明。**不回退顺序猜测**——那等于把刚修掉的 bug 请回来。
        注意它必须是独立的 v-if：列表本身常显（用户仍要看到全部设备），
        写成 ul 的 v-else-if 会永远不生效。
      -->
      <p
        v-if="memberStore.sessions.length && !hasCurrentDevice"
        class="member-center-empty-hint"
        data-testid="member-center-current-device-unknown"
      >
        {{ t('memberCenter.currentDeviceUnknown') }}
      </p>
      <div v-else-if="!memberStore.sessions.length" class="member-center-empty">
        <p class="member-center-empty-hint">{{ t('memberCenter.sessionsEmptyHint') }}</p>
      </div>
      <!-- P0-5：错误本地化展示（修复前模板不渲染 error ⇒ 点击后静默无反馈） -->
      <p v-if="memberErrorKey" class="member-center-error" role="alert">{{ t(memberErrorKey) }}</p>
      <!-- revoked 数量语义：0 ≠ 失败，要有明确反馈 -->
      <!-- 单设备下线结果（2026-10-26） -->
      <p
        v-if="oneResult"
        class="member-center-revoke-result"
        :class="'is-' + oneResult.tone"
        data-testid="session-revoke-one-result"
        role="status"
      >{{ oneResult.text }}</p>
      <p
        v-if="revokeResult"
        class="member-center-revoke-result"
        :class="'is-' + revokeResult.tone"
        :data-testid="'revoke-result'"
        role="status"
      >
        {{ revokeResult.text }}
      </p>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { useMemberStore } from '@/stores/member'
import { avatarInitialOf, statusLabelOf, formatTimestamp, resolveMemberErrorKey } from './labels'

const { t } = useI18n()
const memberStore = useMemberStore()
const { status, user, displayName, loading, switchAccount, signOut } = useIdentity()

const pending = ref(null)
const revoking = ref(false)
const revokeResult = ref(null)
// 单设备下线（2026-10-26）：revokingId 让「只有被点的那一行」进入加载态
const revokingId = ref(null)
const oneResult = ref(null)
const avatarInitial = computed(() => avatarInitialOf(displayName.value))
const statusLabel = computed(() => statusLabelOf(t, status.value))
// 是否有一行被主进程标为当前设备。列表非空但全 false 是**合法态**
// （当前设备未 upsert 或不在返回列表），模板据此显示中性提示而不是猜。
const hasCurrentDevice = computed(() => memberStore.sessions.some((s) => s && s.is_current === true))

// 未知码/空值兜底为通用失败文案，绝不透裸码。
const memberErrorKey = computed(() => (memberStore.error ? resolveMemberErrorKey(memberStore.error) : ''))

async function handleSwitch() {
  pending.value = 'switch'
  try {
    await switchAccount()
  } finally {
    pending.value = null
  }
}

async function handleSignOut() {
  pending.value = 'sign-out'
  try {
    await signOut()
  } finally {
    pending.value = null
  }
}

/**
 * 单设备下线（2026-10-26）。
 * 当前设备不渲染按钮（模板层），这里再挡一次（防御模板被改坏）。
 * 成功后 store 会重拉列表，本行自然消失——以服务端为准，不本地删行。
 */
async function handleRevokeOne(session) {
  if (!session || typeof session.id !== 'string' || !session.id || session.is_current) return
  revokingId.value = session.id
  oneResult.value = null
  try {
    const ok = await memberStore.revokeSession(session.id)
    if (ok === false) return
    oneResult.value = {
      tone: 'success',
      text: t('memberCenter.sessionsRevokeOneSuccess', {
        device: session.deviceName || session.deviceId || t('memberCenter.unknownDevice'),
      }),
    }
  } finally {
    revokingId.value = null
  }
}

async function handleRevoke() {
  revoking.value = true
  revokeResult.value = null
  try {
    const revoked = await memberStore.revokeOtherSessions()
    // 三分支：>0 成功带数量 / =0 无其他设备（info，不是失败）/ false 失败（error 区展示）
    if (revoked === false) return
    revokeResult.value = revoked > 0
      ? { tone: 'success', text: t('memberCenter.revokeSuccess', { count: revoked }) }
      : { tone: 'info', text: t('memberCenter.revokeNone') }
  } finally {
    revoking.value = false
  }
}
</script>
