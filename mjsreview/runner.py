"""mjai-reviewer をコマンドとして呼び出し、JSON 出力を受け取る。"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .config import Settings

PROGRESS_RE = re.compile(r"\(([\d.]+)%\)")
BACKTRACE_RE = re.compile(r"^\s+\d+:\s")


class ReviewerError(RuntimeError):
    """mjai-reviewer の実行に失敗したときのエラー（原因と対処を含む）。"""


@dataclass
class RunInfo:
    command: list[str]
    json_path: Path
    from_cache: bool
    stderr_tail: str = ""


def resolve_binary(settings: Settings) -> Path:
    """mjai-reviewer の実行ファイルを探す。"""
    raw = settings.reviewer_bin
    candidate = Path(raw).expanduser()
    if candidate.is_absolute() or raw.startswith("."):
        path = settings.path("reviewer_bin")
        if path.is_file():
            return path
    found = shutil.which(raw)
    if found:
        return Path(found)
    raise ReviewerError(
        f"mjai-reviewer の実行ファイルが見つかりません: {raw}\n"
        "settings.toml の reviewer_bin に、ビルドした実行ファイルのパスを書いてください。\n"
        "例: reviewer_bin = \"../mjai-reviewer/target/release/mjai-reviewer\""
    )


def _check_engine_files(settings: Settings, engine: str) -> None:
    if engine == "akochan":
        exe = settings.path("akochan_dir") / "system.exe"
        if not exe.is_file():
            raise ReviewerError(
                f"akochan の実行ファイルが見つかりません: {exe}\n"
                "akochan をビルドし、settings.toml の akochan_dir を"
                "そのディレクトリに合わせてください。"
            )
        if not settings.path("akochan_tactics").is_file():
            raise ReviewerError(
                f"akochan の tactics.json が見つかりません: "
                f"{settings.path('akochan_tactics')}"
            )
    else:
        exe = settings.path("mortal_exe")
        if not exe.is_file():
            raise ReviewerError(
                f"Mortal の実行スクリプトが見つかりません: {exe}\n"
                "Mortal は学習済みモデル（.pth）が別途必要です。README の"
                "「Mortal を使う場合」を参照してください。"
            )
        if not settings.path("mortal_cfg").is_file():
            raise ReviewerError(
                f"Mortal の設定ファイルが見つかりません: {settings.path('mortal_cfg')}"
            )


def build_command(
    settings: Settings,
    log_path: Path,
    out_path: Path,
    *,
    engine: str,
    actor: int | None = None,
    player_name: str | None = None,
    kyokus: str | None = None,
) -> list[str]:
    cmd = [
        str(resolve_binary(settings)),
        "-e", engine,
        "-i", str(log_path),
        "--json", "--no-open",
        "-o", str(out_path),
    ]
    if player_name:
        cmd += ["-n", player_name]
    else:
        cmd += ["-a", str(actor if actor is not None else 0)]
    if kyokus:
        cmd += ["-k", kyokus]
    if engine == "akochan":
        cmd += [
            "--akochan-dir", str(settings.path("akochan_dir")),
            "--akochan-tactics", str(settings.path("akochan_tactics")),
            "--deviation-threshold", str(settings.deviation_threshold),
        ]
    else:
        cmd += [
            "--mortal-exe", str(settings.path("mortal_exe")),
            "--mortal-cfg", str(settings.path("mortal_cfg")),
            "--temperature", str(settings.temperature),
        ]
    return cmd


def _env_for(settings: Settings, engine: str) -> dict:
    """akochan の共有ライブラリ（libai）を見つけられるように環境変数を足す。"""
    env = dict(os.environ)
    if engine != "akochan":
        return env
    akochan_dir = str(settings.path("akochan_dir"))
    key = "DYLD_LIBRARY_PATH" if platform.system() == "Darwin" else "LD_LIBRARY_PATH"
    env[key] = os.pathsep.join(filter(None, [akochan_dir, env.get(key, "")]))
    return env


def cache_key(
    log_path: Path, engine: str, actor, player_name, kyokus, settings: Settings
) -> str:
    h = hashlib.sha256()
    h.update(log_path.read_bytes())
    extra = [
        engine, str(actor), str(player_name), str(kyokus),
        str(settings.temperature if engine == "mortal" else settings.deviation_threshold),
    ]
    h.update("|".join(extra).encode())
    return h.hexdigest()[:16]


def run_review(
    settings: Settings,
    log_path: str | Path,
    *,
    engine: str | None = None,
    actor: int | None = None,
    player_name: str | None = None,
    kyokus: str | None = None,
    use_cache: bool = True,
    on_progress=None,
    timeout: int | None = None,
) -> tuple[dict, RunInfo]:
    """牌譜を解析して (JSON dict, 実行情報) を返す。

    on_progress(percent: float, line: str) を渡すと進捗を受け取れる。
    """
    log_path = Path(log_path).expanduser().resolve()
    if not log_path.is_file():
        raise ReviewerError(f"牌譜ファイルが見つかりません: {log_path}")

    engine = (engine or settings.engine).lower()
    if engine not in ("akochan", "mortal"):
        raise ReviewerError(f"エンジン名が不正です: {engine}")
    _check_engine_files(settings, engine)

    cache_dir = settings.path("cache_dir")
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = cache_key(log_path, engine, actor, player_name, kyokus, settings)
    out_path = cache_dir / f"{log_path.stem}-{engine}-{key}.json"

    cmd = build_command(
        settings, log_path, out_path,
        engine=engine, actor=actor, player_name=player_name, kyokus=kyokus,
    )

    if use_cache and out_path.is_file() and out_path.stat().st_size > 0:
        data = json.loads(out_path.read_text(encoding="utf-8"))
        return data, RunInfo(command=cmd, json_path=out_path, from_cache=True)

    stderr_lines: list[str] = []
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_env_for(settings, engine),
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        assert proc.stderr is not None
        for line in proc.stderr:
            stderr_lines.append(line.rstrip())
            if on_progress:
                m = PROGRESS_RE.search(line)
                on_progress(float(m.group(1)) if m else None, line.rstrip())
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise ReviewerError(
            f"解析が時間内に終わりませんでした（{timeout}秒）。"
            "局を絞る（例: E1,E2）か、時間を延ばしてください。"
        )
    finally:
        if proc.poll() is None:
            proc.kill()

    tail = _error_summary(stderr_lines)
    if proc.returncode != 0 or not out_path.is_file():
        out_path.unlink(missing_ok=True)
        raise ReviewerError(
            "mjai-reviewer の実行が失敗しました（終了コード "
            f"{proc.returncode}）。\n\n"
            f"実行したコマンド:\n{' '.join(cmd)}\n\n"
            f"エラー出力（末尾）:\n{tail}"
        )

    data = json.loads(out_path.read_text(encoding="utf-8"))
    return data, RunInfo(
        command=cmd, json_path=out_path, from_cache=False, stderr_tail=tail
    )


def _error_summary(lines: list[str]) -> str:
    """エラー出力から、原因が書かれている部分を取り出す。"""
    for i, line in enumerate(lines):
        if line.startswith("Error:") or ": error:" in line:
            # anyhow の "Error: ... / Caused by: ..." の部分だけを見せる
            # （その後ろに続く長いスタックトレースは省く）
            picked = []
            for ln in lines[i:i + 20]:
                if BACKTRACE_RE.match(ln) or "backtrace" in ln.lower():
                    break
                if ln.strip().startswith("note:"):
                    continue
                picked.append(ln)
            return "\n".join(picked).strip()
    return "\n".join(lines[-20:])


def list_logs(settings: Settings) -> list[Path]:
    """logs_dir にある牌譜ファイルの一覧。"""
    logs_dir = settings.path("logs_dir")
    if not logs_dir.is_dir():
        return []
    return sorted(
        (p for p in logs_dir.glob("*.json") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def peek_log(log_path: str | Path) -> dict:
    """牌譜ファイルからプレイヤー名などを読み取る（tenhou.net/6 形式）。"""
    data = json.loads(Path(log_path).read_text(encoding="utf-8"))
    return {
        "names": data.get("name") or [],
        "rule": (data.get("rule") or {}).get("disp", ""),
        "ref": data.get("ref"),
        "kyoku_count": len(data.get("log") or []),
    }
