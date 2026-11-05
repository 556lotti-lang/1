#!/usr/bin/env python3
"""動作確認用のダミーエンジン（Mortal の代わり）。

Mortal の学習済みモデルが無くても、mjai-reviewer の mortal 用インターフェース
（標準入出力で mjai イベントをやり取りし、meta に q_values を載せる）を模倣して
画面の動作確認ができるようにするためのものです。

**麻雀の強さはまったくありません。評価値はその場で作った擬似乱数です。**
牌譜の振り返りには使わないでください。

使い方（mjai-reviewer から呼ばれる）:
    mjai-reviewer -e mortal --mortal-exe tools/dummy_mortal_engine.py \
        --mortal-cfg tools/dummy_config.toml -i log.json -a 0 --json -o out.json
"""

from __future__ import annotations

import hashlib
import json
import sys

# mjai の牌文字列（インデックスがそのまま打牌ラベル 0..36 になる）
TILES = (
    [f"{n}{s}" for s in "mps" for n in range(1, 10)]
    + ["E", "S", "W", "N", "P", "F", "C"]
    + ["5mr", "5pr", "5sr"]
)
INDEX = {t: i for i, t in enumerate(TILES)}
AKA = {"5mr": "5m", "5pr": "5p", "5sr": "5s"}

L_REACH, L_CHI_LOW, L_CHI_MID, L_CHI_HIGH = 37, 38, 39, 40
L_PON, L_KAN, L_HORA, L_RYUKYOKU, L_NONE = 41, 42, 43, 44, 45
LOW_Q = -50.0  # 実際には選べない手に与える評価値


def deaka(tile: str) -> str:
    return AKA.get(tile, tile)


def pseudo_q(seed: str) -> float:
    """文字列から決まる擬似的な評価値（-5.0 〜 +5.0）。"""
    h = hashlib.sha256(seed.encode()).digest()
    return (int.from_bytes(h[:4], "big") / 0xFFFFFFFF) * 10.0 - 5.0


