# Voice harness fixtures

The harness reuses the public-domain LibriSpeech samples that ship with the
sherpa-streaming engine bundle:

```
models/voice-engines/sherpa-streaming/test_wavs/
├── 0.wav      # ~6.5s · "after early nightfall the yellow lamps would light up..."
├── 1.wav      # ~16s  · "god as a direct consequence of the sin which man thus punished..."
├── 8k.wav     # ~2.4s · "yet these thoughts affected hester prynne less with hope..."
└── trans.txt  # ground-truth transcripts
```

All three are 16-bit PCM mono, 16 kHz — exactly the format voice-core's
`/stt/stream` endpoint expects, so no resampling is needed.

To add a new fixture:

1. Record a clean mono WAV (16-bit PCM, 16 kHz). `ffmpeg -i input.m4a -ac 1 -ar 16000 -sample_fmt s16 out.wav` works.
2. Drop it next to the existing fixtures.
3. Add the expected transcript prefix to `tests/voice-harness/e2e/newsroom-liveblog.spec.ts` if the e2e should assert on it.

The batch runner (`tests/voice-harness/run-batch.ts`) accepts a glob, so any
`.wav` matching `--wavs '<glob>'` will be picked up.
