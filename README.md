# Pi Fusion

A multi-model deliberation harness for the [Pi Coding Agent](https://pi.dev). Pi Fusion takes any complex technical question and runs it through a structured deliberation pipeline -- parallel expert panels, comparative analysis, and grounded synthesis -- producing answers that are more thorough and balanced than any single model can achieve alone.

Inspired by the [OpenRouter Fusion](https://openrouter.ai/docs/features/fusion) design pattern. Written in Node.js with native ES Modules, requires no build steps, and ships with ready-to-use presets for OpenCode Go subscription models.

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

| Preset | Mode | Models | Provider | Use Case |
|--------|------|--------|----------|----------|
| **GLM-5.2 Fusion** | 3x | All `glm-5.2` | OpenCode Go | Default. Fast, cheap, 1M context. |
| **Balanced** | 5x | `kimi-k2.7-code`, `deepseek-v4-pro`, `kimi-k2.6` | OpenCode Go | Best coding quality per LiveBench. |
| **Quality / Frontier** | 5x | `opus-4.8`, `gpt-5.5`, `gemini-3.1-pro` | OpenAI | Highest quality, highest cost. |
| **Custom** | 5x | User-defined | Any | Full control over every model slot. |

The Balanced preset assigns models based on [LiveBench](https://livebench.ai) coding and reasoning averages:

- **Technical Expert** and **Synthesis**: `kimi-k2.7-code` (top global coding average)
- **Devil's Advocate** and **Judge**: `deepseek-v4-pro` (strong reasoning, critical analysis)
- **Systems Thinker**: `kimi-k2.6` (high global average, holistic reasoning)

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

If no OpenCode Go key is found, the client falls back to `OPENAI_API_KEY` and standard OpenAI endpoints. Pi Fusion also reads keys from Pi's own `auth.json` if you have connected a provider through Pi.

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
npx @quarkos/pi-fusion "Test query" --models "judge=glm-5.2,synthesis=deepseek-v4-pro"
```

---

## Architecture

```
index.js              Pi extension entry point (provider, commands, tools)
bin/pi-harness.js     Standalone CLI with setup wizard
lib/api.js            OpenAI-compatible streaming API client with retry logic
lib/deliberation.js   Deliberation orchestrator (3x and 5x modes)
lib/ui.js             Terminal formatting for CLI output
```

The API client streams all responses to prevent gateway timeouts, accumulates token usage across calls, handles Kimi-specific temperature constraints (`temperature: 1.0`), and retries transient network errors with exponential backoff. The file-agent step after synthesis uses `deepseek-v4-flash` (cheap, near-unlimited on OpenCode Go) with tool-calling to decide what files to save.

---

## Configuration

Pi Fusion looks for a `pi-harness.config.json` in your working directory. If none exists, it uses built-in defaults. The config file is generated automatically when you run the setup wizard.

Key fields:

| Field | Description |
|-------|-------------|
| `provider` | Which provider to use (`opencode-go`, `openai`) |
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

Run the full test suite (requires a valid `OC_GO_CC_API_KEY`):

```bash
npm test                  # Live API deliberation test
npm run verify:stream     # Offline stream protocol tests
```

---

## License

[MIT](LICENSE)
