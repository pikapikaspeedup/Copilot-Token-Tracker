export type UsageCategory = 'chat' | 'subagent' | 'internal' | 'unknown';

export interface TokenUsageEvent {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    model?: string;
    category: UsageCategory;
    categoryDetail?: string; // e.g. "tool/runSubagent-Explore"
    timestamp: number;
}

// OpenAI format: "prompt_tokens": N, "completion_tokens": N
const OPENAI_PATTERN = /"prompt_tokens"\s*:\s*(\d+)[^}]*?"completion_tokens"\s*:\s*(\d+)/;
const OPENAI_PATTERN_ALT = /"completion_tokens"\s*:\s*(\d+)[^}]*?"prompt_tokens"\s*:\s*(\d+)/;

// Anthropic format fields (each captured independently)
const ANTHROPIC_OUTPUT = /"output_tokens"\s*:\s*(\d+)/;
const ANTHROPIC_INPUT = /"input_tokens"\s*:\s*(\d+)/;
const ANTHROPIC_CACHE_CREATE = /"cache_creation_input_tokens"\s*:\s*(\d+)/;
const ANTHROPIC_CACHE_READ = /"cache_read_input_tokens"\s*:\s*(\d+)/;

// OpenAI cached_tokens inside prompt_tokens_details
const OPENAI_CACHED = /"cached_tokens"\s*:\s*(\d+)/;

// Model name extraction
const MODEL_PATTERN = /"model"\s*:\s*"([^"]{3,80})"/;

// Speed mode (Anthropic fast mode: "speed":"fast")
const SPEED_PATTERN = /"speed"\s*:\s*"(fast)"/;

// Model name from info/debug lines: e.g. "chat model claude-opus-4.6-fast"
// or "success | claude-opus-4.6-fast -> claude-opus-4-6"
const INFO_MODEL_PATTERN = /chat model\s+([\w.-]+)/;
const INFO_SUCCESS_PATTERN = /success\s*\|\s*([\w.-]+)\s*->/;

/**
 * Extract model name (with speed suffix) from any log line.
 * Returns the raw model string, or undefined if not found.
 * Used by LogWatcher to cache the model for subsequent usage lines.
 */
export function extractModelFromLine(line: string): string | undefined {
    // Priority 1: "chat model <name>" debug lines (includes -fast suffix already)
    const infoMatch = INFO_MODEL_PATTERN.exec(line);
    if (infoMatch) {
        return infoMatch[1];
    }

    // Priority 2: "success | <name> -> <api-name>" info lines
    const successMatch = INFO_SUCCESS_PATTERN.exec(line);
    if (successMatch) {
        return successMatch[1];
    }

    // Priority 3: message_start SSE with "model" field
    if (line.includes('"message_start"') && line.includes('"model"')) {
        const modelMatch = MODEL_PATTERN.exec(line);
        if (modelMatch) {
            let model = modelMatch[1];
            const speedMatch = SPEED_PATTERN.exec(line);
            if (speedMatch && !model.includes('fast')) {
                model = model + '-fast';
            }
            return model;
        }
    }

    return undefined;
}

export function parseTokenUsage(line: string): TokenUsageEvent | null {
    // Quick bail: skip lines with no token hint
    if (!line.includes('token') && !line.includes('"usage"')) {
        return null;
    }

    // Skip message_start lines — they have initial sentinel values (1,1), not final usage
    if (line.includes('"message_start"')) {
        return null;
    }

    let inputTokens: number | undefined;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens: number | undefined;

    // Try OpenAI format first
    let match = OPENAI_PATTERN.exec(line);
    if (match) {
        inputTokens = parseInt(match[1], 10);
        outputTokens = parseInt(match[2], 10);
        // Check for OpenAI cached_tokens (subtracted from input)
        const cachedMatch = OPENAI_CACHED.exec(line);
        if (cachedMatch) {
            cacheReadTokens = parseInt(cachedMatch[1], 10);
            inputTokens = Math.max(0, inputTokens - cacheReadTokens);
        }
    }

    if (inputTokens === undefined) {
        match = OPENAI_PATTERN_ALT.exec(line);
        if (match) {
            outputTokens = parseInt(match[1], 10);
            inputTokens = parseInt(match[2], 10);
            const cachedMatch = OPENAI_CACHED.exec(line);
            if (cachedMatch) {
                cacheReadTokens = parseInt(cachedMatch[1], 10);
                inputTokens = Math.max(0, inputTokens - cacheReadTokens);
            }
        }
    }

    // Try Anthropic format: separate fields for input, cache_creation, cache_read, output
    if (inputTokens === undefined) {
        const outMatch = ANTHROPIC_OUTPUT.exec(line);
        const inMatch = ANTHROPIC_INPUT.exec(line);
        if (outMatch && inMatch) {
            inputTokens = parseInt(inMatch[1], 10);
            outputTokens = parseInt(outMatch[1], 10);
            const cacheCreate = ANTHROPIC_CACHE_CREATE.exec(line);
            const cacheRead = ANTHROPIC_CACHE_READ.exec(line);
            if (cacheCreate) { cacheCreationTokens = parseInt(cacheCreate[1], 10); }
            if (cacheRead) { cacheReadTokens = parseInt(cacheRead[1], 10); }
        }
    }

    if (inputTokens === undefined || outputTokens === undefined) {
        return null;
    }

    // Skip clearly invalid values
    if (inputTokens === 0 && outputTokens === 0 && cacheCreationTokens === 0 && cacheReadTokens === 0) {
        return null;
    }

    const modelMatch = MODEL_PATTERN.exec(line);
    let rawModel = modelMatch?.[1];

    // Append "-fast" if speed mode detected on the same line
    if (rawModel) {
        const speedMatch = SPEED_PATTERN.exec(line);
        if (speedMatch && !rawModel.includes('fast')) {
            rawModel = rawModel + '-fast';
        }
    }

    return {
        inputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        outputTokens,
        model: rawModel,  // may be undefined — logWatcher will fill from cache
        category: 'unknown',
        timestamp: Date.now(),
    };
}

