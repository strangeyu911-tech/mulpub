import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'Publish.vue'),
  'utf8',
).replace(/\r\n/g, '\n')

describe('Publish.vue · 发布记录入口接线锁', () => {
  it('必须引入独立入口组件，而不是在视图内再复制一份按钮逻辑', () => {
    expect(SRC).toContain("import PublishHistoryEntry from '@/features/publish/components/PublishHistoryEntry.vue'")
  })

  it('发布编辑页模板必须渲染入口组件', () => {
    const template = SRC.slice(0, SRC.indexOf('\n<script'))
    expect(template).toContain('<PublishHistoryEntry />')
  })
})
