/**
 * USD per 1 million tokens — public API list pricing (2026-04 snapshot).
 *
 * Fields:
 *   input        — standard input tokens
 *   cacheWrite   — Anthropic cache_creation_input_tokens (1.25× base) / OpenAI prompt_cache_miss
 *   cacheRead    — Anthropic cache_read_input_tokens (0.1× base) / OpenAI cached_tokens
 *   output       — completion / output tokens
 */
export interface ModelPricing {
    input: number;
    cacheWrite: number;
    cacheRead: number;
    output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
    // ── OpenAI (2026-04) ─────────────────────────────────────────
    'gpt-5.4':          { input:  2.50, cacheWrite:  2.50, cacheRead: 0.25,  output: 15.00 },
    'gpt-5.4-mini':     { input:  0.75, cacheWrite:  0.75, cacheRead: 0.075, output:  4.50 },
    'gpt-5.4-nano':     { input:  0.20, cacheWrite:  0.20, cacheRead: 0.02,  output:  1.25 },
    'gpt-4o':           { input:  2.50, cacheWrite:  2.50, cacheRead: 1.25,  output: 10.00 },
    'gpt-4o-mini':      { input:  0.15, cacheWrite:  0.15, cacheRead: 0.075, output:  0.60 },
    'gpt-4-turbo':      { input: 10.00, cacheWrite: 10.00, cacheRead: 5.00,  output: 30.00 },
    'gpt-4':            { input: 30.00, cacheWrite: 30.00, cacheRead: 15.00, output: 60.00 },
    'o1':               { input: 15.00, cacheWrite: 15.00, cacheRead: 7.50,  output: 60.00 },
    'o1-mini':          { input:  3.00, cacheWrite:  3.00, cacheRead: 1.50,  output: 12.00 },
    'o3-mini':          { input:  1.10, cacheWrite:  1.10, cacheRead: 0.55,  output:  4.40 },

    // ── Anthropic (2026-04) ──────────────────────────────────────
    // cache_write = 1.25× input,  cache_read = 0.1× input
    'claude-opus-4.7':  { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
    'claude-opus-4.6':  { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
    'claude-opus-4.5':  { input:  5.00, cacheWrite:  6.25, cacheRead: 0.50, output: 25.00 },
    'claude-opus-4':    { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },
    'claude-sonnet-4.6':{ input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
    'claude-sonnet-4.5':{ input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
    'claude-sonnet-4':  { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
    'claude-3-7-sonnet':{ input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
    'claude-3-5-sonnet':{ input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
    'claude-haiku-4.5': { input:  1.00, cacheWrite:  1.25, cacheRead: 0.10, output:  5.00 },
    'claude-3-5-haiku': { input:  0.80, cacheWrite:  1.00, cacheRead: 0.08, output:  4.00 },
    'claude-3-haiku':   { input:  0.25, cacheWrite:  0.30, cacheRead: 0.03, output:  1.25 },
    'claude-3-opus':    { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },

    // ── Anthropic Fast Mode (6× standard, cache multipliers stack) ──
    // Fast mode: input=6×base, output=6×base, cacheWrite=1.25×fast, cacheRead=0.1×fast
    'claude-opus-4.6-fast':  { input: 30.00, cacheWrite: 37.50, cacheRead: 3.00, output: 150.00 },
    'claude-sonnet-4.6-fast':{ input: 18.00, cacheWrite: 22.50, cacheRead: 1.80, output: 90.00 },

    // Fallback
    'unknown':          { input:  3.00, cacheWrite:  3.75, cacheRead: 0.30, output: 15.00 },
};

export function getPricing(model: string): ModelPricing {
    return MODEL_PRICING[model] ?? MODEL_PRICING['unknown'];
}

/**
 * Estimate cost in USD, correctly charging each token category at its own rate.
 */
export function estimateCost(
    inputTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
    outputTokens: number,
    model: string
): number {
    const p = getPricing(model);
    return (
        inputTokens          * p.input      +
        cacheCreationTokens  * p.cacheWrite +
        cacheReadTokens      * p.cacheRead  +
        outputTokens         * p.output
    ) / 1_000_000;
}

export function formatCost(usd: number): string {
    if (usd < 0.001) return `$${(usd * 1000).toFixed(3)} m¢`;
    return `$${usd.toFixed(4)}`;
}
