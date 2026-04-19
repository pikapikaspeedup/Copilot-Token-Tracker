import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TokenStore, DayRecord, toDateString } from '../tokenStore';
import { estimateCost, formatCost, MODEL_PRICING } from '../pricing';

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private rangeDays = 30;

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly store: TokenStore
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg: unknown) => this.handleMessage(msg),
            null,
            this.disposables
        );
        this.render();
    }

    static createOrShow(extensionUri: vscode.Uri, store: TokenStore): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.panel.reveal(column);
            DashboardPanel.currentPanel.render();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'copilotTokenDashboard',
            'Copilot Token Tracker',
            column ?? vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, store);
    }

    refresh(): void {
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.render();
        }
    }

    private handleMessage(msg: unknown): void {
        if (!msg || typeof msg !== 'object') return;
        const message = msg as Record<string, unknown>;

        if (message.command === 'setRange') {
            this.rangeDays = Number(message.days) || 30;
            this.sendData();
        } else if (message.command === 'ready') {
            this.sendData();
        }
    }

    private sendData(): void {
        const records = this.store.getRange(this.rangeDays);
        const modelTotals = this.store.getModelTotals(records);
        const today = this.store.getToday();

        // Subscription cost setting
        const subscriptionCost: number = vscode.workspace
            .getConfiguration('copilotTokenTracker')
            .get<number>('monthlySubscriptionCost', 39);

        // Current calendar month records (for ROI calculation, always use current month)
        const now = new Date();
        const monthStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
        const allRecords = this.store.getRange(0);
        const monthRecords = allRecords.filter(r => r.date >= monthStart);
        const monthModelTotals = this.store.getModelTotals(monthRecords);
        const monthCost = Object.entries(monthModelTotals).reduce((s, [model, data]) => {
            const n = (v: number | null | undefined) => v ?? 0;
            return s + estimateCost(n(data.inputTokens), n(data.cacheCreationTokens), n(data.cacheReadTokens), n(data.outputTokens), model);
        }, 0);
        const roiPct = subscriptionCost > 0 ? Math.round((monthCost / subscriptionCost) * 100) : 0;

        // Days elapsed and remaining in current month
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dayOfMonth = now.getDate();
        const daysElapsed = dayOfMonth;
        const daysRemaining = daysInMonth - dayOfMonth;
        // Projected month-end cost based on daily run rate
        const dailyRate = daysElapsed > 0 ? monthCost / daysElapsed : 0;
        const projectedMonthCost = dailyRate * daysInMonth;
        const projectedROI = subscriptionCost > 0 ? Math.round((projectedMonthCost / subscriptionCost) * 100) : 0;
        // Projected breakeven day (day of month when cumulative cost reaches subscriptionCost)
        const breakevenDay = dailyRate > 0 ? Math.ceil(subscriptionCost / dailyRate) : null;

        // Fill missing days in the range with zero records
        const filled = fillDateRange(records, this.rangeDays);

        // Cumulative series
        let cumTotal = 0;
        const cumulative = filled.map(d => {
            cumTotal += d.inputTokens + d.cacheCreationTokens + d.cacheReadTokens + d.outputTokens;
            return { date: d.date, total: cumTotal };
        });

        // Totals for range
        const rangeInput = records.reduce((s, r) => s + r.inputTokens, 0);
        const rangeCacheCreate = records.reduce((s, r) => s + r.cacheCreationTokens, 0);
        const rangeCacheRead = records.reduce((s, r) => s + r.cacheReadTokens, 0);
        const rangeOutput = records.reduce((s, r) => s + r.outputTokens, 0);
        const rangeRequests = records.reduce((s, r) => s + r.requestCount, 0);

        // Cost per model
        const modelCosts = Object.entries(modelTotals).map(([model, data]) => {
            const cost = estimateCost(data.inputTokens, data.cacheCreationTokens, data.cacheReadTokens, data.outputTokens, model);
            return {
                model,
                inputTokens: data.inputTokens,
                cacheCreationTokens: data.cacheCreationTokens,
                cacheReadTokens: data.cacheReadTokens,
                outputTokens: data.outputTokens,
                requests: data.requests,
                cost,
                costStr: formatCost(cost),
            };
        });
        modelCosts.sort((a, b) => b.cost - a.cost);

        const totalCost = modelCosts.reduce((s, m) => s + m.cost, 0);
        const todayCost = today
            ? Object.entries(today.models).reduce(
                  (s, [model, data]) => {
                      const n = (v: number | null | undefined) => v ?? 0;
                      return s + estimateCost(n(data.inputTokens), n(data.cacheCreationTokens), n(data.cacheReadTokens), n(data.outputTokens), model);
                  },
                  0
              )
            : 0;

        // Daily cost per day
        const dailyCosts = filled.map(d => {
            const n = (v: number | null | undefined) => v ?? 0;
            const dayCost = Object.entries(d.models).reduce((s, [model, data]) => {
                return s + estimateCost(n((data as any).inputTokens), n((data as any).cacheCreationTokens), n((data as any).cacheReadTokens), n((data as any).outputTokens), model);
            }, 0);
            return { date: d.date, cost: dayCost };
        });

        // Cache efficiency: what % of all input-side tokens came from cache reads
        const totalInputAll = rangeInput + rangeCacheCreate + rangeCacheRead;
        const cacheEfficiency = totalInputAll > 0 ? Math.round(rangeCacheRead / totalInputAll * 100) : 0;

        // Category breakdown
        const categoryTotals = this.store.getCategoryTotals(records);
        const categoryLabels: Record<string, string> = {
            chat: 'Your Chat',
            subagent: 'Sub-Agents',
            internal: 'Internal (auto)',
            unknown: 'Unknown',
        };
        const categoryCosts = Object.entries(categoryTotals).map(([cat, data]) => {
            const n = (v: number | null | undefined) => v ?? 0;
            // For category cost, we use a rough per-model average — just sum all token costs at a blended rate
            const total = n(data.inputTokens) + n(data.cacheCreationTokens) + n(data.cacheReadTokens) + n(data.outputTokens);
            // Use a simple cost estimate: assume same model distribution as the total
            const totalAllTokens = rangeInput + rangeCacheCreate + rangeCacheRead + rangeOutput;
            const costShare = totalAllTokens > 0 ? totalCost * (total / totalAllTokens) : 0;
            return {
                category: cat,
                label: categoryLabels[cat] || cat,
                requests: n(data.requests),
                inputTokens: n(data.inputTokens),
                cacheCreationTokens: n(data.cacheCreationTokens),
                cacheReadTokens: n(data.cacheReadTokens),
                outputTokens: n(data.outputTokens),
                total,
                costStr: formatCost(costShare),
            };
        }).sort((a, b) => b.total - a.total);

        this.panel.webview.postMessage({
            command: 'data',
            payload: {
                today: today ?? null,
                todayCostStr: formatCost(todayCost),
                rangeDays: this.rangeDays,
                rangeInput,
                rangeCacheCreate,
                rangeCacheRead,
                rangeOutput,
                rangeRequests,
                totalCostStr: formatCost(totalCost),
                daily: filled,
                cumulative,
                modelCosts,
                dailyCosts,
                cacheEfficiency,
                categoryCosts,
                subscriptionCost,
                monthCost,
                monthCostStr: formatCost(monthCost),
                roiPct,
                projectedROI,
                projectedMonthCostStr: formatCost(projectedMonthCost),
                breakevenDay,
                daysInMonth,
                dayOfMonth,
                daysRemaining,
            },
        });
    }

    private render(): void {
        const nonce = crypto.randomBytes(16).toString('hex');
        this.panel.webview.html = this.getHtml(nonce);
    }

    private getHtml(nonce: string): string {
        const csp = [
            `default-src 'none'`,
            `script-src https://cdn.jsdelivr.net 'nonce-${nonce}'`,
            `style-src 'unsafe-inline' https://fonts.googleapis.com`,
            `font-src https://fonts.gstatic.com`,
            `connect-src 'none'`,
            `img-src ${this.panel.webview.cspSource} data:`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<title>Copilot Token Tracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@300;400;500;600&display=swap"/>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:        var(--vscode-editor-background, #0d1117);
  --bg-card:   var(--vscode-editorWidget-background, #161b22);
  --fg:        var(--vscode-editor-foreground, #e6edf3);
  --fg-muted:  var(--vscode-descriptionForeground, #8b949e);
  --border:    var(--vscode-widget-border, rgba(255,255,255,0.08));
  --accent:    #3B82F6;
  --amber:     #F59E0B;
  --green:     #10b981;
  --red:       #ef4444;
  --radius:    10px;
  --font-body: 'Fira Sans', var(--vscode-font-family, sans-serif);
  --font-mono: 'Fira Code', var(--vscode-editor-font-family, monospace);
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  padding: 0;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}

/* ── Header ──────────────────────────────────────────────────── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.3px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.header h1 .dot {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--green);
  animation: pulse 2s infinite;
}
.header h1 .dot.inactive { background: var(--fg-muted); animation: none; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.range-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px;
}

.range-tabs button {
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--fg-muted);
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 13px;
  padding: 5px 14px;
  transition: background 150ms, color 150ms;
}
.range-tabs button:hover { color: var(--fg); background: rgba(255,255,255,0.05); }
.range-tabs button.active { background: var(--accent); color: #fff; }

/* ── Trace warning banner ─────────────────────────────────────── */
.banner {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius);
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--amber);
  display: none;
}
.banner.show { display: block; }
.banner strong { font-weight: 600; }
.banner code {
  background: rgba(245,158,11,0.18);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 6px;
}

/* ── Stats Grid ──────────────────────────────────────────────── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  transition: border-color 200ms;
}
.stat-card:hover { border-color: var(--accent); }

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.stat-value {
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
  margin-bottom: 6px;
  color: var(--fg);
}

.stat-sub {
  font-size: 12px;
  color: var(--fg-muted);
}

.stat-card.accent-blue .stat-value { color: var(--accent); }
.stat-card.accent-amber .stat-value { color: var(--amber); }
.stat-card.accent-green .stat-value { color: var(--green); }

/* ── Charts ──────────────────────────────────────────────────── */
.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

@media (max-width: 780px) {
  .charts-row { grid-template-columns: 1fr; }
}

.chart-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}

.chart-card h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-muted);
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.chart-wrapper {
  position: relative;
  height: 220px;
}

