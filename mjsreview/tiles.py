"""牌の表示ユーティリティ。

mjai 形式の牌文字列（"1m", "5mr", "E", "P" など）を
絵文字（🀇）または日本語テキスト（1萬）に変換する。
"""

from __future__ import annotations

# mjai の牌文字列 -> Unicode 麻雀牌
_EMOJI = {
    # 萬子
    "1m": "🀇", "2m": "🀈", "3m": "🀉", "4m": "🀊", "5m": "🀋",
    "6m": "🀌", "7m": "🀍", "8m": "🀎", "9m": "🀏",
    # 筒子
    "1p": "🀙", "2p": "🀚", "3p": "🀛", "4p": "🀜", "5p": "🀝",
    "6p": "🀞", "7p": "🀟", "8p": "🀠", "9p": "🀡",
    # 索子
    "1s": "🀐", "2s": "🀑", "3s": "🀒", "4s": "🀓", "5s": "🀔",
    "6s": "🀕", "7s": "🀖", "8s": "🀗", "9s": "🀘",
    # 風牌・三元牌（mjai では P=白, F=發, C=中）
    "E": "🀀", "S": "🀁", "W": "🀂", "N": "🀃",
    "P": "🀆", "F": "🀅", "C": "🀄",
    "?": "🀫",
}

# mjai の牌文字列 -> 日本語テキスト
_TEXT = {
    "E": "東", "S": "南", "W": "西", "N": "北",
    "P": "白", "F": "發", "C": "中",
    "?": "?",
}

_SUIT_TEXT = {"m": "萬", "p": "筒", "s": "索"}

# 赤5 -> 通常の5
_AKA = {"5mr": "5m", "5pr": "5p", "5sr": "5s"}

HONORS = ("E", "S", "W", "N", "P", "F", "C")


def is_aka(tile: str) -> bool:
    """赤ドラ（赤5）かどうか。"""
    return tile in _AKA


def deaka(tile: str) -> str:
    """赤5を通常の5に正規化する（"5mr" -> "5m"）。"""
    return _AKA.get(tile, tile)


# 異体字セレクタ VS15。麻雀牌の一部（🀄 など）はそのままだとカラー絵文字で
# 描画され大きさが揃わないため、白黒の文字として描くよう指定する。
TEXT_STYLE = "\ufe0e"


def tile_emoji(tile: str, monochrome: bool = True) -> str:
    """牌を牌文字（🀇 など）で表す。赤5には「赤」を添える。"""
    base = _EMOJI.get(deaka(tile), tile)
    if monochrome and base != tile:
        base += TEXT_STYLE
    return f"{base}赤" if is_aka(tile) else base


def tile_text(tile: str) -> str:
    """牌を日本語テキストで表す（1萬 / 東 / 赤5萬）。"""
    plain = deaka(tile)
    if plain in _TEXT:
        return _TEXT[plain]
    if len(plain) == 2 and plain[1] in _SUIT_TEXT:
        body = f"{plain[0]}{_SUIT_TEXT[plain[1]]}"
        return f"赤{body}" if is_aka(tile) else body
    return tile


def tile_str(tile: str, style: str = "emoji") -> str:
    """style に応じて 1 枚の牌を文字列化する。"""
    if style == "text":
        return tile_text(tile)
    if style == "both":
        base = _EMOJI.get(deaka(tile), tile)
        return f"{base}{tile_text(tile)}"
    return tile_emoji(tile)


def tiles_str(tiles, style: str = "emoji", sep: str = "") -> str:
    """牌のリストを文字列化する。"""
    if not tiles:
        return ""
    sep = sep if style == "emoji" else (sep or " ")
    return sep.join(tile_str(t, style) for t in tiles)


_TILE_ORDER = {t: i for i, t in enumerate(
    [f"{n}{s}" for s in "mps" for n in range(1, 10)] + list(HONORS) + ["?"]
)}


def sort_key(tile: str):
    """手牌を並べるためのキー。赤5は同じ数字の直前に置く。"""
    plain = deaka(tile)
    return (_TILE_ORDER.get(plain, 99), 0 if is_aka(tile) else 1)


def sort_tiles(tiles):
    return sorted(tiles, key=sort_key)
