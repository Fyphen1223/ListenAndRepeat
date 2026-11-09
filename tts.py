#!/usr/bin/env python3
"""output.jsonl から全問題の音声を Kokoro TTS で生成するスクリプト。

1 問題（1 レコード）につき 7 文の音声を生成し、
audio/<問題番号>/<問題番号>-<文番号>.wav として保存する。
生成に使った声・話速・難易度などの情報は、output.jsonl の各文の
"audio" フィールドに書き戻す。

例:
    audio/1/1-1.wav ... audio/1/1-7.wav
    audio/2/2-1.wav ... audio/2/2-7.wav

使い方:
    pip install kokoro soundfile
    python tts.py                 # 未生成のファイルだけ生成
    python tts.py --force         # すべて上書き再生成
    python tts.py --limit 5       # 先頭 5 問だけ
    python tts.py --start 10      # 10 問目から
    python tts.py --voice af_heart  # 声を固定
    python tts.py --speed 1.0     # 話速を固定（既定は文ごとに 0.9〜1.2 でランダム）
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "output.jsonl"
DEFAULT_AUDIO_DIR = ROOT / "audio"

# 1 セット（問題）内では同じ声を使う。声の頭文字が言語コードになる。
#   a*: American English / b*: British English
# Kokoro の英語ボイスを網羅的に登録（af_nicole は除外）。
SPEAKERS = [
    # American English - female
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_heart",
    "af_jessica",
    "af_kore",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
    # American English - male
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_liam",
    "am_michael",
    "am_onyx",
    "am_puck",
    "am_santa",
    # British English - female
    "bf_alice",
    "bf_emma",
    "bf_isabella",
    "bf_lily",
    # British English - male
    "bm_daniel",
    "bm_fable",
    "bm_george",
    "bm_lewis",
]

SAMPLE_RATE = 24000

# 話速は文ごとに 0.9〜1.2 の範囲でランダムに散らす
SPEED_MIN = 0.9
SPEED_MAX = 1.2

# lang_code ごとに KPipeline を使い回す（モデルの再読み込みを避ける）
_pipelines: dict[str, KPipeline] = {}


def load_problems(path: Path) -> list[dict]:
    """JSONL を読み込み、問題（レコード）のリストを返す。"""
    problems: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                problems.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(
                    f"[warn] {path.name}:{line_no} を読み飛ばしました ({exc})",
                    file=sys.stderr,
                )
    return problems


def save_problems(path: Path, problems: list[dict]) -> None:
    """問題リストを JSONL に書き戻す（一時ファイル経由で安全に置換）。"""
    tmp_path = path.with_name(path.name + ".tmp")
    with tmp_path.open("w", encoding="utf-8", newline="\n") as f:
        for problem in problems:
            f.write(
                json.dumps(problem, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
    tmp_path.replace(path)


def relative_audio_path(path: Path) -> str:
    """プロジェクト直下からの相対パス（例: audio/1/1-1.wav）を返す。"""
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def update_audio_metadata(
    entry: object,
    *,
    out_path: Path,
    set_id: object,
    question_number: int,
    difficulty: str,
    voice: str | None,
    speed: float | None,
) -> None:
    """文エントリに音声メタデータを付与する（辞書以外は何もしない）。"""
    if not isinstance(entry, dict):
        return

    previous = entry.get("audio")
    audio = dict(previous) if isinstance(previous, dict) else {}
    audio.update(
        {
            "file": relative_audio_path(out_path),
            "set_id": set_id,
            "question_number": question_number,
            "difficulty": difficulty,
            "voice": voice,
            "speed": speed,
        }
    )
    entry["audio"] = audio


def update_set_tts(problem: dict) -> None:
    """セット全体の TTS 情報（使用した声・記録済みの文数など）を更新する。"""
    voices: list[str] = []
    recorded = 0
    for entry in problem.get("sentences", []):
        if not isinstance(entry, dict):
            continue
        audio = entry.get("audio")
        if not isinstance(audio, dict):
            continue
        if audio.get("voice") and audio.get("speed") is not None:
            recorded += 1
        if audio.get("voice"):
            voices.append(str(audio["voice"]))

    if not recorded:
        return

    unique_voices = sorted(set(voices))
    problem["tts"] = {
        "engine": "kokoro",
        "sample_rate": SAMPLE_RATE,
        "voice": unique_voices[0] if len(unique_voices) == 1 else "mixed",
        "recorded_count": recorded,
        "updated_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    }


def get_pipeline(lang_code: str) -> KPipeline:
    if lang_code not in _pipelines:
        print(f"Kokoro モデルを読み込み中 (lang_code={lang_code!r}) ...", flush=True)
        _pipelines[lang_code] = KPipeline(lang_code=lang_code)
    return _pipelines[lang_code]


def lang_code_for(voice: str) -> str:
    """話者名の先頭文字から lang_code を決める（af_bella -> 'a'）。"""
    return voice[0] if voice and voice[0] in ("a", "b") else "a"


def synthesize(pipeline: KPipeline, text: str, voice: str, speed: float) -> np.ndarray:
    """1 文を音声化して float32 の波形を返す。"""
    chunks: list[np.ndarray] = []
    for result in pipeline(text, voice=voice, speed=speed, split_pattern=r"\n+"):
        # kokoro のバージョンによって Result オブジェクトかタプルで返る
        audio = result.audio if hasattr(result, "audio") else result[2]
        if audio is not None:
            chunks.append(np.asarray(audio, dtype=np.float32))

    if not chunks:
        raise RuntimeError(f"音声が生成されませんでした: {text!r}")

    if len(chunks) == 1:
        return chunks[0]

    # 長文が分割された場合は無音を挟んで連結する
    silence = np.zeros(int(SAMPLE_RATE * 0.15), dtype=np.float32)
    joined: list[np.ndarray] = []
    for i, chunk in enumerate(chunks):
        if i:
            joined.append(silence)
        joined.append(chunk)
    return np.concatenate(joined)


def sentence_text(entry: object) -> str:
    if isinstance(entry, dict):
        return str(entry.get("sentence", "")).strip()
    return str(entry).strip()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Kokoro TTS で output.jsonl の全問題の音声を生成する"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help="入力 JSONL（既定: output.jsonl）",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_AUDIO_DIR,
        help="音声の出力先（既定: audio）",
    )
    parser.add_argument(
        "--start", type=int, default=1, help="開始する問題番号（1 始まり）"
    )
    parser.add_argument("--limit", type=int, default=None, help="生成する問題数の上限")
    parser.add_argument(
        "--voice",
        default=None,
        help="全問題で使う声（例: af_heart）。未指定なら問題ごとにランダム",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=None,
        help="話速を固定（未指定なら文ごとに 0.9〜1.2 でランダム）",
    )
    parser.add_argument(
        "--seed", type=int, default=None, help="声のランダム割り当てのシード"
    )
    parser.add_argument("--force", action="store_true", help="既存の wav も上書きする")
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    all_problems = load_problems(args.input)
    if not all_problems:
        print(f"問題が 1 件もありません: {args.input}", file=sys.stderr)
        return 1

    start = max(1, args.start)
    selected = all_problems[start - 1 :]
    if args.limit is not None:
        selected = selected[: max(0, args.limit)]

    rng = random.Random(args.seed)
    out_dir_root: Path = args.out_dir

    print(f"{len(selected)} 問の音声を生成します -> {out_dir_root}")

    generated = skipped = failed = 0
    metadata_dirty = False
    write_failed = False

    def flush_metadata() -> None:
        """output.jsonl に音声メタデータを書き戻す。"""
        nonlocal metadata_dirty, write_failed
        if not metadata_dirty or write_failed:
            return
        try:
            save_problems(args.input, all_problems)
            metadata_dirty = False
        except OSError as exc:
            write_failed = True
            print(
                f"[warn] {args.input} にメタデータを書き戻せませんでした: {exc}",
                file=sys.stderr,
            )

    try:
        for offset, problem in enumerate(selected):
            problem_index = start + offset
            raw_sentences = problem.get("sentences", [])
            if not any(sentence_text(s) for s in raw_sentences):
                print(
                    f"[warn] 問題 {problem_index}: 文がないためスキップ",
                    file=sys.stderr,
                )
                continue

            # 通常は既存の音声を維持する。--force の再生成時は SPEAKERS から
            # 再抽選し、追加した声も既存セットへ反映できるようにする。
            existing_voice = next(
                (
                    str(entry["audio"]["voice"])
                    for entry in raw_sentences
                    if isinstance(entry, dict)
                    and isinstance(entry.get("audio"), dict)
                    and entry["audio"].get("voice")
                ),
                None,
            )
            voice = args.voice or (None if args.force else existing_voice) or rng.choice(SPEAKERS)
            pipeline: KPipeline | None = None

            out_dir = out_dir_root / str(problem_index)
            out_dir.mkdir(parents=True, exist_ok=True)

            topic = problem.get("topic", "")
            print(
                f"[{problem_index}] {topic} "
                f"({len(raw_sentences)} 文, voice={voice})"
            )

            for sentence_index, entry in enumerate(raw_sentences, start=1):
                text = sentence_text(entry)
                if not text:
                    continue

                out_path = out_dir / f"{problem_index}-{sentence_index}.wav"
                difficulty = (
                    str(entry.get("difficulty", "medium"))
                    if isinstance(entry, dict)
                    else "medium"
                )

                if out_path.exists() and not args.force:
                    previous = entry.get("audio") if isinstance(entry, dict) else None
                    update_audio_metadata(
                        entry,
                        out_path=out_path,
                        set_id=problem.get("id", problem_index),
                        question_number=sentence_index,
                        difficulty=difficulty,
                        voice=(
                            previous.get("voice")
                            if isinstance(previous, dict)
                            else None
                        ),
                        speed=(
                            previous.get("speed")
                            if isinstance(previous, dict)
                            else None
                        ),
                    )
                    metadata_dirty = True
                    print(f"  - skip {out_path.name}（既存）")
                    skipped += 1
                    continue

                # 話速は文ごとに 0.9〜1.2 でランダムに散らす
                speed = (
                    args.speed
                    if args.speed is not None
                    else round(rng.uniform(SPEED_MIN, SPEED_MAX), 2)
                )

                try:
                    if pipeline is None:
                        pipeline = get_pipeline(lang_code_for(voice))
                    audio = synthesize(pipeline, text, voice, speed)
                    sf.write(out_path, audio, SAMPLE_RATE)
                except Exception as exc:  # 1 文失敗しても残りを続ける
                    print(f"  - 失敗 {out_path.name}: {exc}", file=sys.stderr)
                    failed += 1
                    continue

                update_audio_metadata(
                    entry,
                    out_path=out_path,
                    set_id=problem.get("id", problem_index),
                    question_number=sentence_index,
                    difficulty=difficulty,
                    voice=voice,
                    speed=speed,
                )
                metadata_dirty = True
                print(f"  - {out_path.name} (speed={speed}): {text}")
                generated += 1

            update_set_tts(problem)
            # 途中で止まってもメタデータが残るよう、セットごとに書き戻す
            flush_metadata()
    finally:
        flush_metadata()

    print()
    print(f"完了: 生成 {generated} / スキップ {skipped} / 失敗 {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