.chart-wrapper-donut {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
}

/* ── Tables ──────────────────────────────────────────────────── */
.table-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 16px;
  overflow-x: auto;
}

.table-card h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-muted);
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

thead th {
  text-align: left;
  padding: 8px 12px;
  color: var(--fg-muted);
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
}

tbody tr {
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 100ms;
}
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: rgba(255,255,255,0.03); }

tbody td {
  padding: 10px 12px;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 13px;
}

tbody td.label-col {
  font-family: var(--font-body);
  font-weight: 500;
}

.badge {
  display: inline-block;
  background: rgba(59,130,246,0.15);
  color: var(--accent);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: var(--font-mono);
}

.cost-hi { color: var(--amber); }

/* ── ROI Card ─────────────────────────────────────────────────── */
.roi-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 24px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 32px;
  flex-wrap: wrap;
}

.roi-card.roi-hit   { border-color: rgba(16,185,129,0.5); }
.roi-card.roi-close { border-color: rgba(245,158,11,0.4); }

.roi-left {
  flex: 0 0 auto;
}

.roi-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.roi-pct {
  font-family: var(--font-mono);
  font-size: 42px;
  font-weight: 700;
  line-height: 1;
  color: var(--fg);
}
.roi-pct.roi-pct-hit { color: var(--green); }
.roi-pct.roi-pct-close { color: var(--amber); }

