// @vitest-environment node
'use strict'
import { describe, expect, it, vi } from 'vitest'

const { beginModelQuotaRun, endModelQuotaRun, modelQuotaOverridesFor } = require('./model-quota-pipeline-hooks')
const { ProviderRunContext } = require('./provider-run-context')

describe('model-quota-pipeline-hooks', () => {
  it('beginModelQuotaRun 用 run.context 的 ProviderRunContext 注册 run', () => {
    const runtime = { beginRun: vi.fn(), endRun: vi.fn() }
    const engine = { modelQuotaRuntime: runtime, log: { warn: vi.fn() } }
    const run = { id: 'run-1', context: { modelSourceOverrides: { image: { source: 'official' } } } }
    beginModelQuotaRun(engine, run)
    expect(runtime.beginRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      runContext: expect.any(ProviderRunContext),
      overrides: { image: { source: 'official' } },
    }))
  })

  it('没有 runtime 时静默跳过', () => {
    expect(() => beginModelQuotaRun({}, { id: 'run-1' })).not.toThrow()
  })

  it('modelQuotaOverridesFor 只返回当前 run 的官方覆盖', () => {
    const engine = {
      modelQuotaRuntime: {
        getContext: () => ({ getModelSourceOverrides: () => ({ image: { source: 'official' } }) }),
      },
    }
    expect(modelQuotaOverridesFor(engine, { id: 'run-1' })).toEqual({ image: { source: 'official' } })
    expect(modelQuotaOverridesFor({}, { id: 'run-1' })).toBeNull()
  })

  it('endModelQuotaRun 清理 run；runtime 抛错只 warn', () => {
    const runtime = { endRun: vi.fn(() => { throw new Error('boom') }) }
    const warn = vi.fn()
    endModelQuotaRun({ modelQuotaRuntime: runtime, log: { warn } }, { id: 'run-1' })
    expect(runtime.endRun).toHaveBeenCalledWith('run-1')
    expect(warn).toHaveBeenCalled()
  })
})
