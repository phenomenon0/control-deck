#!/usr/bin/env python3
"""
Smoke-test a local Qwen2.5-Omni snapshot for Deck voice work.

Default mode validates files, config, tokenizer, and processor without loading
the full model. Use --full to attempt generation on a CUDA-capable machine.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REQUIRED_FILES = [
    "config.json",
    "generation_config.json",
    "model.safetensors.index.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "preprocessor_config.json",
    "spk_dict.pt",
]


def fail(message: str, code: int = 1) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(code)


def validate_snapshot(model_dir: Path) -> dict:
    if not model_dir.exists():
        fail(f"model dir does not exist: {model_dir}")

    missing = [name for name in REQUIRED_FILES if not (model_dir / name).exists()]
    if missing:
      fail(f"missing required files: {', '.join(missing)}")

    incomplete = list(model_dir.rglob("*.incomplete"))
    if incomplete:
        fail(f"download has incomplete files: {incomplete[0]}")

    shards = sorted(model_dir.glob("model-*-of-*.safetensors"))
    if len(shards) != 4:
        fail(f"expected 4 safetensor shards, found {len(shards)}")

    shard_bytes = sum(path.stat().st_size for path in shards)
    if shard_bytes < 10 * 1024**3:
        fail(f"weight shards look too small: {shard_bytes / 1024**3:.2f} GiB")

    config = json.loads((model_dir / "config.json").read_text())
    if config.get("model_type") != "qwen2_5_omni":
        fail(f"unexpected model_type: {config.get('model_type')}")
    if not config.get("enable_audio_output"):
        fail("config does not enable audio output")

    quant = config.get("quantization_config") or {}
    if quant.get("quant_method") != "awq" or quant.get("bits") != 4:
        fail(f"unexpected quantization_config: {quant}")

    print(f"snapshot: ok ({shard_bytes / 1024**3:.2f} GiB weights)")
    return config


def validate_processor(model_dir: Path) -> None:
    from transformers import AutoConfig, Qwen2_5OmniProcessor

    cfg = AutoConfig.from_pretrained(model_dir, local_files_only=True, trust_remote_code=True)
    if cfg.model_type != "qwen2_5_omni":
        fail(f"AutoConfig resolved wrong model_type: {cfg.model_type}")

    processor = Qwen2_5OmniProcessor.from_pretrained(
        model_dir,
        local_files_only=True,
        trust_remote_code=True,
    )
    prompt = processor.apply_chat_template(
        [
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "You are Qwen, a virtual human developed by the Qwen Team, "
                            "Alibaba Group, capable of perceiving auditory and visual "
                            "inputs, as well as generating text and speech."
                        ),
                    }
                ],
            },
            {"role": "user", "content": [{"type": "text", "text": "Say one short sentence."}]},
        ],
        add_generation_prompt=True,
        tokenize=False,
    )
    if "<|im_start|>" not in prompt:
        fail("processor chat template did not produce a Qwen prompt")
    print("processor: ok")


def run_full_generation(model_dir: Path, output: Path, allow_cpu: bool) -> None:
    import torch
    import soundfile as sf
    from transformers import Qwen2_5OmniForConditionalGeneration, Qwen2_5OmniProcessor

    if not torch.cuda.is_available() and not allow_cpu:
        fail("CUDA is not available; rerun with --allow-cpu if you intentionally want a very slow CPU test", 2)

    try:
        import awq  # noqa: F401
    except Exception:
        print("WARN: autoawq/awq import failed; Transformers may still load if native AWQ support is available")

    processor = Qwen2_5OmniProcessor.from_pretrained(
        model_dir,
        local_files_only=True,
        trust_remote_code=True,
    )
    model = Qwen2_5OmniForConditionalGeneration.from_pretrained(
        model_dir,
        local_files_only=True,
        torch_dtype="auto",
        device_map="auto" if torch.cuda.is_available() else "cpu",
        trust_remote_code=True,
    )

    conversation = [
        {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "You are Qwen, a virtual human developed by the Qwen Team, "
                        "Alibaba Group, capable of perceiving auditory and visual "
                        "inputs, as well as generating text and speech."
                    ),
                }
            ],
        },
        {"role": "user", "content": [{"type": "text", "text": "Reply with: Deck voice test passed."}]},
    ]

    text = processor.apply_chat_template(conversation, add_generation_prompt=True, tokenize=False)
    inputs = processor(text=[text], return_tensors="pt", padding=True)
    inputs = {k: v.to(model.device) if hasattr(v, "to") else v for k, v in inputs.items()}

    text_ids, audio = model.generate(**inputs, return_audio=True, spk="Chelsie", max_new_tokens=48)
    decoded = processor.batch_decode(text_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)
    print("text:", decoded[0] if decoded else "<empty>")

    output.parent.mkdir(parents=True, exist_ok=True)
    waveform = audio.reshape(-1).detach().cpu().float().numpy()
    sf.write(output, waveform, 24000)
    print(f"audio: {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default="models/qwen2.5-omni-7b-awq")
    parser.add_argument("--full", action="store_true", help="load the model and generate text+audio")
    parser.add_argument("--allow-cpu", action="store_true", help="allow full generation without CUDA")
    parser.add_argument("--output", default="data/artifacts/qwen-omni-smoke.wav")
    args = parser.parse_args()

    model_dir = Path(args.model_dir).resolve()
    validate_snapshot(model_dir)
    validate_processor(model_dir)

    if args.full:
        run_full_generation(model_dir, Path(args.output).resolve(), args.allow_cpu)
    else:
        print("full generation: skipped (use --full on a CUDA-capable host)")


if __name__ == "__main__":
    main()