.roi-sub {
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 6px;
}

.roi-right { flex: 1 1 300px; }

.roi-bar-wrap {
  background: rgba(255,255,255,0.06);
  border-radius: 99px;
  height: 12px;
  overflow: hidden;
  margin-bottom: 10px;
}

.roi-bar-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #3B82F6, #10b981);
  transition: width 600ms ease;
  max-width: 100%;
}
.roi-bar-fill.roi-bar-hit { background: linear-gradient(90deg, #10b981, #34d399); }

.roi-details {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.roi-detail-item {
  font-size: 13px;
  color: var(--fg-muted);
}

.roi-detail-item strong {
  color: var(--fg);
  font-family: var(--font-mono);
}

.roi-badge {
  display: inline-block;
  background: rgba(16,185,129,0.15);
  color: var(--green);
  border: 1px solid rgba(16,185,129,0.3);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  font-weight: 600;
}
.note {
  font-size: 11px;
  color: var(--fg-muted);
  text-align: center;
  margin-top: 32px;
  line-height: 1.8;
}
.note a { color: var(--accent); text-decoration: none; }
.note a:hover { text-decoration: underline; }

/* ── Empty state ─────────────────────────────────────────────── */
.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--fg-muted);
}
.empty .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.4; }
.empty h2 { font-size: 18px; font-weight: 500; margin-bottom: 8px; color: var(--fg); }
.empty p { font-size: 13px; line-height: 1.7; max-width: 420px; margin: 0 auto 16px; }
.empty code {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 8px;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <div class="header">
    <h1>
      <span class="dot inactive" id="statusDot"></span>
      Copilot Token Tracker
    </h1>
    <div class="range-tabs">
      <button data-days="7">7d</button>
      <button data-days="30" class="active">30d</button>
      <button data-days="90">90d</button>
      <button data-days="0">All</button>
    </div>
  </div>

  <!-- Trace warning -->
  <div class="banner" id="traceBanner">
    <strong>Trace logging may not be active.</strong>
    Enable it for accurate counts:
    <code>Developer: Set Log Level...</code> → choose <code>GitHub Copilot Chat</code> → <code>Trace</code>
  </div>

  <!-- Main content (shown when data exists) -->
  <div id="mainContent" style="display:none">
    <!-- Stats cards -->
    <div class="stats-grid">
      <div class="stat-card accent-blue">
        <div class="stat-label">Today · Total Tokens</div>
        <div class="stat-value" id="todayTotal">--</div>
        <div class="stat-sub" id="todaySplit">input -- / cache-w -- / cache-r -- / output --</div>
      </div>
      <div class="stat-card accent-amber">
        <div class="stat-label">Today · Est. Cost</div>
        <div class="stat-value" id="todayCost">--</div>
        <div class="stat-sub">API-equivalent pricing</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label"><span id="rangeLabel">30d</span> · Total Tokens</div>
        <div class="stat-value" id="rangeTotal">--</div>
        <div class="stat-sub" id="rangeSplit">input -- / cache-w -- / cache-r -- / output --</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><span id="rangeLabel2">30d</span> · Est. Cost</div>
        <div class="stat-value" id="rangeCost">--</div>
        <div class="stat-sub" id="rangeRequests">-- requests</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label">Cache Hit Rate</div>
        <div class="stat-value" id="cacheEfficiency">--%</div>
        <div class="stat-sub" id="cacheHitSub">of input served from cache</div>
      </div>
    </div>

    <!-- ROI tracker -->
    <div class="roi-card" id="roiCard">
      <div class="roi-left">
        <div class="roi-label">月度订阅 ROI</div>
        <div class="roi-pct" id="roiPct">--%</div>
        <div class="roi-sub" id="roiSub">¥-- / $-- 订阅费</div>
      </div>
      <div class="roi-right">
        <div class="roi-bar-wrap">
          <div class="roi-bar-fill" id="roiBarFill" style="width:0%"></div>
        </div>
        <div class="roi-details">
          <div class="roi-detail-item">本月 API 等价: <strong id="roiMonthCost">--</strong></div>
          <div class="roi-detail-item">预计月末: <strong id="roiProjected">--</strong></div>
          <div class="roi-detail-item" id="roiBreakevenWrap">回本日: <strong id="roiBreakeven">--</strong></div>
        </div>
      </div>
    </div>

    <!-- Charts Row 1 -->
    <div class="charts-row">
      <div class="chart-card">
        <h2>Daily Token Usage</h2>
        <div class="chart-wrapper">
          <canvas id="dailyChart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h2>Model Cost Distribution</h2>
        <div class="chart-wrapper chart-wrapper-donut">
          <canvas id="donutChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Charts Row 2 -->
    <div class="charts-row">
      <div class="chart-card">
        <h2>Daily Cost Trend (USD)</h2>
        <div class="chart-wrapper">
          <canvas id="costChart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h2>Cumulative Tokens</h2>
        <div class="chart-wrapper">
          <canvas id="trendChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Usage Category Breakdown -->
    <div class="table-card">
      <h2>Usage by Category</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Requests</th>
            <th>Input</th>
            <th>Cache Write</th>
            <th>Cache Read</th>
            <th>Output</th>
            <th>Total</th>
            <th>Est. Cost</th>
          </tr>
        </thead>
        <tbody id="categoryTableBody"></tbody>
      </table>
    </div>

    <!-- Model Breakdown -->
    <div class="table-card">
      <h2>Usage by Model</h2>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Requests</th>
            <th>Input</th>
            <th>Cache Write</th>
            <th>Cache Read</th>
            <th>Output</th>
            <th>Total</th>
            <th>Est. Cost</th>
          </tr>
        </thead>
        <tbody id="modelTableBody"></tbody>
      </table>
    </div>

    <!-- Cost Reference -->
    <div class="table-card">
      <h2>API Pricing Reference (USD per 1M tokens)</h2>
      <table id="pricingTable">
        <thead>
          <tr>
            <th>Model</th>
            <th>Input</th>
            <th>Cache Write</th>
            <th>Cache Read</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody id="pricingTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- Empty state -->
  <div id="emptyState" style="display:none">
    <div class="empty">
      <div class="empty-icon">📊</div>
      <h2>No token data yet</h2>
      <p>
        Start a Copilot Chat conversation and make sure
        <strong>Trace</strong> logging is enabled for accurate counts.
      </p>
      <p>
        Open Command Palette → <code>Developer: Set Log Level...</code><br/>
        Select <code>GitHub Copilot Chat</code> → <code>Trace</code>
      </p>
    </div>
  </div>

  <div class="note">
    Token counts are read from the Copilot Chat trace log.<br/>
    Costs are <em>estimated</em> based on public API list prices — not your actual GitHub Copilot subscription cost.<br/>
    Data is stored locally in VS Code extension global state.
  </div>
</div>

<script nonce="${nonce}">
  /* global Chart */
  const vscode = acquireVsCodeApi();

  // Chart instances
  let dailyChart = null;
  let trendChart = null;
  let donutChart = null;
  let costChart = null;

  const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#8b949e', font: { size: 11 } },
        border: { color: 'rgba(255,255,255,0.08)' }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#8b949e', font: { size: 11 }, callback: v => fmtNum(v) },
        border: { color: 'rgba(255,255,255,0.08)' }
      }
    }
  };

  // Range tabs
  document.querySelectorAll('.range-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      vscode.postMessage({ command: 'setRange', days: Number(btn.dataset.days) });
    });
  });

  // Receive data from extension
  window.addEventListener('message', ({ data }) => {
    if (data.command === 'data') render(data.payload);
  });

  // Ask for initial data
  vscode.postMessage({ command: 'ready' });

  function render(p) {
    const hasData = p.rangeRequests > 0 || (p.today && (p.today.inputTokens + p.today.cacheCreationTokens + p.today.cacheReadTokens + p.today.outputTokens) > 0);

    document.getElementById('mainContent').style.display = hasData ? '' : 'none';
    document.getElementById('emptyState').style.display = hasData ? 'none' : '';

    if (!hasData) return;

    // Status dot
    document.getElementById('statusDot').classList.toggle('inactive', !p.today);

    // Range label
    const rangeStr = p.rangeDays > 0 ? p.rangeDays + 'd' : 'All';
    document.querySelectorAll('#rangeLabel, #rangeLabel2').forEach(el => el.textContent = rangeStr);

    // Today stats
    if (p.today) {
      const todayTotal = p.today.inputTokens + (p.today.cacheCreationTokens||0) + (p.today.cacheReadTokens||0) + p.today.outputTokens;
      document.getElementById('todayTotal').textContent = fmtNum(todayTotal);
      document.getElementById('todaySplit').textContent =
        'input ' + fmtNum(p.today.inputTokens) +
        ' / cache-w ' + fmtNum(p.today.cacheCreationTokens||0) +
        ' / cache-r ' + fmtNum(p.today.cacheReadTokens||0) +
        ' / output ' + fmtNum(p.today.outputTokens);
      document.getElementById('todayCost').textContent = p.todayCostStr;
    }

    // Range stats
    const rangeTotal = p.rangeInput + p.rangeCacheCreate + p.rangeCacheRead + p.rangeOutput;
    document.getElementById('rangeTotal').textContent = fmtNum(rangeTotal);
    document.getElementById('rangeSplit').textContent =
      'input ' + fmtNum(p.rangeInput) +
      ' / cache-w ' + fmtNum(p.rangeCacheCreate) +
      ' / cache-r ' + fmtNum(p.rangeCacheRead) +
      ' / output ' + fmtNum(p.rangeOutput);
    document.getElementById('rangeCost').textContent = p.totalCostStr;
    document.getElementById('rangeRequests').textContent = fmtNum(p.rangeRequests) + ' requests';

    // Daily chart — 4 stacked segments
    const labels = p.daily.map(d => shortDate(d.date));
    buildDailyChart(
      labels,
      p.daily.map(d => d.inputTokens),
      p.daily.map(d => d.cacheCreationTokens || 0),
      p.daily.map(d => d.cacheReadTokens || 0),
      p.daily.map(d => d.outputTokens)
    );

    // Cumulative trend
    buildTrendChart(
      p.cumulative.map(d => shortDate(d.date)),
      p.cumulative.map(d => d.total)
    );

    // Model cost donut
    buildDonutChart(p.modelCosts);

    // Daily cost trend
    buildCostChart(
      p.dailyCosts.map(d => shortDate(d.date)),
      p.dailyCosts.map(d => d.cost)
    );

    // Cache efficiency card
    document.getElementById('cacheEfficiency').textContent = p.cacheEfficiency + '%';
    const cacheReadTok = p.rangeCacheRead || 0;
    document.getElementById('cacheHitSub').textContent =
      fmtNum(cacheReadTok) + ' tokens from cache · ~' + p.cacheEfficiency + '% of input cost';

    // ROI card
    const roiCard = document.getElementById('roiCard');
    const roiPctEl = document.getElementById('roiPct');
    const roiBarFill = document.getElementById('roiBarFill');
    const roiHit = p.roiPct >= 100;
    const roiClose = p.roiPct >= 70 && !roiHit;

    roiCard.className = 'roi-card' + (roiHit ? ' roi-hit' : roiClose ? ' roi-close' : '');
    roiPctEl.className = 'roi-pct' + (roiHit ? ' roi-pct-hit' : roiClose ? ' roi-pct-close' : '');
    roiPctEl.textContent = p.roiPct + '%';
    document.getElementById('roiSub').textContent =
      'API 等价已消费 ' + p.monthCostStr + ' / 订阅 $' + p.subscriptionCost.toFixed(2) + '/月';

    roiBarFill.className = 'roi-bar-fill' + (roiHit ? ' roi-bar-hit' : '');
    roiBarFill.style.width = Math.min(p.roiPct, 100) + '%';

    document.getElementById('roiMonthCost').textContent = p.monthCostStr;
    document.getElementById('roiProjected').textContent =
      p.projectedMonthCostStr + ' (' + p.projectedROI + '%)';

    const breakevenWrap = document.getElementById('roiBreakevenWrap');
    if (roiHit) {
      const saving = (p.monthCost - p.subscriptionCost).toFixed(4);
      breakevenWrap.innerHTML = '已回本 <span class="roi-badge">+$' + saving + ' ahead</span>';
    } else if (p.breakevenDay && p.breakevenDay <= p.daysInMonth) {
      breakevenWrap.innerHTML = '预计回本日: <strong>本月第 ' + p.breakevenDay + ' 天</strong>' +
        (p.breakevenDay > p.dayOfMonth ? '（还有 ' + (p.breakevenDay - p.dayOfMonth) + ' 天）' : ' <span class="roi-badge">今天!</span>');
    } else {
      breakevenWrap.innerHTML = '本月预计 <strong>无法回本</strong>（需加大使用量）';
    }

    // Category table
    buildCategoryTable(p.categoryCosts);

    // Model table
    buildModelTable(p.modelCosts);

    // Pricing reference table
    buildPricingTable();
  }

  function buildDailyChart(labels, input, cacheW, cacheR, output) {
    const ctx = document.getElementById('dailyChart').getContext('2d');
    const cfg = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Input',
            data: input,
            backgroundColor: 'rgba(59,130,246,0.7)',
            borderColor: 'rgba(59,130,246,1)',
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: 'Cache Write',
            data: cacheW,
            backgroundColor: 'rgba(168,85,247,0.7)',
            borderColor: 'rgba(168,85,247,1)',
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: 'Cache Read',
            data: cacheR,
            backgroundColor: 'rgba(16,185,129,0.7)',
            borderColor: 'rgba(16,185,129,1)',
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: 'Output',
            data: output,
            backgroundColor: 'rgba(245,158,11,0.7)',
            borderColor: 'rgba(245,158,11,1)',
            borderWidth: 1,
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { display: true, labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: { label: ctx => ctx.dataset.label + ': ' + fmtNum(ctx.raw) }
          }
        },
        scales: { ...CHART_DEFAULTS.scales, x: { ...CHART_DEFAULTS.scales.x, stacked: true }, y: { ...CHART_DEFAULTS.scales.y, stacked: true } },
      },
    };

    if (dailyChart) { dailyChart.destroy(); }
    dailyChart = new Chart(ctx, cfg);
  }

  function buildTrendChart(labels, totals) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(59,130,246,0.35)');
    gradient.addColorStop(1, 'rgba(59,130,246,0)');

    const cfg = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Cumulative Tokens',
          data: totals,
          borderColor: '#3B82F6',
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: labels.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: { callbacks: { label: ctx => 'Total: ' + fmtNum(ctx.raw) } }
        },
      },
    };

    if (trendChart) { trendChart.destroy(); }
    trendChart = new Chart(ctx, cfg);
  }

  function buildDonutChart(modelCosts) {
    const ctx = document.getElementById('donutChart').getContext('2d');
    const filtered = modelCosts.filter(m => m.cost > 0);
    const DONUT_COLORS = [
      '#3B82F6','#F59E0B','#10b981','#ef4444','#a855f7',
      '#06b6d4','#f97316','#84cc16','#ec4899','#6366f1',
    ];

    const cfg = {
      type: 'doughnut',
      data: {
        labels: filtered.map(m => m.model),
        datasets: [{
          data: filtered.map(m => m.cost),
          backgroundColor: DONUT_COLORS.slice(0, filtered.length),
          borderColor: 'transparent',
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: {
              color: '#8b949e',
              boxWidth: 10,
              font: { size: 11 },
              padding: 10,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + ctx.label + ': $' + ctx.raw.toFixed(4),
            },
          },
        },
      },
    };

    if (donutChart) { donutChart.destroy(); }
    if (filtered.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#8b949e';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No cost data yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }
    donutChart = new Chart(ctx, cfg);
  }

  function buildCostChart(labels, costs) {
    const ctx = document.getElementById('costChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(245,158,11,0.35)');
    gradient.addColorStop(1, 'rgba(245,158,11,0)');

    const cfg = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Daily Cost (USD)',
          data: costs,
          borderColor: '#F59E0B',
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: labels.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#F59E0B',
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: { callbacks: { label: ctx => 'Cost: $' + (ctx.raw).toFixed(4) } },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          y: {
            ...CHART_DEFAULTS.scales.y,
            ticks: {
              color: '#8b949e',
              font: { size: 11 },
              callback: v => '$' + (v).toFixed(v < 0.01 ? 4 : 2),
            },
          },
        },
      },
    };

    if (costChart) { costChart.destroy(); }
    costChart = new Chart(ctx, cfg);
  }

  const CAT_COLORS = { chat: '#3B82F6', subagent: '#a855f7', internal: '#8b949e', unknown: '#64748b' };

  function buildCategoryTable(categoryCosts) {
    const tbody = document.getElementById('categoryTableBody');
    if (!categoryCosts || !categoryCosts.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted)">No category data yet — send a few messages first</td></tr>';
      return;
    }
    tbody.innerHTML = categoryCosts.map(c => \`
      <tr>
        <td class="label-col"><span class="badge" style="background:rgba(\${hexToRgb(CAT_COLORS[c.category] || '#64748b')},0.15);color:\${CAT_COLORS[c.category] || '#64748b'}">\${c.label}</span></td>
        <td>\${fmtNum(c.requests)}</td>
        <td>\${fmtNum(c.inputTokens)}</td>
        <td>\${fmtNum(c.cacheCreationTokens)}</td>
        <td>\${fmtNum(c.cacheReadTokens)}</td>
        <td>\${fmtNum(c.outputTokens)}</td>
        <td>\${fmtNum(c.total)}</td>
        <td class="cost-hi">\${c.costStr}</td>
      </tr>
    \`).join('');
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return r + ',' + g + ',' + b;
  }

  function buildModelTable(modelCosts) {
    const tbody = document.getElementById('modelTableBody');
    if (!modelCosts.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted)">No model data</td></tr>'; return; }
    tbody.innerHTML = modelCosts.map(m => \`
      <tr>
        <td class="label-col"><span class="badge">\${m.model}</span></td>
        <td>\${fmtNum(m.requests)}</td>
        <td>\${fmtNum(m.inputTokens)}</td>
        <td>\${fmtNum(m.cacheCreationTokens)}</td>
        <td>\${fmtNum(m.cacheReadTokens)}</td>
        <td>\${fmtNum(m.outputTokens)}</td>
        <td>\${fmtNum(m.inputTokens + m.cacheCreationTokens + m.cacheReadTokens + m.outputTokens)}</td>
        <td class="cost-hi">\${m.costStr}</td>
      </tr>
    \`).join('');
  }

  const PRICING = ${JSON.stringify(Object.entries(MODEL_PRICING).filter(([k]) => k !== 'unknown').map(([model, p]) => ({ model, input: p.input, cacheWrite: p.cacheWrite, cacheRead: p.cacheRead, output: p.output })))};

  function buildPricingTable() {
    const tbody = document.getElementById('pricingTableBody');
    tbody.innerHTML = PRICING.map(p => \`
      <tr>
        <td class="label-col"><span class="badge">\${p.model}</span></td>
        <td>$\${p.input.toFixed(2)}</td>
        <td>$\${p.cacheWrite.toFixed(2)}</td>
        <td>$\${p.cacheRead.toFixed(2)}</td>
        <td>$\${p.output.toFixed(2)}</td>
      </tr>
    \`).join('');
  }

  function fmtNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  function shortDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
</script>
</body>
</html>`;
    }

    dispose(): void {
        DashboardPanel.currentPanel = undefined;
        this.panel.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}

/** Fill a sorted list of DayRecords with zero-entries for missing dates. */
function fillDateRange(records: DayRecord[], days: number): DayRecord[] {
    const result: DayRecord[] = [];
    const count = days > 0 ? days : 365;

    for (let i = count - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = toDateString(d);
        const existing = records.find(r => r.date === dateStr);
        result.push(
            existing ?? {
                date: dateStr,
                inputTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
                requestCount: 0,
                models: {},
            }
        );
    }

    return result;
}
