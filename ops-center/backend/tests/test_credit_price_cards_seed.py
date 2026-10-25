"""价格卡种子脚本的**契约**测试 —— 幂等、不改价、拒 0 价、只读模式不建表。

为什么单独成文件：种子脚本是**运营入口**（灌价 / 查是否灌过），
它的三条硬口径此前**只写在注释和执行记录里、没有任何可执行断言**：

  ① 只插不改价（改价 = 插新行 + 旧行补 `effective_to`，禁 UPDATE 单价）；
  ② 绝不插 0 价卡（0 价会被回算静默命中 ⇒ 成本算成 0、不告警、被当「免费」）；
  ③ `--check` / `--dry-run` 是**只读**的（不建库、不建表、不写任何数据）。

⚠️ ②与③都是**实测过**的缺口：②在种子 JSON 里加一条 0 价条目即被原样插入；
③在 `OPS_DB_PATH` 配错的机器上跑 `--check` 会静默新建空库并回答「5 条待插入」
⇒ 对真实库给出错误的「是否已灌过」结论。

⚠️ 本文件**不连真实库**：只读模式用子进程跑 CLI，`OPS_DB_PATH` 指向 tmp_path。
"""
import json
import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_PATH = os.path.join(BACKEND, "seed", "model_price_cards.seed.json")
SCRIPT = os.path.join(BACKEND, "scripts", "seed_credit_price_cards.py")


def _seed_json():
    with open(SEED_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def test_seed_file_has_no_zero_or_non_integer_price():
    """种子文件里**不允许**出现 0 价（或非整数）条目。

    ⚠️ 这条不变量是「脚本守卫」的第一道：守卫在脚本里，但守卫本身也要被锁住，
    否则有人改脚本时容易把守卫一起改掉。
    """
    priced = _seed_json().get("priced", [])
    assert priced, "种子文件必须有 priced 条目"
    offenders = [
        c.get("id") for c in priced
        if not isinstance(c.get("unit_price_micros"), int) or c["unit_price_micros"] <= 0
    ]
    assert not offenders, f"种子里存在 0 价/非整数单价条目：{offenders}"


def test_zero_price_guard_rejects_zero_and_non_integer():
    """守卫本身（纯函数）必须能抓住 0 价与非整数单价。

    ⚠️ 守卫抽成模块级函数就是为了这条：不必往仓内种子文件里塞一条 0 价假数据
    （0 价卡正是本脚本要拒的东西，常驻一条等于自己违规）。
    """
    from scripts.seed_credit_price_cards import zero_price_ids

    good = [{"id": "ok", "unit_price_micros": 3000}]
    assert zero_price_ids(good) == []

    bad = [
        {"id": "zero", "unit_price_micros": 0},
        {"id": "negative", "unit_price_micros": -1},
        {"id": "float", "unit_price_micros": 3.5},
        {"id": "missing"},
    ]
    assert zero_price_ids(bad) == ["zero", "negative", "float", "missing"]


def test_seed_file_keeps_pending_out_of_the_database():
    """`pending` 一律不入库 —— 缺价必须告警，绝不填暂定数字。"""
    data = _seed_json()
    assert data.get("pending"), "种子文件必须带 pending 清单（待用户确认项）"
    for p in data["pending"]:
        assert p.get("provider_id"), p
        assert p.get("missing"), f"pending 条目必须写明缺什么：{p}"


def _run_seed(args, db_path):
    # ⚠️ **故意把子进程 stdout 编码压到 cp1252**（Windows 默认 locale 编码）。
    #   不这么做，脚本打印中文/emoji 时的 `UnicodeEncodeError` 只会在 **Windows CI** 上出现
    #   （2026-10-25 实测：`ops-center 后端测试` 红在 `test_check_mode_does_not_create_tables`
    #   ⇒ 报错 `UnicodeEncodeError: 'charmap' codec can't encode characters`）。
    #   ⇒ 本地 Linux 全绿、Windows 全红 ⇒ 「本地绿 ≠ CI 绿」的经典形态。
    #   ⇒ 把最严苛编码**固化进测试** ⇒ 任何平台都能抓到这条。
    #
    # ⚠️⚠️ **父进程必须显式 `encoding="utf-8"`**（2026-10-25 第二次踩同一个坑）：
    #   子进程的 `PYTHONIOENCODING=cp1252` 会被脚本自己的 `reconfigure(encoding="utf-8")` 覆盖
    #   ⇒ 子进程**实际输出 UTF-8 字节**；而父进程若用 locale 编码解码
    #   （Windows = cp1252，Linux = UTF-8）⇒ **Windows 上解码失败 ⇒ `result.stdout` 变 None**
    #   ⇒ 断言 `... in result.stdout` 报 `TypeError: argument of type 'NoneType' is not iterable`
    #   ⇒ 又一次「Linux 全绿 / Windows 全红」。
    #   ⇒ 解法：父进程**显式** `encoding="utf-8", errors="replace"`（脚本的输出契约就是 UTF-8），
    #   **不依赖 locale** ⇒ 任何平台一致。
    #   💡 **本地怎么复现这条**：`PYTHONIOENCODING=cp1252 python -m pytest tests/test_credit_price_cards_seed.py`
    #      （把**父进程**的 locale 也压成 cp1252 ⇒ 才会走 Windows 那条解码路径）
    env = {**os.environ, "OPS_DB_PATH": str(db_path), "PYTHONIOENCODING": "cp1252"}
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        cwd=BACKEND, env=env, capture_output=True,
        encoding="utf-8", errors="replace",   # ⚠️ 显式解码，不吃 locale
        timeout=120,
    )


