/**
 * 会员中心「设备会话」路由（从 publish-api-server 抽出）。
 *
 * 为什么单独成文件：
 *   ① publish-api-server.js 已被 max-lines 的 targets 点名（零增长容差），
 *      新逻辑塞回去必然顶破上限；
 *   ② 这两条路由的安全规则可以独立被测（归属校验 / 不许踢当前设备）。
 */
const SESSION_ID_PATTERN = /^ses-[a-f0-9]{32}$/

/** 设备会话列表 + is_current 打标（方案 P1-4 / C1-13）。 */
async function handleListSessions(server, req, res, repository, userId) {
  const deviceId = server._deviceIdFrom(req)
  const rows = await repository.listActiveSessions(userId)
  // 命中 ⇒ 该行 true；无头/未知 ⇒ 全 false（**合法态**，客户端显示中性态，不回退顺序猜测）
  server._json(res, 200, { sessions: rows.map((row) => ({ ...row, is_current: !!deviceId && row.device_id === deviceId })) })
}

/**
 * 单设备下线（2026-10-26）。
 *
 * 两条安全红线：
 *   ① **归属校验写进仓储查询条件**（id + user_id + 未作废）：拿别人的 id 来请求
 *      查不到 ⇒ 404。**不用 403**——403 等于确认「这个 id 真实存在、只是不属于你」，
 *      是一个存在性探针。
 *   ② **不许踢当前设备**：否则用户点错一下就把自己登出，且没有任何解释。
 */
async function handleRevokeOneSession(server, req, res, repository, userId) {
  const body = await server._parseBody(req)
  const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    server._json(res, 400, { error: 'SESSION_ID_INVALID' })
    return
  }
  const currentDeviceId = server._deviceIdFrom(req)
  if (!currentDeviceId) {
    // 没有当前设备标识就无法判定「这一行是不是你自己」⇒ 宁可拒绝
    server._json(res, 400, { error: 'DEVICE_ID_REQUIRED' })
    return
  }
  const session = typeof repository.getSession === 'function'
    ? await repository.getSession(userId, sessionId)
    : null
  if (!session) {
    server._json(res, 404, { error: 'SESSION_NOT_FOUND' })
    return
  }
  if (session.device_id === currentDeviceId) {
    server._json(res, 400, { error: 'CANNOT_REVOKE_CURRENT_DEVICE' })
    return
  }
  server._json(res, 200, { revoked: await repository.revokeSession(userId, sessionId) })
}

module.exports = { SESSION_ID_PATTERN, handleListSessions, handleRevokeOneSession }
