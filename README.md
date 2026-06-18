# Pi Fusion

Pi Fusion is an orchestration harness and agent extension that implements a multi-model deliberation pipeline. Inspired by the OpenRouter Fusion design pattern, it takes any complex technical request or coding query and runs it through a three-tier process: parallel expert panels, a structured comparative analysis, and a final grounded synthesis.

It is written in Node.js with native ES Modules, requires no build steps, and features out-of-the-box configuration for OpenCode Go subscription models.

---

## How It Works

The deliberation pipeline consists of three sequential stages:

```
                  [User Query]
                       |
         +-------------+-------------+
         |             |             |
         v             v             v
    [Technical]    [Devil's]     [Systems]       Tier 1: Parallel Panel
     [Expert]     [Advocate]    [Thinker]        (System Prompt Personas)
         |             |             |
         +-------------+-------------+
                       |
                       v
               [Deliberation]                    Tier 2: Judge
                  [Judge]                        (Structured JSON output)
                       |
                       v
                 [Synthesis]                     Tier 3: Synthesis
                   [Model]                       (Grounded final answer)
                       |
                       v
                [Final Answer]
```

### Tier 1: Panel (Parallel Execution)
The user query is sent to three separate expert models in parallel:
* **Technical Expert** (`qwen3.7-plus`): Evaluates correctness, architectural patterns, performance, and security.
* **Devil's Advocate** (`deepseek-v4-pro`): Challenges assumptions, identifies edge cases, highlights risks, and evaluates simpler alternatives.
* **Systems Thinker** (`glm-5.1`): Focuses on integration, API design, testing strategies, long-term technical debt, and maintainability.

### Tier 2: Judge (Deliberative Analysis)
A comparison model (`qwen3.7-plus`) reviews the panel responses to find agreements and conflicts. It produces a structured JSON output with five keys:
* `consensus`: Core technical decisions where the experts agree.
* `contradictions`: Specific design conflicts or tradeoffs.
* `partial_coverage`: Points raised by some but not all models.
* `unique_insights`: Non-obvious optimizations or approaches.
* `blind_spots`: Critical omissions or risks that none of the models addressed.

### Tier 3: Synthesis (Final Grounded Answer)
A final model (`qwen3.7-plus`) synthesizes the user query, the panel responses, and the Judge's structured JSON analysis into a comprehensive markdown answer.

### 3x mode (cheap, single-model fusion)
The default out-of-the-box mode is the **GLM-5.2 Fusion (Best · 3x)** preset: all roles use `glm-5.2` (1M context, open-weight coding/agent SOTA) and the pipeline collapses to **3 LLM calls** instead of 5 — 2 parallel experts (Technical + Devil's Advocate) followed by 1 synthesizer that absorbs the Judge + Systems Thinker roles. This cuts cost ~40% vs the full 5-call pipeline while keeping the deliberation value. Switch presets with `/fusion-config` (or `pi-harness --setup`) to return to the full 5-call panel→judge→synthesis flow.

---

## Configuration and Setup

1. Install dependencies in your project directory:
   ```bash
   npm install
   ```

2. Set your OpenCode Go API key:
   * **Windows (PowerShell)**:
     ```powershell
     $env:OC_GO_CC_API_KEY="sk-opencode-..."
     ```
   * **Linux/macOS**:
     ```bash
     export OC_GO_CC_API_KEY="sk-opencode-..."
     ```

If no OpenCode Go key is found, the client looks for a standard `OPENAI_API_KEY` and falls back to standard OpenAI endpoints.

---

## Command Line Usage

You can run Pi Fusion directly as a command-line tool.

### Direct Run
Submit a query from the terminal:
```bash
node bin/pi-harness.js "Explain the tradeoffs between microservices and monoliths"
```

### Verbose Mode
Use the `--verbose` or `-v` flag to inspect the individual panel responses:
```bash
node bin/pi-harness.js "Write a thread-safe singleton pattern in Go" --verbose
```

### Interactive Mode (REPL)
Launch a persistent chat session to run multiple queries:
```bash
node bin/pi-harness.js --interactive
```

### Model Overrides
You can override default models for any tier using the `--models` flag:
```bash
node bin/pi-harness.js "Test query" --models "technical_expert=deepseek-v4-pro,judge=glm-5.1"
```

---

## Installing as a Pi Agent Extension

Pi Fusion is designed to be fully compatible with the Pi Coding Agent (pi.dev). When installed, it adds a `/fusion` command and a `deliberate` tool to the agent.

Install the extension from GitHub:
```bash
pi install git:github.com/QuarkOS/Pi-Fusion.git
```

Or install it locally from your project folder:
```bash
pi install .
```

### Registered Features inside Pi:
* **Slash Command**: `/fusion <prompt>` — Runs the multi-model deliberation pipeline directly in your Pi terminal session.
* **Agent Tool**: `deliberate` — Allows the Pi Coding Agent to call this deliberation process programmatically when solving complex coding problems.
