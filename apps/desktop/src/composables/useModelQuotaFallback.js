import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onModelQuotaRequired, modelQuotaDecide } from '@/api/model-quota'

/**
 * 模型额度兜底弹窗状态机（P1b-2b）。
 *
 * 数据流：
 *   main process Coordinator
 *     └─ emit('model-quota:required', payload)
 *          └─ onModelQuotaRequired → currentRequest
 *               ├─ decide('official' | 'settings' | 'cancel')
 *               └─ modelQuotaDecide({ requestId, runId, capability, decision, remember })
 *
 * requestId 一次性；decide 成功后清空 currentRequest，避免重复点击。
 */
export function useModelQuotaFallback () {
  const currentRequest = ref(null)
  const deciding = ref(false)
  const failed = ref(false)
  let unsubscribe = () => {}

  function receive (payload) {
    if (!payload || typeof payload !== 'object' || !payload.requestId) return
    currentRequest.value = payload
    failed.value = false
  }

  async function decide (decision, options = {}) {
    const request = currentRequest.value
    if (!request || deciding.value) return false
    deciding.value = true
    failed.value = false
    try {
      const res = await modelQuotaDecide({
        requestId: request.requestId,
        runId: request.runId,
        capability: request.capability,
        decision,
        remember: options.remember === true,
      })
      if (!res || res.code !== 0) {
        failed.value = true
        return false
      }
      currentRequest.value = null
      return true
    } catch (_) {
      failed.value = true
      return false
    } finally {
      deciding.value = false
    }
  }

  function useOfficial (remember = false) {
    return decide('official', { remember })
  }

  function goSettings (remember = false) {
    return decide('settings', { remember })
  }

  function cancel () {
    return decide('cancel')
  }

  onMounted(() => {
    unsubscribe = onModelQuotaRequired(receive)
  })

  onBeforeUnmount(() => {
    unsubscribe()
    unsubscribe = () => {}
    currentRequest.value = null
  })

  return {
    currentRequest,
    deciding,
    failed,
    receive,
    decide,
    useOfficial,
    goSettings,
    cancel,
  }
}
