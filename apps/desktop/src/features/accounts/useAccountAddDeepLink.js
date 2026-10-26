/**
 * useAccountAddDeepLink — 首页「添加账号」深链的唯一实现
 *
 * 首页按钮的语义是「我要添加账号」，不是「打开账号页」。若只 router.push('/accounts')，
 * 用户落到只读列表后还要再点一次右上角按钮 —— 本 composable 把这一步接上。
 *
 * 参数合同：`/accounts?action=add-account`（精确匹配）。
 * 消费后立即 router.replace 删除 action（保留 tab 等其它参数），
 * 目的：刷新/后退不重复弹层；关闭浮层后地址栏是干净的账号页 URL。
 *
 * 失败口径：replace 失败不影响已打开的浮层（弹层是用户意图，导航清理只是卫生），
 * 仅 reportError 留痕，不向用户弹错。
 */
import { watch } from 'vue'
import { reportError } from '@/utils/report-error'

export const ADD_ACCOUNT_ACTION = 'add-account'

/**
 * @param {object} deps
 * @param {object} deps.route vue-router useRoute()
 * @param {object} deps.router vue-router useRouter()
 * @param {{value: boolean}} deps.showAddDialog 账号页添加账号浮层可见性
 */
export function useAccountAddDeepLink ({ route, router, showAddDialog }) {
  watch(
    () => route?.query?.action,
    (rawAction) => {
      // Vue Router 对重复参数返回数组；精确匹配取首值，避免 `/accounts?action=add-account&action=x`
      // 这类手改 URL 静默不弹层。
      const action = Array.isArray(rawAction) ? rawAction[0] : rawAction
      if (action !== ADD_ACCOUNT_ACTION) return
      showAddDialog.value = true
      const { action: _consumed, ...rest } = route.query || {}
      Promise.resolve(router.replace({ path: '/accounts', query: rest }))
        .catch((error) => reportError('accounts add-account deep link cleanup failed', error))
    },
    { immediate: true },
  )
}
