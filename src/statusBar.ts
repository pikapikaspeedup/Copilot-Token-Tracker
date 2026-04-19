import * as vscode from 'vscode';
import { TokenStore } from './tokenStore';
import { estimateCost, formatCost } from './pricing';

export class StatusBarManager {
    private item: vscode.StatusBarItem;
    private hasTracedData = false;

    constructor(private readonly store: TokenStore) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.item.command = 'copilotTokenTracker.openDashboard';
        this.item.tooltip = 'Copilot Token Tracker — Click to open dashboard';
        this.item.show();
        this.refresh();
    }

    refresh(): void {
        const enabled = vscode.workspace
            .getConfiguration('copilotTokenTracker')
            .get<boolean>('enabled', true);

        if (!enabled) {
            this.item.hide();
            return;
        }

        const today = this.store.getToday();

        if (!today) {
            this.item.text = '$(symbol-event) $0.00';
            this.item.color = undefined;
        } else {
            const n = (v: number | null | undefined) => v ?? 0;
            // Calculate today's cost
            const todayCost = Object.entries(today.models).reduce((s, [model, data]) => {
                return s + estimateCost(n(data.inputTokens), n(data.cacheCreationTokens), n(data.cacheReadTokens), n(data.outputTokens), model);
            }, 0);

            // ROI calculation
            const subCost: number = vscode.workspace
                .getConfiguration('copilotTokenTracker')
                .get<number>('monthlySubscriptionCost', 39);

            const now = new Date();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const dailySub = subCost / daysInMonth;
            const roiToday = dailySub > 0 ? Math.round((todayCost / dailySub) * 100) : 0;

            // Format: $0.0341 | ROI 86%
            const costStr = todayCost < 0.01 ? `$${todayCost.toFixed(4)}` : `$${todayCost.toFixed(2)}`;
            this.item.text = `$(symbol-event) ${costStr} | ROI ${roiToday}%`;

            // Color: green if ahead of daily average, warning if far behind
            if (roiToday >= 100) {
                this.item.color = new vscode.ThemeColor('charts.green');
            } else if (!this.hasTracedData) {
                this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
            } else {
                this.item.color = undefined;
            }

            this.item.tooltip = [
                `Copilot Token Tracker`,
                `Today: ${costStr} (${formatCost(todayCost)})`,
                `Daily sub cost: $${dailySub.toFixed(4)}`,
                `Today ROI: ${roiToday}%`,
                `Click to open dashboard`,
            ].join('\n');
        }

        this.item.show();
    }

    /** Called when the first real trace-level token event is received. */
    markTraceActive(): void {
        this.hasTracedData = true;
        this.refresh();
    }

    dispose(): void {
        this.item.dispose();
    }
}
