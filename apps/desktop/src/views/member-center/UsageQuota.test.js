import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// 与会员中心其余测试同型：t 直接回 key，便于断言「用了哪个 locale 键」
// 而不是断言某段中文（中文会随文案调整而变，键才是契约）。
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))

async function mountUsage(quota) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  identityStore.entitlement = quota === undefined ? null : { plan: 'pro', quota }
  const Component = (await import('./UsageQuota.vue')).default
  return mount(Component, { global: { plugins: [pinia] } })
}

describe('UsageQuota 额度本地化', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('已知 quota 键走 locale，不把裸英文键丢给用户', async () => {
    const wrapper = await mountUsage({ cloud_publish_monthly: 1500, video_create_monthly: 20 })
    const labels = wrapper.findAll('.member-center-quota-label').map((n) => n.text())
    expect(labels).toEqual([
      'memberCenter.quota.cloud_publish_monthly',
      'memberCenter.quota.video_create_monthly',
    ])
  })

  it('未知 quota 键原样回退（服务端加新键时不开天窗、也不显示空白）', async () => {
    const wrapper = await mountUsage({ brand_new_metric: 7 })
    expect(wrapper.findAll('.member-center-quota-label').map((n) => n.text())).toEqual(['brand_new_metric'])
  })

  it('-1 显示「不限」而不是 -1（plan-matrix 的 UNLIMITED 语义）', async () => {
    const wrapper = await mountUsage({ cloud_publish_monthly: -1 })
    expect(wrapper.findAll('.member-center-quota-value').map((n) => n.text())).toEqual([
      'memberCenter.quotaUnlimited',
    ])
  })

  it('数值与对象分别格式化：数字转字符串、对象 JSON、null 被过滤', async () => {
    const wrapper = await mountUsage({ cloud_publish_monthly: 0, extra: { a: 1 }, skipped: null })
    const values = wrapper.findAll('.member-center-quota-value').map((n) => n.text())
    expect(values).toEqual(['0', '{"a":1}'])
  })

  it('无 entitlement 时显示空态', async () => {
    const wrapper = await mountUsage(undefined)
    expect(wrapper.find('[data-testid="member-center-quota-empty"]').exists()).toBe(true)
  })
})
