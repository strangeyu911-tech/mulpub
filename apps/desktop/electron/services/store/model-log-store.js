// @ts-check
/**
 * model-log-store — 模型供应商调用日志功能域 mixin（Phase 2+）
 *
 * 表：model_provider_logs
 * 依赖：logger
 */
const log = require('../logger')
// ★ 维度提取放在**存储层**：它是「这张表有哪些列」的归属。
//   形状假设集中在 usage-dimensions.js 这一个纯函数里（可逐条钉死）。
//   ⚠ 为什么不放在 model-provider-manager：那个文件在门禁「点名还账」清单里
//   （target 1284、容差 0）且「require 扇出」是**只降不升**的债务棘轮
//   ⇒ 在那里抽模块会同时踩两条门禁；挂在存储层则两条都不碰。
const { extractUsageDimensions } = require('../usage-dimensions')

module.exports = {
  /**
   * 写入模型供应商调用日志
   * @param {object} entry - 日志条目
   * @param {string} entry.provider_id - 供应商 ID（必填）
   * @param {string} entry.category - 类别 llm/tts/image/video/audio（必填）
   * @param {string} entry.action - 动作 chat/tts/image/video/test（必填）
   * @param {string} entry.status - 状态 success/error/timeout（必填）
   * @param {string} [entry.model] - 模型名
   * @param {number} [entry.latency_ms] - 延迟毫秒
   * @param {number} [entry.tokens_in] - 输入 token 数
   * @param {number} [entry.tokens_out] - 输出 token 数
   * @param {number} [entry.cost] - 调用成本
   * @param {string} [entry.error_message] - 错误消息
   * @param {string} [entry.spec] - 请求侧规格（分辨率等）；价格卡按 spec 精确匹配
   * @param {number} [entry.duration_seconds] - 产出秒数（视频/音频）
   * @param {number} [entry.item_count] - 产出张数（图像）
   * @param {number} [entry.char_count] - 产出字符数（语音）
   * @param {number} [entry.byok] - 1 = 用户自带 Key（官方算力不担成本）；缺省按 1
   * @param {object} [entry.params] - 请求侧参数（供抽 spec / 时长 / 张数 / 字符数）
   * @param {object} [entry.result] - 适配器响应（供抽官方 usage 里的权威用量）
   * @returns {boolean} 写入成功返回 true，store 未就绪返回 false
   */
  addProviderLog (entry) {
    if (!this._ready) return false
    if (!entry || !entry.provider_id || !entry.category || !entry.action || !entry.status) {
      log.warn('Store', 'addProviderLog: missing required fields')
      return false
    }
    try {
      // ★ 用量维度：从请求侧参数 + 适配器响应里抽（权威来源优先，抽不到就是 0）
      const dims = extractUsageDimensions({ params: entry.params, result: entry.result })
      const spec = entry.spec != null && entry.spec !== '' ? entry.spec : dims.spec
      this.db.prepare(`
        INSERT INTO model_provider_logs
          (provider_id, category, model, action, status, latency_ms, tokens_in, tokens_out, cost, error_message, created_at, spec, duration_seconds, item_count, char_count, byok)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
      `).run(
        entry.provider_id,
        entry.category,
        entry.model || null,
        entry.action,
        entry.status,
        entry.latency_ms != null ? entry.latency_ms : null,
        entry.tokens_in != null ? entry.tokens_in : null,
        entry.tokens_out != null ? entry.tokens_out : null,
        entry.cost != null ? entry.cost : null,
        entry.error_message || null,
        spec != null && spec !== '' ? spec : null,
        entry.duration_seconds != null ? entry.duration_seconds : dims.duration_seconds || null,
        entry.item_count != null ? entry.item_count : dims.item_count || null,
        entry.char_count != null ? entry.char_count : dims.char_count || null,
        // ⚠ byok 缺省必须是 1（用户自带 Key ⇒ 官方算力不扣积分）：
        //   给用户错扣比不扣更糟 ⇒ 缺省方向是「不扣」。
        entry.byok === 0 ? 0 : 1,
      )
      return true
    } catch (e) {
      log.warn('Store', 'addProviderLog failed: ' + e.message)
      return false
    }
  },

  /**
   * 查询模型供应商调用日志
   * @param {object} [filter={}] - 过滤条件
   * @param {string} [filter.provider_id] - 按供应商 ID 过滤
   * @param {string} [filter.category] - 按类别过滤
   * @param {string} [filter.status] - 按状态过滤
   * @param {number} [filter.limit=100] - 返回条数上限
   * @returns {Array} 日志记录数组，store 未就绪返回空数组
   */
  getProviderLogs (filter = {}) {
    if (!this._ready) return []
    const { provider_id, category, status, limit = 100 } = filter
    const conditions = []
    const params = []
    if (provider_id) { conditions.push('provider_id = ?'); params.push(provider_id) }
    if (category) { conditions.push('category = ?'); params.push(category) }
    if (status) { conditions.push('status = ?'); params.push(status) }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
    const sql = `SELECT * FROM model_provider_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`
    params.push(limit)
    try {
      return this.db.prepare(sql).all(...params)
    } catch (e) {
      log.warn('Store', 'getProviderLogs failed: ' + e.message)
      return []
    }
  },

  /**
   * 清理指定天数前的调用日志
   * @param {number} [days=30] - 保留最近 N 天的日志
   * @returns {number} 删除的行数，store 未就绪返回 0
   */
  cleanProviderLogs (days = 30) {
    if (!this._ready) return 0
    try {
      const result = this.db.prepare(
        `DELETE FROM model_provider_logs WHERE created_at < datetime('now', ?)`
      ).run(`-${days} days`)
      return result.changes || 0
    } catch (e) {
      log.warn('Store', 'cleanProviderLogs failed: ' + e.message)
      return 0
    }
  },
}
