-- 010 订阅段链：订阅的唯一事实源（见 01-docs/PRD-SUBSCRIPTION-SEGMENTS-2026-10-25.md §2/§3）。
--
-- 动机（实测自 packages/api-publish-engine/src/auth/postgres-commerce-store.js @ main）：
--   · :112-116 只在「请求档位更低」时保旧档位（**只压档位**）；
--   · :130 / :133 的 base / periodEnd 是**时长无条件直加**；
--   ⇒ pro 用户兑一张 standard 365 天码，订阅行仍是 pro 且有效期 +365 天
--     ⇒ 一张 ¥590 的码交付了 ¥1190 的 pro 权益（**跨档套利**）。
--   本表把「档位」与「时长」解耦：**面值 = 档位 × 时长**，每段自带 plan + duration_days，
--   段与段首尾相接组成时间轴（段链）⇒ 跨档套利在结构上不可能。
--
-- ⚠ 迁移编号纪律（AGENTS.md「迁移编号的唯一性纪律」）：
--   · 主干已占用 002/003/004/005/006/008/009；**007 预留给 compute-key-envelope-migration**；
--     008 已被 credit_ledger 占用 ⇒ 本文件用 **010**（开工当天已重查：37 个在飞 PR 无一占用）。
--   · 台账按「完整文件名 + checksum」双向锁定 ⇒ **同号不同名不撞台账**，但**同名改内容即撞 checksum**。
--   · 迁移按**文件名字母序**执行（postgres-migrations.js 的 sort(localeCompare)）⇒
--     本表只外键引用 002 建的 identity_users ⇒ 与 008/009 的先后无依赖。
--   · **加文件与执行必须同批部署**（allowPending:false ⇒ 拆两个 PR 中间每次启动都硬失败）。
--
-- ⚠ 本文件必须与运行时 SCHEMA 数组成对
--   （packages/api-publish-engine/src/auth/subscription-segments-schema.js）：
--   那边是**仅非生产执行**的 bootstrap 路径，写 CREATE TABLE IF NOT EXISTS。
--   两处 DDL 必须**逐字一致**（单向比对：迁移 → SCHEMA，去注释、忽略空白）。
--   防漂移锁见 packages/api-publish-engine/test/subscription-segments-migrations.test.js。
--
-- ⚠ 迁移侧的 SQL 注释**不镜像**进 SCHEMA 数组：比对口径只对迁移侧去注释，
--   镜像进来会造成永久假红（credit-schema.js 同款说明）。

BEGIN;

CREATE TABLE IF NOT EXISTS identity_subscription_segments (
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
    -- 排队中的段**不得**带时刻（规格 §2.2「排队中的段为空」这条语义在 DB 层的承载）。
    CHECK (status <> 'queued' OR (period_start IS NULL AND period_end IS NULL))
);

-- I2：任一用户至多一个 active 段（防「两个同时生效」）。
-- ⚠ 写入顺序（规格 §5.1 的 D-1 铁律，**四步且不可颠倒**）：
--   ① shiftSegmentSeq(C.seq, +1)  ← 必须**先**让位：否则后移会把刚插入的 N 一起挪走
--   ② insertQueuedSegment(N, seq=C.seq)  ← 只能插排队段（结构上无法插出生效段）
--   ③ demoteActiveSegment(C)
--   ④ activateSegment(N)
--   写反 ⇒ 本索引立刻 23505（表现为「每次高档兑换都 500」）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_subscription_segments_one_active
    ON identity_subscription_segments (user_id) WHERE status = 'active';

-- 读链入口：按用户 + 链序。链序的唯一真源是 seq 列（规格 I6）⇒ **不得**用 created_at 代替。
CREATE INDEX IF NOT EXISTS idx_identity_subscription_segments_user
    ON identity_subscription_segments (user_id, seq);

COMMIT;
