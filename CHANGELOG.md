# Changelog

## [Unreleased]

### Added
- Added Claude Opus 4.7 model normalization and pricing support

## [1.0.0] - 2025-07-17

### Features
- **Dashboard** with 5 stat cards, 4 charts, and 3 tables
  - Daily Token Usage stacked bar chart (input / cache write / cache read / output)
  - Model Cost Distribution doughnut chart
  - Daily Cost Trend line chart
  - Cumulative Tokens area chart
  - Usage by Category table (chat / sub-agent / internal / unknown)
  - Usage by Model table with per-model cost breakdown
  - API Pricing Reference table
- **ROI Tracking** — compare API-equivalent cost against your Copilot subscription
  - ROI card with progress bar, projected month-end cost, breakeven day
  - Color-coded ROI in status bar (green when ≥ 100%)
- **Cache Token Support** — track cache creation, cache read, and standard tokens separately
  - Cache hit rate stat card
  - Cache efficiency metrics
- **Fast Mode Detection** — identifies `-fast` speed mode variants with separate pricing
- **Category Tracking** — classifies usage as chat, sub-agent, internal, or unknown via `ccreq` line correlation
- **Multi-Format Parsing** — OpenAI (`prompt_tokens`/`completion_tokens`) and Anthropic (`input_tokens`/`output_tokens` + cache fields)
- **Model Name Caching** — extracts model from `message_start`, `ccreq` info lines, and debug lines
- **Status Bar** — live cost + ROI% display, click to open dashboard
- **Date Range Selector** — 7d / 30d / 90d / All time
- **Auto Trace Enable** — attempts to set Copilot Chat log level to Trace on activation
- **Configurable Subscription Cost** — set your monthly Copilot cost for accurate ROI calculation
- **365-day data retention** with automatic trimming

### Supported Models
- GPT-5.4, GPT-5.4-mini, GPT-5.4-nano
- GPT-4o, GPT-4o-mini
- Claude Opus 4.6 (+ fast mode), Claude Opus 4.5
- Claude Sonnet 4.6, 4.5, 4
- Claude Haiku 4.5, 3.5
- o3-mini, o1

## [0.4.0] - 2025-07-16

- Added usage category tracking (chat / sub-agent / internal / unknown)
- Added `ccreq` line parsing for category correlation
- Added category breakdown table in dashboard

## [0.3.0] - 2025-07-16

- Added ROI tracking with configurable subscription cost
- Added fast mode detection and pricing
- Added model name caching across log line types
- Enhanced status bar with ROI percentage

## [0.2.0] - 2025-07-15

- Added cache token support (cache_creation / cache_read)
- Added 4-category cost estimation
- Added cache hit rate stat card
- Added Model Cost Distribution chart

## [0.1.0] - 2025-07-15

- Initial release
- Basic token counting from trace logs
- OpenAI and Anthropic format support
- Daily usage bar chart and cumulative trend
- Per-model breakdown table
- Status bar with token count
