'use strict'
/**
 * 010 订阅段链的开发态建表语句。
 *
 * 为什么单独成文件：这些语句直接追加进 `postgres-identity-repository.js` 的 `SCHEMA`
 * 会把那个文件从 438 行推过 500 行，顶破仓库 `maxFileLines` 债务基线。
 * 抬高基线掩盖自己引入的债务是明确禁止的，所以按既有 `payment-schema.js` /
 * `credit-schema.js` 拆分先例单独立文件。
 *
 * **与 `migrations/postgresql/010_subscription_segments.sql` 的 DDL 必须逐字一致**
 * （单向比对：迁移 → 本数组，忽略空白；口径同 004/005/006/008）。
 * 防漂移锁见 `test/subscription-segments-migrations.test.js`。
 * 迁移侧的 SQL 注释**不镜像**进来 —— 比对口径只对迁移侧去注释，带入会造成永久假红。
 *
 * 语义边界（为什么与 identity_subscriptions 分表）：
 *   · identity_subscriptions = **当前生效段的一行投影**（一行一用户，可被覆盖）；
 *   · identity_subscription_segments = **段链本体**（一行一段，只增不改）。
 *   混在一张表 ⇒ 要么装不下「排队中的段」，要么在覆盖时丢掉旧段（= 现状那条「高档码吃掉
 *   旧档剩余时长」的缺陷）。
 *
 * 落表的段链字段口径（规格 §2.2）：
 *   · `duration_days` = **面值**（天），一经写入永不修改；
 *   · `remaining_ms`   = **被挤下那一刻的剩余**（毫秒），与面值是**两个不同的量**
 *     （规格 I3）⇒ 不得互相覆盖或折算；
 *   · `seq`            = **链序的唯一真源**（规格 I6）⇒ 读链必须 ORDER BY seq。
 */

const SEGMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS identity_subscription_segments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('standard', 'pro')),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 36500),
    seq BIGINT NOT NULL CHECK (seq > 0),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'consumed')),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    remaining_ms BIGINT CHECK (remaining_ms IS NULL OR remaining_ms >= 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('redeem', 'payment', 'grant')),
    source_reference TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_identity_subscription_segments_source_reference UNIQUE (source_reference),
    CONSTRAINT uq_identity_subscription_segments_user_seq UNIQUE (user_id, seq) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((period_start IS NULL AND period_end IS NULL) OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start)),
    CHECK (status <> 'queued' OR (period_start IS NULL AND period_end IS NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_subscription_segments_one_active
    ON identity_subscription_segments (user_id) WHERE status = 'active'`,
  `CREATE INDEX IF NOT EXISTS idx_identity_subscription_segments_user
    ON identity_subscription_segments (user_id, seq)`,
]

module.exports = { SEGMENT_SCHEMA }
