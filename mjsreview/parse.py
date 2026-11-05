"""mjai-reviewer の --json 出力を、画面に出しやすい「場面」のリストへ変換する。

mortal / akochan のどちらのエンジンの出力にも対応する。
スキーマは mjai-reviewer 1.5.x の src/review/{mortal,akochan}.rs に対応。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import events as E
from .tiles import tiles_str

BAKAZE = ("東", "南", "西", "北")


def kyoku_label(kyoku: int, honba: int) -> str:
    """0 始まりの局番号を「東1局 2本場」の形にする。"""
    label = f"{BAKAZE[kyoku // 4]}{kyoku % 4 + 1}局"
    return f"{label} {honba}本場" if honba else label


@dataclass
class Candidate:
    """AI が挙げた候補手 1 つ。"""

    raw: list[dict]              # mjai イベント（akochan は「鳴き＋打牌」の 2 手になる）
    value: float | None          # 評価値（mortal: Q値 / akochan: pt期待値）
    prob: float | None           # mortal のみ（π の値）
    is_actual: bool
    is_best: bool
    extra: dict[str, Any] = field(default_factory=dict)

    def text(self, style: str = "emoji") -> str:
        return E.format_events(self.raw, style)


@dataclass
class Scene:
    """1 つの判断場面。"""

    index: int
    kyoku: int
    honba: int
    junme: int
    tiles_left: int
    hand: list[str]
    fuuros: list[dict]
    actual: list[dict]
    expected: list[dict]
    is_match: bool
    kind: str
    loss: float | None
    rank_actual: int | None
    n_candidates: int
    candidates: list[Candidate]
    prob_actual: float | None = None
    prob_best: float | None = None
    shanten: int | None = None
    at_furiten: bool | None = None
    acceptance: str | None = None
    at_self_chi_pon: bool = False
    at_self_riichi: bool = False
    loss_is_exact: bool = True

    @property
    def kyoku_label(self) -> str:
        return kyoku_label(self.kyoku, self.honba)

    def actual_text(self, style: str = "emoji") -> str:
        return E.format_events(self.actual, style)

    def expected_text(self, style: str = "emoji") -> str:
        return E.format_events(self.expected, style)

    def hand_text(self, style: str = "emoji") -> str:
        text = tiles_str(self.hand, style, " " if style != "emoji" else "")
        if self.fuuros:
            text += "  [" + " / ".join(fuuro_text(f, style) for f in self.fuuros) + "]"
        return text


def fuuro_text(fuuro: dict, style: str = "emoji") -> str:
    """副露 1 つを文字列にする。"""
    t = fuuro.get("type")
    label = {"chi": "チー", "pon": "ポン", "daiminkan": "大明槓",
             "kakan": "加槓", "ankan": "暗槓"}.get(t, t)
    tiles = list(fuuro.get("consumed", []))
    if "pai" in fuuro:
        tiles = [fuuro["pai"]] + tiles
    if t == "kakan" and "previous_pon_pai" in fuuro:
        tiles.append(fuuro["previous_pon_pai"])
    return f"{label}{tiles_str(tiles, style, ' ' if style != 'emoji' else '')}"


@dataclass
class KyokuSummary:
    kyoku: int
    honba: int
    end_status: list[dict]
    n_scenes: int
    n_mismatch: int
    total_loss: float
    scores: list[int] | None = None

    @property
    def label(self) -> str:
        return kyoku_label(self.kyoku, self.honba)

    def end_text(self) -> str:
        parts = []
        for ev in self.end_status:
            if ev.get("type") == "hora":
                who = f"プレイヤー{ev.get('actor')}"
                how = "ツモ" if ev.get("actor") == ev.get("target") else "ロン"
                deltas = ev.get("deltas")
                delta = f"（{'/'.join(f'{d:+d}' for d in deltas)}）" if deltas else ""
                parts.append(f"{who} {how}和了{delta}")
            elif ev.get("type") == "ryukyoku":
                deltas = ev.get("deltas")
                delta = f"（{'/'.join(f'{d:+d}' for d in deltas)}）" if deltas else ""
                parts.append(f"流局{delta}")
        return " / ".join(parts) if parts else "—"


@dataclass
class ReviewResult:
    engine: str                  # "mortal" | "akochan"
    player_id: int
    version: str
    game_length: str
    review_time: str
    loading_time: str
    rating: float | None
    total_reviewed: int
    total_matches: int | None
    model_tag: str | None
    temperature: float | None
    value_label: str             # 評価値の呼び名（画面表示用）
    scenes: list[Scene]
    kyokus: list[KyokuSummary]
    player_names: list[str] = field(default_factory=list)
    log_id: str | None = None

    @property
    def match_rate(self) -> float | None:
        if self.total_matches is None or not self.total_reviewed:
            return None
        return self.total_matches / self.total_reviewed


# ---- 読み込み ---------------------------------------------------------------

def load(path_or_obj) -> ReviewResult:
    """JSON ファイル（パス or 文字列 or dict）を読んで ReviewResult にする。"""
    if isinstance(path_or_obj, dict):
        data = path_or_obj
    elif isinstance(path_or_obj, (str, Path)) and Path(str(path_or_obj)).exists():
        data = json.loads(Path(str(path_or_obj)).read_text(encoding="utf-8"))
    else:
        data = json.loads(path_or_obj)

    engine = str(data.get("engine", "")).lower()
    if engine not in ("mortal", "akochan"):
        raise ValueError(
            f"未知のエンジン名です: {data.get('engine')!r}。"
            "mjai-reviewer の --json 出力ではない可能性があります。"
        )
    return _parse_mortal(data) if engine == "mortal" else _parse_akochan(data)


def _player_names(data: dict) -> list[str]:
    for ev in data.get("mjai_log") or []:
        if ev.get("type") == "start_game" and ev.get("names"):
            return list(ev["names"])
    return []


def _common(data: dict) -> dict:
    return {
        "player_id": data.get("player_id", 0),
        "version": data.get("version", ""),
        "game_length": str(data.get("game_length", "")),
        "review_time": str(data.get("review_time", "")),
        "loading_time": str(data.get("loading_time", "")),
        "player_names": _player_names(data),
        "log_id": data.get("log_id"),
    }


def _parse_mortal(data: dict) -> ReviewResult:
    review = data["review"]
    scenes: list[Scene] = []
    summaries: list[KyokuSummary] = []
    idx = 0

    for ky in review.get("kyokus", []):
        n_mismatch = 0
        total_loss = 0.0
        for ent in ky.get("entries", []):
            details = ent.get("details", [])
            best = details[0] if details else None
            actual_index = ent.get("actual_index")
            actual_detail = (
                details[actual_index]
                if actual_index is not None and actual_index < len(details)
                else None
            )
            loss = None
            if best and actual_detail:
                loss = float(best["q_value"]) - float(actual_detail["q_value"])

            cands = [
                Candidate(
                    raw=[d["action"]],
                    value=float(d["q_value"]),
                    prob=float(d.get("prob")) if d.get("prob") is not None else None,
                    is_actual=(i == actual_index),
                    is_best=(i == 0),
                )
                for i, d in enumerate(details)
            ]

            expected = [ent["expected"]]
            actual = [ent["actual"]]
            kind = E.classify(ent["expected"], ent["actual"])
            is_match = bool(ent.get("is_equal"))
            if is_match:
                kind = E.KIND_MATCH
            else:
                n_mismatch += 1
                total_loss += loss or 0.0

            scenes.append(Scene(
                index=idx,
                kyoku=ky["kyoku"],
                honba=ky["honba"],
                junme=ent["junme"],
                tiles_left=ent["tiles_left"],
                hand=list(ent["state"]["tehai"]),
                fuuros=list(ent["state"].get("fuuros", [])),
                actual=actual,
                expected=expected,
                is_match=is_match,
                kind=kind,
                loss=loss,
                rank_actual=(actual_index + 1) if actual_index is not None else None,
                n_candidates=len(details),
                candidates=cands,
                prob_actual=(actual_detail or {}).get("prob"),
                prob_best=(best or {}).get("prob"),
                shanten=ent.get("shanten"),
                at_furiten=ent.get("at_furiten"),
                at_self_chi_pon=bool(ent.get("at_self_chi_pon")),
                at_self_riichi=bool(ent.get("at_self_riichi")),
            ))
            idx += 1

        summaries.append(KyokuSummary(
            kyoku=ky["kyoku"],
            honba=ky["honba"],
            end_status=ky.get("end_status", []),
            n_scenes=len(ky.get("entries", [])),
            n_mismatch=n_mismatch,
            total_loss=total_loss,
            scores=ky.get("relative_scores"),
        ))

    return ReviewResult(
        engine="mortal",
        rating=review.get("rating"),
        total_reviewed=review.get("total_reviewed", len(scenes)),
        total_matches=review.get("total_matches"),
        model_tag=review.get("model_tag"),
        temperature=review.get("temperature"),
        value_label="Q値 (pt期待値の差)",
        scenes=scenes,
        kyokus=summaries,
        **_common(data),
    )


def _akochan_value(detail: dict) -> float | None:
    v = (detail.get("review") or {}).get("pt_exp_total")
    return float(v) if v is not None else None


def _parse_akochan(data: dict) -> ReviewResult:
    review = data["review"]
    scenes: list[Scene] = []
    summaries: list[KyokuSummary] = []
    idx = 0
    n_match_total = 0

    for ky in review.get("kyokus", []):
        n_mismatch = 0
        total_loss = 0.0
        for ent in ky.get("entries", []):
            details = list(ent.get("details", []))
            # pt期待値の高い順に並べ替える（akochan の出力順は保証されない）
            details.sort(key=lambda d: (_akochan_value(d) is not None, _akochan_value(d)),
                         reverse=True)

            actual, expected = ent["actual"], ent["expected"]
            actual_key = E.events_key(actual)
            actual_first = E.events_key(actual[:1])

            actual_index, loss_is_exact = None, True
            for i, d in enumerate(details):
                if E.events_key(d["moves"]) == actual_key:
                    actual_index = i
                    break
            if actual_index is None:
                # 実打とまったく同じ組み合わせが候補に無い場合は、
                # 最初の行動（鳴く/鳴かない等）が一致する候補のうち最良のものを使う
                for i, d in enumerate(details):
                    if E.events_key(d["moves"][:1]) == actual_first:
                        actual_index, loss_is_exact = i, False
                        break

            best_value = _akochan_value(details[0]) if details else None
            actual_value = (
                _akochan_value(details[actual_index]) if actual_index is not None else None
            )
            loss = (
                best_value - actual_value
                if best_value is not None and actual_value is not None
                else None
            )

            cands = [
                Candidate(
                    raw=list(d["moves"]),
                    value=_akochan_value(d),
                    prob=None,
                    is_actual=(i == actual_index),
                    is_best=(i == 0),
                    extra={
                        "放銃率": (d.get("review") or {}).get("total_houjuu_hai_prob_now"),
                        "放銃失点": (d.get("review") or {}).get("total_houjuu_hai_value_now"),
                    },
                )
                for i, d in enumerate(details)
            ]

            is_match = E.events_key(expected) == actual_key
            kind = E.KIND_MATCH if is_match else E.classify(expected, actual)
            if is_match:
                n_match_total += 1
            else:
                n_mismatch += 1
                total_loss += loss or 0.0

            scenes.append(Scene(
                index=idx,
                kyoku=ky["kyoku"],
                honba=ky["honba"],
                junme=ent["junme"],
                tiles_left=ent["tiles_left"],
                hand=list(ent["state"]["tehai"]),
                fuuros=list(ent["state"].get("fuuros", [])),
                actual=actual,
                expected=expected,
                is_match=is_match,
                kind=kind,
                loss=loss,
                rank_actual=(actual_index + 1) if actual_index is not None else None,
                n_candidates=len(details),
                candidates=cands,
                acceptance=ent.get("acceptance"),
                loss_is_exact=loss_is_exact,
            ))
            idx += 1

        summaries.append(KyokuSummary(
            kyoku=ky["kyoku"],
            honba=ky["honba"],
            end_status=ky.get("end_status", []),
            n_scenes=len(ky.get("entries", [])),
            n_mismatch=n_mismatch,
            total_loss=total_loss,
        ))

    return ReviewResult(
        engine="akochan",
        rating=review.get("rating"),
        total_reviewed=review.get("total_reviewed", len(scenes)),
        total_matches=n_match_total,
        model_tag=None,
        temperature=None,
        value_label="pt期待値",
        scenes=scenes,
        kyokus=summaries,
        **_common(data),
    )