class Dummy:
    def __init__(self, player_id: int) -> None:
        self.me = player_id
        self.hand: list[str] = []
        self.pons: list[str] = []      # ポンした牌（加槓の判定用）
        self.riichi = False
        self.kyoku_count = 0
        self.junme = 0
        self.last_tsumo: str | None = None

    # ---- 状態の更新 -------------------------------------------------------
    def update(self, ev: dict) -> None:
        t = ev.get("type")
        if t == "start_kyoku":
            self.hand = list(ev["tehais"][self.me])
            self.pons, self.riichi, self.junme = [], False, 0
            self.kyoku_count += 1
            self.last_tsumo = None
        elif t == "tsumo" and ev.get("actor") == self.me:
            self.hand.append(ev["pai"])
            self.last_tsumo = ev["pai"]
            self.junme += 1
        elif t == "dahai" and ev.get("actor") == self.me:
            if ev["pai"] in self.hand:
                self.hand.remove(ev["pai"])
        elif t in ("chi", "pon") and ev.get("actor") == self.me:
            for c in ev["consumed"]:
                if c in self.hand:
                    self.hand.remove(c)
            if t == "pon":
                self.pons.append(deaka(ev["pai"]))
        elif t == "daiminkan" and ev.get("actor") == self.me:
            for c in ev["consumed"]:
                if c in self.hand:
                    self.hand.remove(c)
        elif t == "ankan" and ev.get("actor") == self.me:
            for c in ev["consumed"]:
                if c in self.hand:
                    self.hand.remove(c)
        elif t == "kakan" and ev.get("actor") == self.me:
            if ev["pai"] in self.hand:
                self.hand.remove(ev["pai"])
        elif t == "reach" and ev.get("actor") == self.me:
            self.riichi = True

    # ---- 判断 -------------------------------------------------------------
    def can_kan(self) -> bool:
        """暗槓・加槓ができる状態か（できる場合は meta を出さず飛ばす）。"""
        counts: dict[str, int] = {}
        for t in self.hand:
            counts[deaka(t)] = counts.get(deaka(t), 0) + 1
        if any(c >= 4 for c in counts.values()):
            return True
        return any(deaka(t) in self.pons for t in self.hand)

    def discard_candidates(self) -> list[int]:
        return sorted({INDEX[t] for t in self.hand})

    def react(self, ev: dict) -> tuple[dict, dict | None]:
        """1 イベントに対する応答（行動, meta）を返す。"""
        t = ev.get("type")

        # 自分のツモ番 → 打牌を選ぶ
        if t == "tsumo" and ev.get("actor") == self.me and not self.can_kan():
            labels = self.discard_candidates() + [L_REACH, L_HORA, L_RYUKYOKU]
            q = {}
            for label in labels:
                if label in (L_REACH, L_HORA, L_RYUKYOKU):
                    q[label] = LOW_Q
                else:
                    tile = TILES[label]
                    bonus = -1.5 if deaka(tile) in self.hand_pairs() else 0.0
                    q[label] = pseudo_q(f"{self.kyoku_count}:{self.junme}:{tile}") + bonus
            best = max(q, key=lambda k: q[k])
            pai = TILES[best]
            action = {
                "type": "dahai", "actor": self.me, "pai": pai,
                "tsumogiri": pai == self.last_tsumo,
            }
            return action, self.meta(q)

        # 他家の打牌 → 鳴くかどうか
        if t == "dahai" and ev.get("actor") != self.me and not self.riichi:
            pai = ev["pai"]
            actor = ev["actor"]
            labels = [L_PON, L_KAN, L_HORA, L_NONE]
            if actor == (self.me + 3) % 4:  # 上家からならチーできる
                labels += [L_CHI_LOW, L_CHI_MID, L_CHI_HIGH]
            pon_tiles = [x for x in self.hand if deaka(x) == deaka(pai)]
            q = {}
            for label in labels:
                if label == L_PON and len(pon_tiles) >= 2:
                    q[label] = pseudo_q(f"pon:{self.kyoku_count}:{self.junme}:{pai}")
                elif label == L_NONE:
                    q[label] = pseudo_q(f"none:{self.kyoku_count}:{self.junme}:{pai}")
                else:
                    q[label] = LOW_Q
            if len(set(q.values())) <= 1:
                return {"type": "none"}, None
            best = max(q, key=lambda k: q[k])
            if best == L_PON:
                action = {
                    "type": "pon", "actor": self.me, "target": actor, "pai": pai,
                    "consumed": pon_tiles[:2],
                }
            else:
                action = {"type": "none"}
            return action, self.meta(q)

        return {"type": "none"}, None

    def hand_pairs(self) -> set[str]:
        counts: dict[str, int] = {}
        for t in self.hand:
            counts[deaka(t)] = counts.get(deaka(t), 0) + 1
        return {t for t, c in counts.items() if c >= 2}

    def meta(self, q: dict[int, float]) -> dict:
        mask_bits = 0
        for label in q:
            mask_bits |= 1 << label
        return {
            "q_values": [round(q[label], 4) for label in sorted(q)],
            "mask_bits": mask_bits,
            "is_greedy": True,
            "batch_size": 1,
            "eval_time_ns": 1000,
            "shanten": max(-1, min(6, len(self.hand) // 3)),
            "at_furiten": False,
        }


def main() -> int:
    player_id = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    engine = Dummy(player_id)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        ev = json.loads(line)
        engine.update(ev)
        if ev.get("type") in ("start_game", "start_kyoku", "end_kyoku", "end_game"):
            action, meta = {"type": "none"}, None
        else:
            action, meta = engine.react(ev)
        if meta is not None:
            action = dict(action, meta=meta)
        print(json.dumps(action), flush=True)

    # 最後に model_tag と phi_matrix（局ごとの順位期待値）を返す決まり
    phi = [[[0.25] * 4 for _ in range(4)] for _ in range(engine.kyoku_count)]
    print(json.dumps({"model_tag": "dummy-not-a-real-ai", "phi_matrix": phi}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
