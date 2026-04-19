import * as vscode from 'vscode';
import { normalizeModelName, UsageCategory } from './tokenParser';

export interface ModelData {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    requests: number;
}

export interface CategoryData {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    requests: number;
}

export interface DayRecord {
    date: string; // YYYY-MM-DD
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    requestCount: number;
    models: Record<string, ModelData>;
    categories?: Record<string, CategoryData>;
}

export interface TokenEvent {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    model?: string;
    category?: UsageCategory;
    categoryDetail?: string;
    timestamp: number;
}

const STORAGE_KEY = 'tokenUsageData';

export class TokenStore {
    constructor(private readonly globalState: vscode.Memento) {}

    private loadAll(): DayRecord[] {
        return this.globalState.get<DayRecord[]>(STORAGE_KEY, []);
    }

    private async saveAll(records: DayRecord[]): Promise<void> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 365);
        const cutoffStr = toDateString(cutoff);
        const trimmed = records.filter(r => r.date >= cutoffStr);
        await this.globalState.update(STORAGE_KEY, trimmed);
    }

    async addUsage(event: TokenEvent): Promise<void> {
        const records = this.loadAll();
        const dateKey = toDateString(new Date(event.timestamp));
        const modelKey = normalizeModelName(event.model);

        let day = records.find(r => r.date === dateKey);
        if (!day) {
            day = { date: dateKey, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requestCount: 0, models: {}, categories: {} };
            records.push(day);
            records.sort((a, b) => a.date.localeCompare(b.date));
        }

        const n = (v: number | undefined | null) => v ?? 0;
        day.inputTokens += n(event.inputTokens);
        day.cacheCreationTokens += n(event.cacheCreationTokens);
        day.cacheReadTokens += n(event.cacheReadTokens);
        day.outputTokens += n(event.outputTokens);
        day.requestCount += 1;

        if (!day.models[modelKey]) {
            day.models[modelKey] = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requests: 0 };
        }
        day.models[modelKey].inputTokens += n(event.inputTokens);
        day.models[modelKey].cacheCreationTokens += n(event.cacheCreationTokens);
        day.models[modelKey].cacheReadTokens += n(event.cacheReadTokens);
        day.models[modelKey].outputTokens += n(event.outputTokens);
        day.models[modelKey].requests += 1;

        // Category tracking
        const catKey = event.category ?? 'unknown';
        if (!day.categories) day.categories = {};
        if (!day.categories[catKey]) {
            day.categories[catKey] = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requests: 0 };
        }
        day.categories[catKey].inputTokens += n(event.inputTokens);
        day.categories[catKey].cacheCreationTokens += n(event.cacheCreationTokens);
        day.categories[catKey].cacheReadTokens += n(event.cacheReadTokens);
        day.categories[catKey].outputTokens += n(event.outputTokens);
        day.categories[catKey].requests += 1;

        await this.saveAll(records);
    }

    getRange(days: number): DayRecord[] {
        const all = this.loadAll();
        if (days <= 0) return all;

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days + 1);
        const cutoffStr = toDateString(cutoff);
        return all.filter(r => r.date >= cutoffStr);
    }

    getToday(): DayRecord | undefined {
        const todayKey = toDateString(new Date());
        return this.loadAll().find(r => r.date === todayKey);
    }

    async resetAll(): Promise<void> {
        await this.globalState.update(STORAGE_KEY, []);
    }

    getModelTotals(records: DayRecord[]): Record<string, ModelData> {
        const totals: Record<string, ModelData> = {};
        for (const day of records) {
            for (const [model, data] of Object.entries(day.models)) {
                if (!totals[model]) totals[model] = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requests: 0 };
                const n = (v: number | undefined | null) => v ?? 0;
                totals[model].inputTokens += n(data.inputTokens);
                totals[model].cacheCreationTokens += n(data.cacheCreationTokens);
                totals[model].cacheReadTokens += n(data.cacheReadTokens);
                totals[model].outputTokens += n(data.outputTokens);
                totals[model].requests += n(data.requests);
            }
        }
        return totals;
    }

    getCategoryTotals(records: DayRecord[]): Record<string, CategoryData> {
        const totals: Record<string, CategoryData> = {};
        for (const day of records) {
            if (!day.categories) continue;
            for (const [cat, data] of Object.entries(day.categories)) {
                if (!totals[cat]) totals[cat] = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requests: 0 };
                const n = (v: number | undefined | null) => v ?? 0;
                totals[cat].inputTokens += n(data.inputTokens);
                totals[cat].cacheCreationTokens += n(data.cacheCreationTokens);
                totals[cat].cacheReadTokens += n(data.cacheReadTokens);
                totals[cat].outputTokens += n(data.outputTokens);
                totals[cat].requests += n(data.requests);
            }
        }
        return totals;
    }
}

export function toDateString(date: Date): string {
    return date.toISOString().substring(0, 10);
}
