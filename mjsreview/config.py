"""設定の読み込み。

settings.toml（無ければ settings.example.toml の既定値）を読む。
環境変数 MJSREVIEW_<大文字キー> があればそれを優先する。
"""

from __future__ import annotations

import os

try:  # Python 3.11 以降は標準で tomllib が使える
    import tomllib
except ModuleNotFoundError:  # 3.10 以前は tomli パッケージを使う
    import tomli as tomllib  # type: ignore[no-redef]
from dataclasses import dataclass, asdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_FILE = PROJECT_ROOT / "settings.toml"

DEFAULTS = {
    # mjai-reviewer の実行ファイル
    "reviewer_bin": "mjai-reviewer",
    # 既定のエンジン ("akochan" / "mortal")
    "engine": "akochan",
    # akochan 一式が入ったディレクトリ（system.exe と libai.so/dylib がある場所）
    "akochan_dir": "../akochan",
    # akochan の戦術設定ファイル
    "akochan_tactics": "../mjai-reviewer/tactics.json",
    # Mortal の実行スクリプトと設定ファイル（Mortal を使う場合のみ）
    "mortal_exe": "../Mortal/mortal/mortal",
    "mortal_cfg": "../Mortal/mortal/config.toml",
    # 表示値の計算に使う softmax 温度（mortal のみ）
    "temperature": 0.1,
    # akochan が「許容範囲」と判断するしきい値
    "deviation_threshold": 0.05,
    # 牌譜置き場・解析結果キャッシュ
    "logs_dir": "logs",
    "cache_dir": "cache",
}


@dataclass
class Settings:
    reviewer_bin: str
    engine: str
    akochan_dir: str
    akochan_tactics: str
    mortal_exe: str
    mortal_cfg: str
    temperature: float
    deviation_threshold: float
    logs_dir: str
    cache_dir: str

    def path(self, key: str) -> Path:
        """設定値をパスとして解決する（相対パスはプロジェクト直下基準）。"""
        value = Path(getattr(self, key)).expanduser()
        return value if value.is_absolute() else (PROJECT_ROOT / value)

    def as_dict(self) -> dict:
        return asdict(self)


def load_settings(path: Path | None = None) -> Settings:
    data = dict(DEFAULTS)
    settings_path = path or SETTINGS_FILE
    if settings_path.exists():
        with settings_path.open("rb") as fp:
            data.update(tomllib.load(fp))
    for key in DEFAULTS:
        env = os.environ.get(f"MJSREVIEW_{key.upper()}")
        if env:
            data[key] = env
    data["temperature"] = float(data["temperature"])
    data["deviation_threshold"] = float(data["deviation_threshold"])
    return Settings(**{k: data[k] for k in DEFAULTS})
