# Copilot Token Tracker

Track **real** GitHub Copilot token usage by parsing Copilot Chat trace logs — actual API token counts, cost estimation, ROI tracking, and usage breakdown by model & category.

Unlike plugins that estimate via local tokenizers, this extension reads the actual `prompt_tokens` / `completion_tokens` values returned directly by the Copilot API (both OpenAI and Anthropic formats).

## Features

### Dashboard
- **5 stat cards** — Today's tokens, today's cost, range tokens, range cost, cache hit rate
- **ROI tracker** — Compare your actual API-equivalent cost against your Copilot subscription to see real value
- **4 interactive charts** — Daily token usage (stacked bar), model cost distribution (doughnut), daily cost trend (line), cumulative tokens (area)
- **Usage by category** — Breakdown by chat, sub-agent, internal, and unknown
- **Usage by model** — Per-model token counts, request counts, and cost
- **API pricing reference** — Full model pricing table

### Token Tracking
- **Accurate counts** — Reads actual API usage values from trace logs
- **Cache token support** — Tracks cache creation, cache read, and standard input/output tokens separately
- **Fast mode detection** — Identifies and prices fast mode model variants (e.g. `claude-opus-4.6-fast`)
- **Multi-format parsing** — Supports both OpenAI (`prompt_tokens`/`completion_tokens`) and Anthropic (`input_tokens`/`output_tokens` + cache fields) formats
- **Category tracking** — Classifies usage as chat, sub-agent, internal, or unknown via `ccreq` correlation

### Status Bar
- **Live cost display** — Shows today's estimated cost in the status bar
- **ROI percentage** — Color-coded ROI indicator (green when ≥ 100%)
- **Click to open** — Opens the full dashboard

### Settings
- **Date ranges** — 7d / 30d / 90d / All time
- **Configurable subscription** — Set your monthly Copilot cost for accurate ROI calculation
- **Auto trace enable** — Attempts to enable trace logging automatically on startup

## ⚠️ Required: Enable Trace Logging

Token data only appears when the Copilot Chat extension logs at **Trace** level. The extension tries to enable this automatically, but you can also do it manually:

1. Open the Command Palette (`⌘⇧P` / `Ctrl⇧P`)
2. Run `Developer: Set Log Level...`
3. Select **GitHub Copilot Chat**
4. Choose **Trace**

> **Note:** Trace logs are verbose. The extension only reads token usage data from them.

## Installation

Install from a `.vsix` file:

```bash
code --install-extension copilot-token-tracker-1.0.0.vsix
```

Or build from source:

```bash
git clone https://github.com/darrel/copilot-token-tracker.git
cd copilot-token-tracker
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension copilot-token-tracker-1.0.0.vsix
```

## Commands

| Command | Description |
|---------|-------------|
| `Copilot Token Tracker: Open Dashboard` | Open the token usage dashboard |
| `Copilot Token Tracker: Reset All Data` | Wipe all stored usage data |
| `Copilot Token Tracker: How to Enable Trace Logging` | Instructions popup |

## How It Works

1. On activation, the extension locates the GitHub Copilot Chat log file relative to its own `context.logUri` (both VS Code stable and Insiders are supported).
2. It watches the file via `fs.watch()` and tails new content, scanning for `"usage"` JSON objects in both OpenAI and Anthropic SSE formats.
3. Token events are correlated with `ccreq` lines (within a 500ms window) to determine the usage category (chat / sub-agent / internal).
4. Model names are cached from multiple log line types (`message_start`, `ccreq` info, debug lines) to ensure accurate attribution.
5. Events are stored in VS Code `globalState` keyed by date, model, and category — auto-trimmed to 365 days.
6. The status bar and dashboard update in real time on each new event.

## Cost Estimation

Costs shown are **API-equivalent estimates** based on public list pricing (USD per 1M tokens). They do **not** represent your actual GitHub Copilot subscription cost, which is a flat monthly fee. Use these numbers to understand:
- How much value you're getting relative to your subscription (ROI)
- Which models consume the most budget
- Whether cache hits are saving you money

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `copilotTokenTracker.enabled` | `true` | Enable/disable tracking |
| `copilotTokenTracker.showStatusBar` | `true` | Show cost & ROI in status bar |
| `copilotTokenTracker.defaultModel` | `claude-3-5-sonnet` | Fallback model for cost estimation |
| `copilotTokenTracker.monthlySubscriptionCost` | `39` | Your monthly Copilot subscription cost (USD) for ROI calculation |

## Supported Models

GPT-5.4, GPT-5.4-mini, GPT-5.4-nano, GPT-4o, GPT-4o-mini, Claude Opus 4.7, Claude Opus 4.6 (+ fast), Claude Sonnet 4.6/4.5/4, Claude Haiku 4.5/3.5, o3-mini, o1, and more.

## License

MIT
