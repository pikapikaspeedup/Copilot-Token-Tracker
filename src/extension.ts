import * as vscode from 'vscode';
import { LogWatcher } from './logWatcher';
import { TokenStore } from './tokenStore';
import { StatusBarManager } from './statusBar';
import { DashboardPanel } from './dashboard/DashboardPanel';

export function activate(context: vscode.ExtensionContext): void {
    const store = new TokenStore(context.globalState);
    const statusBar = new StatusBarManager(store);
    const logWatcher = new LogWatcher(context, async (event) => {
        await store.addUsage(event);
        statusBar.markTraceActive();
        statusBar.refresh();
        DashboardPanel.currentPanel?.refresh();
    });

    logWatcher.start();

    // Auto-enable trace logging for Copilot Chat on activation
    autoEnableTrace();

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilotTokenTracker.openDashboard', () => {
            DashboardPanel.createOrShow(context.extensionUri, store);
        }),

        vscode.commands.registerCommand('copilotTokenTracker.resetData', async () => {
            const answer = await vscode.window.showWarningMessage(
                'Reset all Copilot token tracking data? This cannot be undone.',
                { modal: true },
                'Reset'
            );
            if (answer === 'Reset') {
                await store.resetAll();
                statusBar.refresh();
                DashboardPanel.currentPanel?.refresh();
                vscode.window.showInformationMessage('Copilot Token Tracker: data cleared.');
            }
        }),

        vscode.commands.registerCommand('copilotTokenTracker.enableTraceLogging', async () => {
            // Try to set log level programmatically via VS Code command
            try {
                await vscode.commands.executeCommand(
                    'workbench.action.setLogLevel',
                    'trace',
                    'GitHub Copilot Chat'
                );
                vscode.window.showInformationMessage(
                    'Copilot Token Tracker: Trace logging enabled for GitHub Copilot Chat.'
                );
            } catch {
                // Fallback: guide user manually
                vscode.window.showInformationMessage(
                    'Please run "Developer: Set Log Level...", select "GitHub Copilot Chat", then choose "Trace".',
                    'Open Command Palette'
                ).then(action => {
                    if (action === 'Open Command Palette') {
                        vscode.commands.executeCommand('workbench.action.showCommands');
                    }
                });
            }
        }),

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('copilotTokenTracker')) {
                statusBar.refresh();
            }
        }),

        statusBar,
        { dispose: () => logWatcher.dispose() }
    );
}

export function deactivate(): void {
    // Cleanup handled via subscriptions
}

async function autoEnableTrace(): Promise<void> {
    try {
        await vscode.commands.executeCommand(
            'workbench.action.setLogLevel',
            'trace',
            'GitHub Copilot Chat'
        );
    } catch {
        // Silently fail — user can enable manually
    }
}
