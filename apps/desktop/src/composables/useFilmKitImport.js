// @ts-check
/**
 * useFilmKitImport — 影视工程「资产导入」（PR-3b · F-J 写路径）的渲染端状态
 *
 * 从 `useFilmEngineering.js` 拆出（**按职责**：导入是独立写路径，混在浏览 composable 里
 * 会把那个文件顶过 `check-max-lines` 的 500 行硬限）。
 *
 * 契约：
 *   - **无参数**调用导入：路径只能由主进程的原生对话框返回（renderer 不能指定替换内容）；
 *   - 失败时主进程回传 `errorCode`（= 方案 §五 的 reason 闭集值）⇒ 渲染端**分桶本地化**
 *     （不把裸 code 甩给用户），并按 `recoveryState` 给出**可执行的恢复步骤**；
 *   - **取消不算失败**：不弹错误提示。
 */
import { ref, computed } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { formatUserError } from '@/utils/user-facing-error'
import i18n from '@/i18n'
import { useNotify } from './useNotify'

// ⚠ 第二个参数（插值参数）**必须透传**：初版写成 `const t = (key) => i18n.global.t(key)`
//   ⇒ 恢复指引里的 `{path}` **永远不会被替换** ⇒ 用户看到的是字面量「{path}」。
const t = (key, params) => (params === undefined ? i18n.global.t(key) : i18n.global.t(key, params))

/** 失败原因（主进程 reason 闭集）→ i18n 桶（6 个） */
const IMPORT_REASON_BUCKETS = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION',
  NOT_A_DIRECTORY: 'VALIDATION',
  PATH_ESCAPE: 'VALIDATION',
  SYMLINK_REJECTED: 'VALIDATION',
  HARDLINK_REJECTED: 'VALIDATION',
  HIDDEN_NAME_REJECTED: 'VALIDATION',
  EXT_NOT_ALLOWED: 'VALIDATION',
  MAGIC_MISMATCH: 'VALIDATION',
  SIZE_EXCEEDED: 'VALIDATION',
  SOURCE_OVERLAPS_TARGET: 'VALIDATION',
  LOCK_CREATE_FAILED: 'LOCK',
  LOCK_HELD: 'LOCK',
  AUDIT_UNAVAILABLE: 'AUDIT',
  SWAP_FAILED: 'SWAP',
  ROLLBACK_FAILED: 'SWAP',
  PARENT_NOT_WRITABLE: 'PERM',
  UNAUTHORIZED_SENDER: 'UNAUTHORIZED',
})

/**
 * 残留档位 → 恢复指引 i18n 键。
 *
 * ⚠ `BAK_LEFT` 已随 change `kit-import-rollback-and-template-health` 退役：
 * 成功路径**不再删除**本次 `.bak`（它保留为「上一版」），所以「删 `.bak` 失败」这一档不可能产生。
 * 保留一条永不命中的映射 = 装饰性判据 ⇒ 删掉，而不是「以防万一」。
 * 「上一版备份」是**正常态**，用 `kitImportBackupHint` 表达（不是恢复指引）。
 */
const RECOVERY_KEYS = Object.freeze({
  PRE_SWAP: 'recoverLock',
  MISSING_KIT: 'recoverMissing',
  LOCK_LEFT: 'recoverLock',
})

