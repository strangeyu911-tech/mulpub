import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { useAccountSelection } from './useAccountSelection'

const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh: { automation: {
  wfAccountExpired: '过期', wfAccountInactive: '停用',
} } }, missingWarn: false, fallbackWarn: false })

function setup (accounts, initial = []) {
  let api
  const Comp = {
    setup () {
      const accountsRef = ref(accounts)
      const targets = ref(initial)
      const meta = ref({ platforms: [{ id: 'bilibili', label: 'B站' }, { id: 'zhihu', label: '知乎' }] })
      api = useAccountSelection({ accounts: accountsRef, targets, meta })
      return () => null
    },
  }
  mount(Comp, { global: { plugins: [i18n] } })
  return api
}

describe('useAccountSelection · 同平台多账号自由选择', () => {
  it('同平台两个账号都进入分组，numeric 0 不被当成空', () => {
    const api = setup([
      { id: 0, platform: 'bilibili', name: '账号0', status: 'active' },
      { id: 1, platform: 'bilibili', name: '账号1', status: 'active' },
      { id: 2, platform: 'zhihu', name: '知乎号', status: 'expired' },
    ])
    expect(api.accountGroups.value[0].accounts.map((a) => a.id)).toEqual([0, 1])
    expect(api.usableCount.value).toBe(2)
    expect(api.unusableCount.value).toBe(1)
  })

  it('toggle 可同时选中同平台两个账号，再点取消', () => {
    const api = setup([
      { id: 'a1', platform: 'bilibili', name: 'A1' },
      { id: 'a2', platform: 'bilibili', name: 'A2' },
    ])
    api.toggleAccount(api.accountGroups.value[0].accounts[0])
    api.toggleAccount(api.accountGroups.value[0].accounts[1])
    expect(api.selectedCount.value).toBe(2)
    expect(api.targets.value).toEqual([
      { platform: 'bilibili', accountId: 'a1' },
      { platform: 'bilibili', accountId: 'a2' },
    ])
    api.toggleAccount(api.accountGroups.value[0].accounts[0])
    expect(api.targets.value).toEqual([{ platform: 'bilibili', accountId: 'a2' }])
  })

  it('搜索按账号名过滤，全选只加可用账号', () => {
    const api = setup([
      { id: 'a1', platform: 'bilibili', name: '科技号' },
      { id: 'a2', platform: 'bilibili', name: '生活号', status: 'expired' },
    ])
    api.accountSearch.value = '科技'
    expect(api.filteredAccountGroups.value[0].accounts).toHaveLength(1)
    api.selectAllVisible()
    expect(api.targets.value).toEqual([{ platform: 'bilibili', accountId: 'a1' }])
  })
})
