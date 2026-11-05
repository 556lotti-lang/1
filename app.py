"""雀魂 牌譜レビュー（ローカル専用）

mjai-reviewer を呼び出して牌譜を解析し、
「AI と判断が違った場面」を見やすく振り返るための画面。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mjsreview import events as E
from mjsreview.config import PROJECT_ROOT, SETTINGS_FILE, load_settings
from mjsreview.parse import ReviewResult, Scene, load as load_review
from mjsreview.runner import ReviewerError, list_logs, peek_log, run_review

st.set_page_config(page_title="雀魂 牌譜レビュー", page_icon="🀄", layout="wide")

# 場面の種類ごとの印
KIND_MARK = {
    E.KIND_MATCH: "✅",
    E.KIND_DAHAI: "🔴",
    E.KIND_NAKI_RECOMMEND: "🤝",
    E.KIND_NAKI_AVOID: "🙅",
    E.KIND_NAKI_DIFF: "🔀",
    E.KIND_REACH_RECOMMEND: "🔔",
    E.KIND_REACH_AVOID: "🔕",
    E.KIND_HORA_MISS: "💰",
    E.KIND_HORA_AVOID: "⏭️",
    E.KIND_RYUKYOKU: "🏳️",
    E.KIND_OTHER: "❔",
}
KIND_HELP = {
    E.KIND_MATCH: "AI と同じ選択",
    E.KIND_DAHAI: "切った牌が AI の推奨と違う",
    E.KIND_NAKI_RECOMMEND: "AI は鳴きを推奨（実際はスルー）",
    E.KIND_NAKI_AVOID: "AI はスルーを推奨（実際は鳴いた）",
    E.KIND_NAKI_DIFF: "鳴き方（どの牌で鳴くか等）が違う",
    E.KIND_REACH_RECOMMEND: "AI はリーチを推奨",
    E.KIND_REACH_AVOID: "AI はリーチしないことを推奨",
    E.KIND_HORA_MISS: "AI は和了を推奨（見逃した）",
    E.KIND_HORA_AVOID: "AI は和了しないことを推奨",
    E.KIND_RYUKYOKU: "九種九牌の流局宣言について判断が違う",
    E.KIND_OTHER: "その他",
}
ALL_KINDS = [k for k in KIND_MARK if k != E.KIND_MATCH]


def mark(kind: str) -> str:
    return f"{KIND_MARK.get(kind, '❔')} {kind}"


# ---- サイドバー -------------------------------------------------------------

def sidebar() -> dict:
    st.sidebar.header("1. 牌譜を選ぶ")
    settings = load_settings()

    if not SETTINGS_FILE.exists():
        st.sidebar.warning(
            "settings.toml がありません。settings.example.toml をコピーして"
            "パスを設定してください（今は既定値で動いています）。"
        )

    logs_dir = settings.path("logs_dir")
    logs_dir.mkdir(parents=True, exist_ok=True)

    uploaded = st.sidebar.file_uploader(
        "牌譜 JSON を追加（tenhou.net/6 形式）", type=["json"],
        help="雀魂の牌譜は Tampermonkey の downloadlogs スクリプトで保存したものを使います。",
    )
    if uploaded is not None:
        dest = logs_dir / uploaded.name
        dest.write_bytes(uploaded.getvalue())
        st.sidebar.success(f"{dest.name} を {logs_dir.name}/ に保存しました")

    files = list_logs(settings)
    if not files:
        st.sidebar.error(
            f"{logs_dir} に牌譜 JSON がありません。"
            "上のアップローダか、フォルダに直接置いてください。"
        )
        return {"settings": settings, "log": None}

    labels = {p.name: p for p in files}
    chosen = st.sidebar.selectbox("牌譜ファイル", list(labels), index=0)
    log_path = labels[chosen]

    try:
        info = peek_log(log_path)
    except Exception as exc:  # noqa: BLE001
        st.sidebar.error(f"牌譜を読めませんでした: {exc}")
        return {"settings": settings, "log": None}

    st.sidebar.caption(
        f"ルール: {info['rule'] or '不明'} / 局数: {info['kyoku_count']}"
        + (f" / ID: {info['ref']}" if info.get("ref") else "")
    )

    st.sidebar.header("2. 視点と解析方法")
    names = info["names"] or [f"プレイヤー{i}" for i in range(4)]
    actor = st.sidebar.selectbox(
        "振り返るプレイヤー",
        options=list(range(len(names))),
        format_func=lambda i: f"{i}: {names[i]}",
        help="東1局で東家が 0、以降は右回りに 1, 2, 3 です。",
    )
    engine = st.sidebar.radio(
        "エンジン", ["akochan", "mortal"],
        index=0 if settings.engine == "akochan" else 1,
        help="akochan は学習済みモデル不要。mortal は mortal.pth が必要です。",
    )
    kyokus = st.sidebar.text_input(
        "局を絞る（任意）", value="",
        placeholder="例: E1,E4,S3.1",
        help="空欄なら全局。akochan は時間がかかるので、まず 1 局で試すのがおすすめです。",
    )
    use_cache = st.sidebar.checkbox("同じ条件ならキャッシュを使う", value=True)
    timeout_min = st.sidebar.slider("タイムアウト（分）", 1, 120, 30)

    st.sidebar.header("3. 表示")
    style_label = st.sidebar.radio("牌の表示", ["絵文字", "文字", "絵文字＋文字"], index=0)
    style = {"絵文字": "emoji", "文字": "text", "絵文字＋文字": "both"}[style_label]

    run = st.sidebar.button("この条件で解析する", type="primary", use_container_width=True)

    with st.sidebar.expander("設定の確認"):
        st.write(
            {
                "mjai-reviewer": settings.reviewer_bin,
                "akochan_dir": str(settings.path("akochan_dir")),
                "mortal_exe": str(settings.path("mortal_exe")),
                "settings.toml": str(SETTINGS_FILE),
            }
        )

    return {
        "settings": settings, "log": log_path, "actor": actor, "engine": engine,
        "kyokus": kyokus.strip() or None, "use_cache": use_cache, "style": style,
        "run": run, "timeout": timeout_min * 60, "names": names,
    }


# ---- 解析の実行 -------------------------------------------------------------

def do_review(opt: dict) -> None:
    progress = st.progress(0.0, text="解析を開始します…")
    status = st.empty()

    def on_progress(percent, line):
        if percent is not None:
            progress.progress(min(percent / 100.0, 1.0), text=f"解析中… {percent:.0f}%")
        elif line:
            status.caption(line[-160:])

    try:
        data, info = run_review(
            opt["settings"], opt["log"],
            engine=opt["engine"], actor=opt["actor"], kyokus=opt["kyokus"],
            use_cache=opt["use_cache"], on_progress=on_progress,
            timeout=opt["timeout"],
        )
    except ReviewerError as exc:
        progress.empty()
        status.empty()
        st.error(str(exc))
        st.info(
            "よくある原因:\n"
            "- settings.toml のパスが実際のビルド先と違う\n"
            "- akochan の libai.so / libai.dylib が akochan_dir に無い\n"
            "- 三人麻雀や東風戦の牌譜（Mortal は半荘のみ対応）\n"
            "- 視点プレイヤー（-a）の指定間違い"
        )
        return
    finally:
        progress.empty()
        status.empty()

    st.session_state["review"] = load_review(data)
    st.session_state["run_info"] = info
    st.session_state["review_key"] = (
        str(opt["log"]), opt["engine"], opt["actor"], opt["kyokus"]
    )


# ---- 表示 -------------------------------------------------------------------

def show_summary(r: ReviewResult, opt: dict) -> None:
    name = (r.player_names or opt["names"])[r.player_id] \
        if (r.player_names or opt["names"]) else f"プレイヤー{r.player_id}"
    st.subheader(f"{name} の牌譜レビュー（{r.engine}）")

    cols = st.columns(5)
    cols[0].metric("判断した場面", f"{r.total_reviewed} 回")
    if r.match_rate is not None:
        cols[1].metric("AI と一致", f"{r.match_rate:.1%}",
                       help=f"{r.total_matches} / {r.total_reviewed}")
    mismatches = [s for s in r.scenes if not s.is_match]
    cols[2].metric("違った場面", f"{len(mismatches)} 回")
    total_loss = sum(s.loss or 0 for s in mismatches)
    cols[3].metric(f"{r.value_label} の損失合計", f"{total_loss:.2f}")
    if r.rating is not None:
        cols[4].metric("rating（参考）", f"{r.rating * 100:.1f}")

    caption = [f"mjai-reviewer {r.version}", f"解析 {r.review_time}"]
    if r.model_tag:
        caption.append(f"モデル {r.model_tag}")
    if r.temperature is not None:
        caption.append(f"温度 {r.temperature}")
    st.caption(" / ".join(caption))


def scene_rows(scenes: list[Scene], style: str) -> pd.DataFrame:
    return pd.DataFrame([
        {
            "印": KIND_MARK.get(s.kind, "❔"),
            "種別": s.kind,
            "局": s.kyoku_label,
            "巡目": s.junme,
            "手牌": s.hand_text(style),
            "実際": s.actual_text(style),
            "AI 推奨": s.expected_text(style),
            "損失": round(s.loss, 3) if s.loss is not None else None,
            "AI 内順位": f"{s.rank_actual}/{s.n_candidates}" if s.rank_actual else "—",
            "残り": s.tiles_left,
            "#": s.index,
        }
        for s in scenes
    ])


def table_columns(r: ReviewResult) -> dict:
    """一覧表の列幅と書式。"""
    return {
        "印": st.column_config.TextColumn("印", width="small"),
        "手牌": st.column_config.TextColumn("手牌", width="large"),
        "実際": st.column_config.TextColumn("実際の選択", width="medium"),
        "AI 推奨": st.column_config.TextColumn("AI の推奨", width="medium"),
        "損失": st.column_config.NumberColumn(f"損失（{r.value_label}）", format="%.3f"),
        "#": st.column_config.NumberColumn("#", help="場面の通し番号"),
    }


def show_scene_detail(s: Scene, r: ReviewResult, style: str) -> None:
    head = (
        f"{KIND_MARK.get(s.kind, '❔')} {s.kyoku_label} {s.junme}巡目"
        f"  [{s.kind}]"
        + (f"  損失 {s.loss:.3f}" if s.loss is not None else "")
    )
    with st.expander(head):
        meta = [f"残り牌 {s.tiles_left}枚"]
        if s.shanten is not None:
            meta.append("和了形" if s.shanten < 0 else f"{s.shanten}シャンテン")
        if s.at_furiten:
            meta.append("フリテン")
        if s.acceptance:
            meta.append({"agree": "AI 判定: 一致", "tolerable": "AI 判定: 許容範囲",
                         "disagree": "AI 判定: 不一致"}.get(s.acceptance, s.acceptance))
        if s.at_self_chi_pon:
            meta.append("鳴いた直後")
        if s.at_self_riichi:
            meta.append("リーチ宣言時")
        if not s.loss_is_exact:
            meta.append("※ 実際の手が候補表に無いため、損失は近い候補から推定")
        st.caption(" / ".join(meta))

        st.markdown(f"**手牌** {s.hand_text(style)}")
        left, right = st.columns(2)
        left.markdown(f"**実際の選択**\n\n{s.actual_text(style)}")
        right.markdown(f"**AI の推奨**\n\n{s.expected_text(style)}")

        rows = []
        for i, c in enumerate(s.candidates, start=1):
            row = {
                "": ("★" if c.is_best else "") + ("●" if c.is_actual else ""),
                "順位": i,
                "候補手": c.text(style),
                r.value_label: round(c.value, 4) if c.value is not None else None,
            }
            if c.prob is not None:
                row["AI の選択率"] = round(c.prob, 4)
            for key in ("放銃率", "放銃失点"):
                if c.extra.get(key) is not None:
                    row[key] = round(c.extra[key], 4)
            rows.append(row)
        st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
        st.caption("★ = AI の最善手 / ● = 実際に選んだ手")


def show_scenes_tab(r: ReviewResult, style: str) -> None:
    st.markdown("#### 気になる場面")
    c1, c2, c3 = st.columns([3, 2, 2])
    kinds = c1.multiselect(
        "種別で絞る", ALL_KINDS, default=ALL_KINDS,
        format_func=lambda k: f"{KIND_MARK[k]} {k}",
    )
    sort_by = c2.selectbox("並べ替え", ["損失が大きい順", "局・巡目の順", "AI 内順位が低い順"])
    include_match = c3.checkbox("AI と一致した場面も表示", value=False)

    losses = [s.loss for s in r.scenes if s.loss is not None]
    max_loss = max(losses) if losses else 0.0
    threshold = st.slider(
        f"{r.value_label} の損失がこの値以上の場面だけ表示",
        0.0, float(round(max_loss + 0.01, 2)), 0.0, step=0.01,
    )

    scenes = [
        s for s in r.scenes
        if (include_match or not s.is_match)
        and (s.is_match or s.kind in kinds)
        and ((s.loss or 0.0) >= threshold)
    ]
    if sort_by == "損失が大きい順":
        scenes.sort(key=lambda s: -(s.loss if s.loss is not None else -1))
    elif sort_by == "AI 内順位が低い順":
        scenes.sort(key=lambda s: -(s.rank_actual or 0))
    else:
        scenes.sort(key=lambda s: s.index)

    if not scenes:
        st.info("条件に合う場面がありません。しきい値や種別の絞り込みを緩めてください。")
        return

    st.caption(
        "印の意味: " + " / ".join(f"{KIND_MARK[k]} {k}（{KIND_HELP[k]}）" for k in ALL_KINDS)
    )
    st.dataframe(
        scene_rows(scenes, style), hide_index=True, use_container_width=True,
        column_config=table_columns(r),
    )

    st.markdown("#### 場面ごとの詳細")
    limit = st.number_input("詳細を表示する件数", 1, 200, min(10, len(scenes)))
    for s in scenes[: int(limit)]:
        show_scene_detail(s, r, style)


def show_kyoku_tab(r: ReviewResult, style: str) -> None:
    st.markdown("#### 局ごとの一覧")
    summary = pd.DataFrame([
        {
            "局": k.label,
            "判断した場面": k.n_scenes,
            "違った場面": k.n_mismatch,
            f"損失合計（{r.value_label}）": round(k.total_loss, 3),
            "結果": k.end_text(),
        }
        for k in r.kyokus
    ])
    st.dataframe(summary, hide_index=True, use_container_width=True)

    labels = [k.label for k in r.kyokus]
    if not labels:
        return
    chosen = st.selectbox("局を選んで時系列で見る", labels)
    target = r.kyokus[labels.index(chosen)]
    scenes = [
        s for s in r.scenes if s.kyoku == target.kyoku and s.honba == target.honba
    ]
    st.dataframe(
        scene_rows(scenes, style), hide_index=True, use_container_width=True,
        column_config=table_columns(r),
    )
    only_mismatch = st.checkbox("違った場面だけ詳細を開く", value=True, key="kyoku_only_mis")
    for s in scenes:
        if only_mismatch and s.is_match:
            continue
        show_scene_detail(s, r, style)


def show_info_tab(r: ReviewResult) -> None:
    info = st.session_state.get("run_info")
    st.markdown("#### 実行したコマンド")
    if info:
        st.code(" ".join(info.command), language="bash")
        st.caption(
            f"結果 JSON: {info.json_path}"
            + ("（キャッシュを再利用）" if info.from_cache else "")
        )
    st.markdown("#### 評価値について")
    if r.engine == "mortal":
        st.markdown(
            "- **Q値**: Mortal が見積もる pt 期待値の変化量。局の開始時点を基準にした相対値です。\n"
            "- **損失** = 最善手の Q値 − 実際に選んだ手の Q値。大きいほど AI との評価差が大きい場面です。\n"
            "- **AI の選択率** は Q値 を softmax（温度 "
            f"{r.temperature}）に通した値で、表示用の目安です。"
        )
    else:
        st.markdown(
            "- **pt期待値**: akochan が見積もる最終順位の期待 pt。\n"
            "- **損失** = 最善手の pt期待値 − 実際に選んだ手の pt期待値。\n"
            "- akochan は「鳴き + その後の打牌」をセットで評価するため、"
            "候補手が 2 手セットで並ぶことがあります。"
        )
    st.markdown("#### 設定ファイル")
    st.code(str(SETTINGS_FILE))
    st.caption(f"プロジェクト: {PROJECT_ROOT}")


# ---- メイン -----------------------------------------------------------------

def main() -> None:
    st.title("🀄 雀魂 牌譜レビュー")
    opt = sidebar()
    if opt.get("log") is None:
        st.info("左のサイドバーで牌譜ファイルを選ぶか、アップロードしてください。")
        return

    if opt.get("run"):
        do_review(opt)

    r: ReviewResult | None = st.session_state.get("review")
    if r is None:
        st.info(
            "左のサイドバーで条件を決めて「この条件で解析する」を押してください。\n\n"
            "akochan は 1 局あたり数十秒かかります。まずは「局を絞る」に `E1` と"
            "入れて試すのがおすすめです。"
        )
        return

    show_summary(r, opt)
    tabs = st.tabs(["気になる場面", "局ごと", "解析の情報"])
    with tabs[0]:
        show_scenes_tab(r, opt["style"])
    with tabs[1]:
        show_kyoku_tab(r, opt["style"])
    with tabs[2]:
        show_info_tab(r)


if __name__ == "__main__":
    main()
