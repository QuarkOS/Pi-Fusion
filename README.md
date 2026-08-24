# Pi Fusion

A multi-model deliberation harness for the [Pi Coding Agent](https://pi.dev). Pi Fusion takes any complex technical question and runs it through a structured deliberation pipeline -- parallel expert panels, comparative analysis, and grounded synthesis -- producing answers that are more thorough and balanced than any single model can achieve alone.

Inspired by the [OpenRouter Fusion](https://openrouter.ai/docs/features/fusion) design pattern. Written in Node.js with native ES Modules, requires no build steps, and ships with presets for OpenCode Go and OpenCode Zen.

---

## How It Works

### 5x Mode (Full Pipeline)

```
                  [User Query]
                       |
         +-------------+-------------+
         |             |             |
         v             v             v
    [Technical]    [Devil's]     [Systems]       Tier 1: Parallel Panel
     [Expert]     [Advocate]    [Thinker]        (3 models, run in parallel)
         |             |             |
         +-------------+-------------+
                       |
                       v
               [Deliberation]                    Tier 2: Judge
                  [Judge]                        (Structured JSON comparison)
                       |
                       v
                 [Synthesis]                     Tier 3: Synthesis
                   [Model]                       (Grounded final answer)
                       |
                       v
                [Final Answer]
```

Five LLM calls total. Each panel expert has a different system prompt persona. The Judge produces structured JSON (`consensus`, `contradictions`, `partial_coverage`, `unique_insights`, `blind_spots`). The Synthesis model resolves the contradictions and produces the final answer.

### 3x Mode (Lean Pipeline)

Three LLM calls instead of five. Two parallel experts (Technical + Devil's Advocate) followed by one synthesizer that absorbs the Judge and Systems Thinker roles. Roughly 40% cheaper than 5x mode while preserving the core deliberation benefit.

---

## Presets

IDs below were checked on 2026-08-24 against [OpenCode Go](https://opencode.ai/docs/go/), `GET https://opencode.ai/zen/go/v1/models`, [OpenCode Zen](https://opencode.ai/docs/zen/), and `GET https://opencode.ai/zen/v1/models`. Do not copy a Zen-only id into a Go preset.

| Preset | Mode | Models | Catalog | Use case |
|--------|------|--------|---------|----------|
| **GLM-5.3 Fusion** | 3x | All `glm-5.3` | OpenCode Go | Default. Latest GLM on Go. |
| **Balanced** | 5x | `kimi-k3`, `deepseek-v4-pro`, `glm-5.3` | OpenCode Go | Three labs, still on the Go subscription. |
| **High Quality** | 5x | `kimi-k3`, `qwen3.8-max` | OpenCode Go | Kimi + latest Qwen on Go (`qwen3.8-max` is not on Zen). |
| **Quality / Frontier** | 5x | `grok-4.6`, `gpt-5.6-luna`, `kimi-k3` | OpenCode Zen | Newest Grok. `grok-4.6` is not on Go. |
| **Custom** | 5x | User-defined | Any | Full control over every model slot. |

Role assignments:

- **GLM Fusion.** Every slot is `glm-5.3` on Go. Zen still lists `glm-5.2` as its newest GLM, so this preset stays on Go.
- **Balanced.** Technical Expert and Synthesis: `kimi-k3`. Devil's Advocate and Judge: `deepseek-v4-pro`. Systems Thinker: `glm-5.3`.
- **High Quality.** Technical Expert, Systems Thinker, and Synthesis: `kimi-k3`. Devil's Advocate and Judge: `qwen3.8-max`.
- **Quality / Frontier.** Technical Expert and Synthesis: `grok-4.6`. Devil's Advocate and Judge: `gpt-5.6-luna`. Systems Thinker: `kimi-k3`. Served from `https://opencode.ai/zen/v1` with `OPENCODE_API_KEY`. If you must stay on Go, the equivalent Grok slot is `grok-4.5`, not 4.6.

### Which catalog an id lives on

| ID | OpenCode Go (`/zen/go/v1`) | OpenCode Zen (`/zen/v1`) | Notes |
|----|----------------------------|--------------------------|-------|
| `glm-5.3` | yes | no | Newest GLM on Go. Zen's newest GLM is `glm-5.2`. |
| `kimi-k3` | yes | yes | Newest Kimi on both. |
| `deepseek-v4-pro` | yes | yes | |
| `deepseek-v4-flash` | yes | yes | Default file-agent model. |
| `qwen3.8-max` | yes | no | High Quality stays on Go for this reason. |
| `gpt-5.6-luna` | yes | yes | Also on the public OpenAI API. |
| `grok-4.5` | yes | yes | Newest Grok **on Go**. |
| `grok-4.6` | no | yes | xAI id `grok-4.6` (12 Aug 2026). Also `https://api.x.ai/v1`. Putting this on a Go 3x preset will 404. |
| `gpt-5.6-sol` | no | yes | Public OpenAI flagship. Used for the packaged `openai` provider, not for Go. |

Go also lists `grok-4.5`, `glm-5.2`, `kimi-k2.7-code`, and others. Those still work; the presets pick the newest id that exists on that catalog.

---

## Getting Started

### Install as a Pi Extension

```bash
pi install git:github.com/QuarkOS/Pi-Fusion.git
```

Or from npm:

```bash
pi install npm:@quarkos/pi-fusion
```

The Pi extension uses `@earendil-works/pi-ai`, which Pi already provides. The standalone CLI does not need that package.

### Set Your API Key

The default presets use OpenCode Go. Set the API key in your environment:

**Windows (PowerShell):**
```powershell
$env:OC_GO_CC_API_KEY = "sk-opencode-..."
```

**Linux / macOS:**
```bash
export OC_GO_CC_API_KEY="sk-opencode-..."
```

The Quality / Frontier preset uses OpenCode Zen (`OPENCODE_API_KEY`) because `grok-4.6` is not on the Go catalog. The same OpenCode account key often works for both endpoints.

If no OpenCode key is found, the client falls back to `OPENAI_API_KEY` and standard OpenAI endpoints. Pi Fusion also reads keys from Pi's own `auth.json` if you have connected a provider through Pi.

### Choose a Preset

Inside Pi, run `/fusion-config` to select a preset interactively. From the CLI, run:

```bash
npx @quarkos/pi-fusion --setup
```

---

## Usage

### Inside Pi

Once installed, two features are available:

- **`/fusion <prompt>`** -- Runs the full deliberation pipeline and streams the synthesized answer into your Pi session.
- **`deliberate` tool** -- Available to the Pi agent itself. When solving complex tasks, the agent can call this tool to get a multi-model deliberation on a sub-problem.

### As a Model Provider

Pi Fusion registers itself as a model provider called `fusion`. You can select it as your active model in Pi's model picker, and every message you send will go through the deliberation pipeline automatically. The synthesis streams token-by-token, and any generated code is routed through a file-agent that saves files to disk using Pi's `write` tool.

### Command Line

Submit a one-off query:
```bash
npx @quarkos/pi-fusion "Explain the tradeoffs between microservices and monoliths"
```

Interactive REPL mode:
```bash
npx @quarkos/pi-fusion --interactive
```

Verbose mode (shows individual panel responses):
```bash
npx @quarkos/pi-fusion "Write a thread-safe singleton in Go" --verbose
```

Override specific model slots:
```bash
npx @quarkos/pi-fusion "Test query" --models "judge=glm-5.3,synthesis=deepseek-v4-pro"
```

---

## Architecture

```
index.js              Pi extension entry point (provider, commands, tools)
bin/pi-harness.js     Standalone CLI with setup wizard
lib/api.js            OpenAI-compatible streaming API client with retry logic
lib/config.js         Packaged default config (shared by CLI and Pi entry)
lib/presets.js        Go / Zen / OpenAI model IDs and preset maps
lib/deliberation.js   Deliberation orchestrator (3x and 5x modes)
lib/ui.js             Terminal formatting for CLI output
```

The API client streams all responses to prevent gateway timeouts, accumulates token usage across calls, handles Kimi-specific temperature constraints (`temperature: 1.0`), and retries transient network errors with exponential backoff. The file-agent step after synthesis uses `deepseek-v4-flash` (cheap, near-unlimited on OpenCode Go) with tool-calling to decide what files to save.

---

## Configuration

Pi Fusion looks for a `pi-harness.config.json` in your working directory. If none exists, it uses the packaged default: **3x GLM-5.3 Fusion** on OpenCode Go (`https://opencode.ai/zen/go/v1`). That file also includes an OpenCode Zen provider (`https://opencode.ai/zen/v1`, `grok-4.6`) and a public OpenAI provider (`https://api.openai.com/v1`, `gpt-5.6-sol`). The config file is generated automatically when you run the setup wizard.

Key fields:

| Field | Description |
|-------|-------------|
| `provider` | Which provider to use (`opencode-go`, `opencode-zen`, `openai`) |
| `mode` | `3x` (lean) or `5x` (full pipeline) |
| `providers.<name>.defaultModels` | Model IDs for each pipeline slot |
| `panel.<role>.systemPrompt` | Custom system prompts per expert |
| `judge.systemPrompt` | Judge comparison instructions |
| `synthesis.systemPrompt` | Final synthesis instructions |
| `fileAgentModel` | Model used for the file-saving step (default: `deepseek-v4-flash`) |

---

## Development

```bash
git clone https://github.com/QuarkOS/Pi-Fusion.git
cd Pi-Fusion
npm install
```

```bash
npm test                  # Offline unit tests (no API keys)
npm run test:stream       # Stream protocol tests (offline, no pi-ai)
npm run test:live         # Live API deliberation (needs OC_GO_CC_API_KEY)
```

---

## License

[MIT](LICENSE)