export function useFilmKitImport (options) {
  const opts = options || {}
  const onImported = typeof opts.onImported === 'function' ? opts.onImported : () => {}
  const { notifyWarning, notifySuccess } = useNotify()

  /** 导入中（入口禁用 + 不可中断模态） */
  const importing = ref(false)
  /** 体检中（入口禁用；**只读**，不涉及任何写路径状态） */
  const inspecting = ref(false)
  /**
   * 最近一次体检报告（change: kit-asset-health-report）。
   * `null` = 还没体检 / 已重置；字段契约见 `SCHEMA.md` 十二、资产体检契约。
   */
  const inspection = ref(null)
  /** 最近一次失败的原因（reason 闭集值） */
  const kitImportReason = ref('')
  /** 最近一次失败的恢复路径（主进程回传，可能为空） */
  const kitImportRecoveryPath = ref('')
  /** 最近一次失败的残留档位（PRE_SWAP / MISSING_KIT / LOCK_LEFT） */
  const kitImportRecoveryState = ref('')
  /**
   * 上一版备份目录（change `kit-import-rollback-and-template-health`）。
   * ⚠ 这是**正常态**（导入成功的产物），不是残留：不弹告警、不要求任何动作，
   *   只在界面上告诉用户「旧资产还在，想回退可以手动改名」。
   */
  const kitImportBackupPath = ref('')
  /** 清理**更早**备份失败时的原文（`''` = 清干净了）；不阻断 */
  const kitImportStaleWarning = ref('')

  /**
   * 上一版备份提示文案（正常态，不是恢复指引）。
   * 路径来自主进程回传的 `previousBackup.path`；空 ⇒ 空串（没备份可说不说）。
   */
  const kitImportBackupHint = computed(() => {
    const p = kitImportBackupPath.value
    if (!p) return ''
    return t('filmEngineering.filmKitImport.backupKept', { path: p })
  })

  /** 失败原因 → 本地化桶文案 */
  function importReasonText (reason) {
    const bucket = IMPORT_REASON_BUCKETS[reason] || 'VALIDATION'
    return t('filmEngineering.filmKitImport.reason.' + bucket)
  }

  /** 恢复指引文案（按残留档位；无 ⇒ 空串） */
  const kitImportRecoveryHint = computed(() => {
    const key = RECOVERY_KEYS[kitImportRecoveryState.value]
    if (!key) return ''
    return t('filmEngineering.filmKitImport.' + key, { path: kitImportRecoveryPath.value || '' })
  })

  /**
   * 执行**资产体检**（只读）。导入前的预览：先看会得到什么，再决定要不要替换。
   *
   * 语义（与「导入」严格区分）：
   *   - 只读：主进程不建锁、不写审计、不落盘 ⇒ 这里**不**触碰 `importing` / 恢复档位等写路径状态；
   *   - 取消目录选择 ⇒ 返回 false 且**不弹任何提示**（与「导入取消」同口径）；
   *   - 失败 ⇒ 弹提示并返回 false，`inspection` 保持 `null`（**不**把失败伪装成一份空报告）。
   * @returns {Promise<boolean>} 是否拿到了报告
   */
  async function inspectAssets () {
    const api = (getApi() || {}).filmEngineering
    if (!api || typeof api.inspectKit !== 'function') {
      notifyWarning('filmEngineering.assetManager.inspectFailed', {
        message: t('filmEngineering.noDesktopWarning'),
      })
      return false
    }
    inspecting.value = true
    try {
      const res = await api.inspectKit()
      if (res && res.code === 0) {
        if (res.data && res.data.cancelled) return false // 取消不算失败
        inspection.value = res.data || null
        return !!inspection.value
      }
      const reason = (res && res.errorCode) || 'VALIDATION_ERROR'
      notifyWarning('filmEngineering.assetManager.inspectFailed', {
        message: t('filmEngineering.assetManager.inspectFailed', { reason: inspectReasonText(reason) }),
      })
      return false
    } catch (e) {
      notifyWarning('filmEngineering.assetManager.inspectFailed', {
        message: formatUserError(e, {
          fallback: t('filmEngineering.assetManager.inspectFailed', { reason: inspectReasonText('VALIDATION_ERROR') }),
        }).message,
      })
      return false
    } finally {
      inspecting.value = false
    }
  }

  /** 丢弃当前报告（关闭对话框 / 导入完成后） */
  function resetInspection () {
    inspection.value = null
  }

  /** 体检失败原因 → 本地化桶文案（只两个桶：不是目录 / 内容不符合） */
  function inspectReasonText (reason) {
    const bucket = reason === 'NOT_A_DIRECTORY' ? 'NOT_A_DIRECTORY' : 'VALIDATION'
    return t('filmEngineering.assetManager.reason.' + bucket)
  }

  /**
   * 执行导入。
   * @returns {Promise<boolean>} 是否导入成功（取消 ⇒ false，且**不算失败**）
   */
  async function importKitAssets () {
    const api = (getApi() || {}).filmEngineering
    if (!api || typeof api.importKit !== 'function') {
      notifyWarning('filmEngineering.filmKitImport.failed', {
        message: t('filmEngineering.noDesktopWarning'),
      })
      return false
    }
    importing.value = true
    kitImportReason.value = ''
    kitImportRecoveryPath.value = ''
    kitImportRecoveryState.value = ''
    kitImportBackupPath.value = ''
    kitImportStaleWarning.value = ''
    try {
      const res = await api.importKit()
      if (res && res.code === 0) {
        if (res.data && res.data.cancelled) {
          // 取消**不算失败**（不弹错误提示）
          return false
        }
        const data = res.data || {}
        notifySuccess('filmEngineering.filmKitImport.success', {
          message: t('filmEngineering.filmKitImport.success', { count: data.fileCount || 0 }),
        })
        // ⚠ **成功也可能带残留**（锁未删）⇒ 导入已生效，但现场要用户手动清
        //   （2026-10-23 验证层外部评审 claude i3 / codex i6 修：初版成功路径完全无视残留）
        if (data.recoveryState) {
          kitImportRecoveryPath.value = data.recoveryPath || ''
          kitImportRecoveryState.value = data.recoveryState
          notifyWarning('filmEngineering.filmKitImport.residue', {
            message: t('filmEngineering.filmKitImport.' + (RECOVERY_KEYS[data.recoveryState] || 'recoverLock'), {
              path: data.recoveryPath || '',
            }),
          })
        }
        // 上一版备份：**正常态**，只记下来给界面显示（不弹告警 —— 弹了就是「成功还报错」）
        if (data.previousBackup && data.previousBackup.path) {
          kitImportBackupPath.value = data.previousBackup.path
        }
        // 清理更早备份失败：本次已生效，但这件事不能静默（否则备份会无声堆积）
        if (data.staleWarning) {
          kitImportStaleWarning.value = String(data.staleWarning)
        }
        // ⚠ 审计结果行没落盘 ⇒ 导入已生效但审计不完整 ⇒ **显式告知**（不静默）
        if (data.auditWritten === false) {
          notifyWarning('filmEngineering.filmKitImport.auditLost', {
            message: t('filmEngineering.filmKitImport.auditLost'),
          })
        }
        await onImported()
        return true
      }
      const reason = (res && res.errorCode) || 'VALIDATION_ERROR'
      kitImportReason.value = reason
      kitImportRecoveryPath.value = (res && res.data && res.data.recoveryPath) || ''
      kitImportRecoveryState.value = (res && res.data && res.data.recoveryState) || ''
      notifyWarning('filmEngineering.filmKitImport.failed', {
        message: t('filmEngineering.filmKitImport.failed', { reason: importReasonText(reason) }),
      })
      // ⚠ **失败路径**的审计行没落盘 ⇒ 同样要显式告知（不静默）
      //   （2026-10-23 验证层外部评审 claude i1 / codex i6）
      if (res && res.data && res.data.auditWritten === false) {
        notifyWarning('filmEngineering.filmKitImport.auditLost', {
          message: t('filmEngineering.filmKitImport.auditLost'),
        })
      }
      return false
    } catch (e) {
      notifyWarning('filmEngineering.filmKitImport.failed', {
        message: formatUserError(e, {
          fallback: t('filmEngineering.filmKitImport.failed', { reason: importReasonText('VALIDATION_ERROR') }),
        }).message,
      })
      return false
    } finally {
      importing.value = false
    }
  }

  return {
    importing,
    inspecting,
    inspection,
    inspectAssets,
    resetInspection,
    inspectReasonText,
    kitImportReason,
    kitImportRecoveryPath,
    kitImportRecoveryState,
    kitImportRecoveryHint,
    kitImportBackupPath,
    kitImportBackupHint,
    kitImportStaleWarning,
    importKitAssets,
    importReasonText,
  }
}
