# control-deck

A Next.js 16 control surface for local + hosted AI workflows — chat, dojo, tool runs, live music, agent-go, etc. Runs on Bun.

## Setup

```bash
bun install
```

## Run

```bash
bun run dev
```

Dev server: <http://localhost:3333>.

Other scripts:

| Command | What it does |
|---|---|
| `bun run dev` | Next dev server on :3333 |
| `bun run build` | Next production build |
| `bun run start` | Next production server on :3333 |
| `bun run lint` | ESLint (next lint) |
| `bun run terminal-service` | Standalone PTY terminal service (see `scripts/terminal-service.ts`) |

## Environment

Copy / create `.env.local` at the repo root. Notable variables:

- `DECK_TOKEN` — bearer token required on every `/api/*` request (see `middleware.ts`). **If this is unset or empty, API auth is disabled** and the deck is fully open (file upload, code exec, search proxy, etc. all exposed). Set it for any non-local deployment.
- Provider API keys (set the ones you use): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `HUGGINGFACE_API_KEY`, `OPENROUTER_API_KEY`.
- Local-LLM endpoints (optional): `OLLAMA_HOST`, `LLAMA_SERVER_URL`, `VLLM_URL`, `LMSTUDIO_URL`.
- `LLM_PROVIDER`, `LLM_MODEL` — default provider + model for new chats.

## Package manager

This project standardizes on **bun** (lockfile: `bun.lock`). `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` are gitignored — don't add them.

## Full-stack helper

`start-full-stack.sh` boots the Next app alongside the auxiliary services (AGUI backend, Comfy, etc.). Read the script before running — it assumes a specific local layout.