/**
 * Parse a ccreq success line and return the usage category and detail.
 * Format: "ccreq:xxx | success | model | latency | [用途]"
 */
const CCREQ_PATTERN = /ccreq:[^\s]+\s*\|\s*success\s*\|.*\|\s*\[([^\]]+)\]/;

export function parseCcreqLine(line: string): { category: UsageCategory; detail: string; model?: string } | null {
    if (!line.includes('ccreq:') || !line.includes('success')) return null;

    const match = CCREQ_PATTERN.exec(line);
    if (!match) return null;

    const detail = match[1]; // e.g. "panel/editAgent", "tool/runSubagent-Explore", "copilotLanguageModelWrapper"

    // Extract model from the same line
    const modelMatch = INFO_SUCCESS_PATTERN.exec(line);
    const model = modelMatch?.[1];

    let category: UsageCategory;
    if (detail.includes('panel/') || detail === 'retry-error-panel/editAgent') {
        category = 'chat';
    } else if (detail.includes('tool/runSubagent')) {
        category = 'subagent';
    } else {
        // copilotLanguageModelWrapper, progressMessages, title, promptCategorization, summarize*
        category = 'internal';
    }

    return { category, detail, model };
}

/**
 * Normalize various model name strings to a canonical key.
 * e.g. "gpt-4o-2024-11-20" → "gpt-4o"
 */
export function normalizeModelName(model?: string): string {
    if (!model) return 'unknown';

    const lower = model.toLowerCase();

    // Detect fast mode suffix
    const isFast = lower.includes('-fast');
    const base = lower.replace(/-fast$/, '');

    let normalized: string;

    // OpenAI
    if (base.includes('gpt-5.4-nano') || base.includes('gpt-5-4-nano')) normalized = 'gpt-5.4-nano';
    else if (base.includes('gpt-5.4-mini') || base.includes('gpt-5-4-mini')) normalized = 'gpt-5.4-mini';
    else if (base.includes('gpt-5.4') || base.includes('gpt-5-4')) normalized = 'gpt-5.4';
    else if (base.includes('o3-mini')) normalized = 'o3-mini';
    else if (base.includes('o1-mini')) normalized = 'o1-mini';
    else if (base.includes('o1')) normalized = 'o1';
    else if (base.includes('gpt-4o-mini')) normalized = 'gpt-4o-mini';
    else if (base.includes('gpt-4o')) normalized = 'gpt-4o';
    else if (base.includes('gpt-4-turbo')) normalized = 'gpt-4-turbo';
    else if (base.includes('gpt-4')) normalized = 'gpt-4';

    // Anthropic — match longer names first
    else if (base.includes('claude-opus-4-7') || base.includes('claude-opus-4.7')) normalized = 'claude-opus-4.7';
    else if (base.includes('claude-opus-4-6') || base.includes('claude-opus-4.6')) normalized = 'claude-opus-4.6';
    else if (base.includes('claude-opus-4-5') || base.includes('claude-opus-4.5')) normalized = 'claude-opus-4.5';
    else if (base.includes('claude-opus-4-1') || base.includes('claude-opus-4.1')) normalized = 'claude-opus-4';
    else if (base.includes('claude-opus-4') || base.includes('claude-4-opus')) normalized = 'claude-opus-4';
    else if (base.includes('claude-sonnet-4-6') || base.includes('claude-sonnet-4.6')) normalized = 'claude-sonnet-4.6';
    else if (base.includes('claude-sonnet-4-5') || base.includes('claude-sonnet-4.5')) normalized = 'claude-sonnet-4.5';
    else if (base.includes('claude-sonnet-4') || base.includes('claude-4-sonnet')) normalized = 'claude-sonnet-4';
    else if (base.includes('claude-3-7-sonnet') || base.includes('claude-3.7-sonnet')) normalized = 'claude-3-7-sonnet';
    else if (base.includes('claude-3-5-sonnet') || base.includes('claude-3.5-sonnet')) normalized = 'claude-3-5-sonnet';
    else if (base.includes('claude-haiku-4-5') || base.includes('claude-haiku-4.5')) normalized = 'claude-haiku-4.5';
    else if (base.includes('claude-3-5-haiku') || base.includes('claude-3.5-haiku')) normalized = 'claude-3-5-haiku';
    else if (base.includes('claude-3-haiku')) normalized = 'claude-3-haiku';
    else if (base.includes('claude-3-opus')) normalized = 'claude-3-opus';
    else normalized = base.split('-').slice(0, 3).join('-');

    return isFast ? normalized + '-fast' : normalized;
}
