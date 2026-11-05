"""mjai イベント（dict）を人間が読める文字列に整形し、場面の種類を判定する。"""

from __future__ import annotations

from .tiles import deaka, tiles_str, tile_str

# 行動の分類に使うイベント種別
NAKI_TYPES = {"chi", "pon", "daiminkan", "ankan", "kakan"}
KAN_TYPES = {"daiminkan", "ankan", "kakan"}

_TYPE_LABEL = {
    "chi": "チー",
    "pon": "ポン",
    "daiminkan": "大明槓",
    "ankan": "暗槓",
    "kakan": "加槓",
    "reach": "リーチ",
    "hora": "和了",
    "ryukyoku": "流局宣言(九種九牌)",
    "none": "スルー",
}


def event_type(ev) -> str:
    """イベントの type を返す。None や空なら "none"。"""
    if not ev:
        return "none"
    return ev.get("type", "none")


def format_event(ev, style: str = "emoji") -> str:
    """1 つの mjai イベントを日本語の行動表現にする。"""
    t = event_type(ev)
    if t == "dahai":
        suffix = "(ツモ切り)" if ev.get("tsumogiri") else ""
        return f"打 {tile_str(ev['pai'], style)}{suffix}"
    if t in ("chi", "pon"):
        return (
            f"{_TYPE_LABEL[t]} {tile_str(ev['pai'], style)}"
            f" + 手牌 {tiles_str(ev.get('consumed', []), style, ' ')}"
        )
    if t == "daiminkan":
        return f"大明槓 {tile_str(ev['pai'], style)}"
    if t == "ankan":
        return f"暗槓 {tiles_str(ev.get('consumed', []), style, ' ')}"
    if t == "kakan":
        return f"加槓 {tile_str(ev['pai'], style)}"
    if t == "none":
        return "スルー(何もしない)"
    return _TYPE_LABEL.get(t, t)


def format_events(evs, style: str = "emoji") -> str:
    """イベント列（akochan は最大 2 つ）をまとめて整形する。"""
    if isinstance(evs, dict):
        evs = [evs]
    if not evs:
        return "スルー(何もしない)"
    return " → ".join(format_event(e, style) for e in evs)


def _first(evs):
    """イベント列の先頭を返す。dict ならそのまま。"""
    if isinstance(evs, dict):
        return evs
    return evs[0] if evs else None


def _second(evs):
    if isinstance(evs, dict):
        return None
    return evs[1] if len(evs) > 1 else None


def event_key(ev):
    """同じ行動かどうかを比べるためのキー。赤ドラの違いは無視する。"""
    t = event_type(ev)
    if t == "dahai":
        # ツモ切りか手出しかは「同じ打牌」とみなす（AI 側は区別しない）
        return ("dahai", ev["pai"])
    if t in ("chi", "pon", "daiminkan"):
        return (t, deaka(ev["pai"]), tuple(sorted(deaka(c) for c in ev.get("consumed", []))))
    if t in ("ankan", "kakan"):
        # mjai-reviewer は槓の種類を区別せず表示するため、槓は牌で比べる
        consumed = [deaka(c) for c in ev.get("consumed", [])]
        pai = deaka(ev["pai"]) if "pai" in ev else (consumed[0] if consumed else "")
        return ("kan", pai or (consumed[0] if consumed else ""))
    return (t,)


def events_key(evs):
    return tuple(event_key(e) for e in (evs if isinstance(evs, list) else [evs]) if e)


def same_action(a, b) -> bool:
    """2 つの行動（イベント or イベント列）が実質同じかどうか。"""
    ka, kb = events_key(a), events_key(b)
    if ka == kb:
        return True
    # akochan は [鳴き, 打牌] のように 2 つ返すことがある。
    # 先頭だけ比べて違えば別行動、同じなら後続も比べる。
    return False


# ---- 場面の種類（どんなミスか）の判定 -------------------------------------

KIND_DAHAI = "打牌"
KIND_NAKI_RECOMMEND = "鳴き推奨"
KIND_NAKI_AVOID = "鳴き不要"
KIND_NAKI_DIFF = "鳴き方違い"
KIND_REACH_RECOMMEND = "リーチ推奨"
KIND_REACH_AVOID = "リーチ非推奨"
KIND_HORA_MISS = "和了見逃し"
KIND_HORA_AVOID = "見逃し推奨"
KIND_RYUKYOKU = "流局宣言"
KIND_OTHER = "その他"
KIND_MATCH = "一致"


def classify(expected, actual) -> str:
    """AI 推奨と実際の行動から、場面の種類を決める。"""
    exp, act = _first(expected), _first(actual)
    et, at = event_type(exp), event_type(act)

    if same_action(expected, actual):
        return KIND_MATCH

    if et == at == "dahai":
        return KIND_DAHAI
    if et in NAKI_TYPES and at not in NAKI_TYPES:
        return KIND_NAKI_RECOMMEND
    if at in NAKI_TYPES and et not in NAKI_TYPES:
        return KIND_NAKI_AVOID
    if et in NAKI_TYPES and at in NAKI_TYPES:
        return KIND_NAKI_DIFF
    if et == "reach":
        return KIND_REACH_RECOMMEND
    if at == "reach":
        return KIND_REACH_AVOID
    if et == "hora":
        return KIND_HORA_MISS
    if at == "hora":
        return KIND_HORA_AVOID
    if et == "ryukyoku" or at == "ryukyoku":
        return KIND_RYUKYOKU
    # 鳴き自体は同じで、その後の打牌だけ違う場合（akochan）
    if et == at and _second(expected) and _second(actual):
        return KIND_DAHAI
    return KIND_OTHER


# 鳴きに関する種類（UI でまとめて絞り込む用）
NAKI_KINDS = (KIND_NAKI_RECOMMEND, KIND_NAKI_AVOID, KIND_NAKI_DIFF)
