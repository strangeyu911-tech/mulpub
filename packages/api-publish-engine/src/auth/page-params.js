/**
 * 分页参数解析（订单列表等）。
 *
 * 设计取舍：非法值**钳制**而不是 400。分页是展示细节，一个越界的 limit
 * 不该让用户看不到自己的订单；钳制同时是有界的（上限 100），不会因为
 * 客户端乱传就退化成「一次拉全量」。
 */
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function pageParams(req) {
  let params
  try {
    params = new URL(req && req.url ? req.url : '/', 'http://localhost').searchParams
  } catch {
    params = new URLSearchParams()
  }
  const limitRaw = Number(params.get('limit'))
  const offsetRaw = Number(params.get('offset'))
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0
  return { limit, offset }
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, pageParams }
