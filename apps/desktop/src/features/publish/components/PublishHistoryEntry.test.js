import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

import PublishHistoryEntry from './PublishHistoryEntry.vue'

function mountEntry () {
  return mount(PublishHistoryEntry, { global: { plugins: [i18n] } })
}

describe('PublishHistoryEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh'
  })

  it('渲染为原生按钮，文案与可访问名一致', () => {
    const w = mountEntry()
    const button = w.get('[data-testid="publish-open-history"]')

    expect(button.element.tagName).toBe('BUTTON')
    expect(button.text()).toContain('发布记录')
    expect(button.attributes('type')).toBe('button')
  })

  it('点击进入发布记录页', async () => {
    const w = mountEntry()
    await w.get('[data-testid="publish-open-history"]').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/publish/history')
  })

  it('英文界面显示 Publish History', () => {
    i18n.global.locale.value = 'en'
    try {
      const w = mountEntry()
      expect(w.get('[data-testid="publish-open-history"]').text()).toContain('Publish History')
    } finally {
      i18n.global.locale.value = 'zh'
    }
  })
})