def test_check_mode_does_not_create_tables(tmp_path):
    """`--check` 必须**只读**：不建表、不写数据。

    ⚠️ 判据不是「命令行输出说未写库」（那只是承诺），而是**事后查库**：
    跑完 --check 之后，那个 db 文件里**不得**出现 model_price_cards 表。
    """
    db_path = tmp_path / "check-only.db"
    result = _run_seed(["--check"], db_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "未写库" in result.stdout, result.stdout

    if db_path.exists():
        import sqlite3
        con = sqlite3.connect(str(db_path))
        try:
            tables = [
                r[0] for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
        finally:
            con.close()
        assert "model_price_cards" not in tables, (
            f"--check 建出了表（{tables}）⇒ 它不是只读的"
        )


def test_check_mode_reports_not_seeded_when_table_absent(tmp_path):
    """库里没有表 ⇒ `--check` 必须回答「未灌过」，且不建表。"""
    db_path = tmp_path / "fresh.db"
    result = _run_seed(["--check"], db_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "未灌过" in result.stdout, result.stdout
    priced = _seed_json().get("priced", [])
    assert f"{len(priced):>3d} 条" in result.stdout, result.stdout


def test_seed_output_is_utf8_and_not_decodable_as_windows_locale(tmp_path):
    """**输出契约**：脚本的 stdout 是 **UTF-8**，且**含 Windows locale 解不了的字节**。

    为什么这条重要（2026-10-25 CI 实测的第二个面）：
    父进程若按 **locale** 编码解码子进程输出（`text=True` ⇒ `locale.getpreferredencoding()`），
    在 Windows（cp1252 / cp936）上会抛 `UnicodeDecodeError`
    ⇒ `subprocess` 在 Windows 的 reader thread 里把它吞掉 ⇒ **`result.stdout` 变 `None`**
    ⇒ 断言 `... in result.stdout` 报 `TypeError: argument of type 'NoneType' is not iterable`
    ⇒ 现象是「Linux 全绿 / Windows 全红」。

    ⚠️ **本条刻意直接拿原始字节**、显式试 `cp1252` / `cp936` 解码，
    ⇒ **不依赖运行平台的 locale** ⇒ 在任何平台都能证明「父进程必须显式 `encoding="utf-8"`」这条**是必要的**。

    ⚠️ **诚实的覆盖边界**：本条能锁住「脚本输出是 UTF-8 且含非 cp1252 字节」这个**契约**，
    但**锁不住**「父进程是否显式指定了 encoding」——删掉 `encoding="utf-8"` 后本条在 Linux 上仍绿
    （因为本条自己拿字节、不经 locale）⇒ 那一格**只能靠 Windows CI 真验**。
    """
    db_path = tmp_path / "contract.db"
    env = {**os.environ, "OPS_DB_PATH": str(db_path), "PYTHONIOENCODING": "cp1252"}
    raw = subprocess.run(
        [sys.executable, SCRIPT, "--check"],
        cwd=BACKEND, env=env, capture_output=True, timeout=120,
    )
    assert raw.returncode == 0, raw.stderr.decode("utf-8", "replace")
    stdout = raw.stdout
    assert stdout, "脚本没有任何输出"
    # ① 必须是合法 UTF-8，且含「未写库」这句
    assert "未写库" in stdout.decode("utf-8"), stdout[:200]
    # ② 必须**含** Windows 常见 locale 解不了的字节（否则父进程按 locale 解码也不会炸 ⇒ 显式 encoding 就没必要）
    for enc in ("cp1252", "cp936"):
        with pytest.raises(UnicodeDecodeError):
            stdout.decode(enc)


def test_dry_run_does_not_write_rows(tmp_path):
    """`--dry-run` 也不写数据（只报将要插什么）。"""
    db_path = tmp_path / "dry-run.db"
    result = _run_seed(["--dry-run"], db_path)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "DRY-RUN" in result.stdout, result.stdout
    if db_path.exists():
        import sqlite3
        con = sqlite3.connect(str(db_path))
        try:
            names = [
                r[0] for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
        finally:
            con.close()
        assert "model_price_cards" not in names, f"--dry-run 建出了表：{names}"


def _make_legacy_db(path):
    """造一个「#4322 旧 schema」的库：列名是「分」口径，唯一约束漏 `unit` 维度。"""
    import sqlite3
    con = sqlite3.connect(str(path))
    con.execute(
        "CREATE TABLE model_price_cards (id TEXT PRIMARY KEY, provider_id TEXT, model_id TEXT,"
        " category TEXT, unit TEXT, spec TEXT, quality_tier TEXT, unit_price_cents INTEGER,"
        " currency TEXT, proc_discount REAL, effective_from TEXT, effective_to TEXT,"
        " credit_multiplier REAL, billed_by TEXT, source TEXT, note TEXT, created_at TEXT)"
    )
    # 旧唯一约束：**漏了 unit 维度**（这正是缺陷 ②）
    con.execute(
        "CREATE UNIQUE INDEX uq_model_price_active ON model_price_cards"
        " (provider_id, model_id, category, spec, quality_tier, effective_from)"
    )
    con.execute(
        "CREATE TABLE credit_price_config (id INTEGER PRIMARY KEY, credit_unit_price_cents INTEGER,"
        " target_margin_pct REAL, note TEXT)"
    )
    con.commit()
    con.close()


def test_legacy_schema_is_detected_and_refused(tmp_path):
    """存量旧 schema 库必须被**明确拒绝**（rc=2）+ 给出人工修复指引。

    ⚠️ 不是「抛 traceback」——静默炸（`no such column: ...`）会让运营看不懂发生了什么。
    ⚠️ 三条问题都要点出来：两处旧列名 + 唯一约束漏 `unit` 维度。
    """
    db_path = tmp_path / "legacy.db"
    _make_legacy_db(db_path)

    result = _run_seed([], db_path)

    assert result.returncode == 2, result.stdout + result.stderr
    # ⚠️ 断言必须落在**探测结果行**上，不能只匹配列名字面量：
    #   「人工修复指引」那段文本里本来就写着 `RENAME COLUMN unit_price_cents TO ...`
    #   ⇒ 只断言 `"unit_price_cents" in stdout` 会在「探测失效但指引还在」时**假绿**。
    assert "存量旧 schema：model_price_cards 仍是旧列名 `unit_price_cents`" in result.stdout, result.stdout
    assert "存量旧 schema：credit_price_config 仍是旧列名 `credit_unit_price_cents`" in result.stdout, result.stdout
    assert "存量旧 schema：model_price_cards 的唯一约束未含 `unit` 维度" in result.stdout, result.stdout
    assert "ALTER TABLE" in result.stdout, result.stdout     # 给了人工修复指引
    # 且**没有**插任何数据（fail-closed 发生在写库之前）
    import sqlite3
    con = sqlite3.connect(str(db_path))
    try:
        n = con.execute("SELECT count(*) FROM model_price_cards").fetchone()[0]
    finally:
        con.close()
    assert n == 0, f"旧 schema 库里不该有任何价格卡，实际 {n} 条"


def test_current_schema_is_not_flagged(tmp_path):
    """当前 schema 的库**不得**被误判成旧 schema（防判据自身出 bug）。

    ⚠️ 这条是判据的反向锁：唯一约束的判定要落在「唯一约束实际覆盖的列集合」上，
    拿整段建表 sql 做子串匹配会**漏判**（表里那一列本来就叫 unit），
    而只看 `type='index'` 的行会**误判**（表级 UNIQUE 约束不在那里）。
    """
    db_path = tmp_path / "current.db"
    first = _run_seed([], db_path)
    assert first.returncode == 0, first.stdout + first.stderr

    second = _run_seed([], db_path)
    assert second.returncode == 0, second.stdout + second.stderr
    assert "旧 schema" not in second.stdout, second.stdout


@pytest.mark.parametrize("mode", [[], ["--dry-run"], ["--check"]])
def test_seed_is_idempotent_and_never_overwrites(tmp_path, mode):
    """重复执行**不重复插**；已存在但单价不同 ⇒ **报错且不覆盖**。

    ⚠️ 「不覆盖」是价格表可复算性的底线：改价只能走「插新行 + 旧行补 effective_to」，
    静默 UPDATE 单价会毁掉历史成本的可复算性。
    """
    db_path = tmp_path / "idempotent.db"

    first = _run_seed(mode, db_path)
    assert first.returncode == 0, f"FIRST rc={first.returncode}\n{first.stdout}\n{first.stderr}"

    # 第二遍：已存在且一致 ⇒ 全部跳过（幂等），且**不产生冲突**
    second = _run_seed(mode, db_path)
    assert second.returncode == 0, f"SECOND rc={second.returncode}\n{second.stdout}\n{second.stderr}"
    # ⚠️ 判据用**行级标记**「! 冲突」，不是单词「冲突」——
    #   汇总行本来就打印「冲突 0」，用单词会撞上（相对断言恒真）。
    assert "! 冲突" not in second.stdout, second.stdout


def test_conflicting_price_is_reported_and_not_overwritten(tmp_path):
    """库里单价与种子不同 ⇒ 脚本必须**点名差异并拒绝覆盖**（rc=1）。"""
    import sqlite3

    db_path = tmp_path / "conflict.db"
    first = _run_seed([], db_path)
    assert first.returncode == 0, first.stdout + first.stderr

    # 手工把库内某张卡的单价改掉
    con = sqlite3.connect(str(db_path))
    try:
        con.execute("UPDATE model_price_cards SET unit_price_micros = 999999")
        con.commit()
    finally:
        con.close()

    second = _run_seed([], db_path)
    assert second.returncode == 1, second.stdout + second.stderr
    assert "冲突" in second.stdout, second.stdout
    assert "不覆盖" in second.stdout, second.stdout

    # 且**确实没有**被覆盖
    con = sqlite3.connect(str(db_path))
    try:
        prices = [r[0] for r in con.execute("SELECT unit_price_micros FROM model_price_cards")]
    finally:
        con.close()
    assert prices and all(p == 999999 for p in prices), prices
