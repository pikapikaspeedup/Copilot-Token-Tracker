import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseTokenUsage, extractModelFromLine, parseCcreqLine, TokenUsageEvent } from './tokenParser';

export class LogWatcher {
    private fileWatcher?: fs.FSWatcher;
    private filePosition = 0;
    private logFilePath?: string;
    private retryTimer?: NodeJS.Timeout;
    private disposed = false;
    /** Cache of the most recent model+speed seen in message_start or info lines */
    private lastSeenModel?: string;
    /** Pending token event waiting for a ccreq line to provide category */
    private pendingEvent?: TokenUsageEvent;
    private pendingFlushTimer?: NodeJS.Timeout;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly onTokenUsage: (event: TokenUsageEvent) => void
    ) {}

    async start(): Promise<void> {
        await this.tryAttach();
    }

    private async tryAttach(): Promise<void> {
        const logPath = this.findCopilotLogFile();
        if (!logPath) {
            // Retry every 10 s in case Copilot Chat hasn't been used yet
            if (!this.disposed) {
                this.retryTimer = setTimeout(() => this.tryAttach(), 10_000);
            }
            return;
        }

        this.logFilePath = logPath;

        // Start tailing from end of file so we don't replay old sessions
        try {
            const stat = fs.statSync(logPath);
            this.filePosition = stat.size;
        } catch {
            this.filePosition = 0;
        }

        this.fileWatcher = fs.watch(logPath, (event) => {
            if (event === 'change') {
                this.readNewContent();
            } else if (event === 'rename') {
                // File rotated; reconnect after a short delay
                this.fileWatcher?.close();
                this.fileWatcher = undefined;
                this.filePosition = 0;
                setTimeout(() => this.tryAttach(), 2_000);
            }
        });
    }

    /**
     * Locate the GitHub Copilot Chat log file for the current VS Code window.
     * The extension's logUri sits at: …/exthost/<our-ext-id>/
     * Copilot Chat's log lives at:   …/exthost/GitHub.copilot-chat/GitHub Copilot Chat.log
     */
    private findCopilotLogFile(): string | undefined {
        const myLogDir = this.context.logUri.fsPath;
        const extHostDir = path.dirname(myLogDir);
        const copilotLog = path.join(extHostDir, 'GitHub.copilot-chat', 'GitHub Copilot Chat.log');

        if (fs.existsSync(copilotLog)) {
            return copilotLog;
        }

        // Insiders uses a slightly different publisher casing in some builds
        const altCopilotLog = path.join(extHostDir, 'github.copilot-chat', 'GitHub Copilot Chat.log');
        if (fs.existsSync(altCopilotLog)) {
            return altCopilotLog;
        }

        return undefined;
    }

    private readNewContent(): void {
        if (!this.logFilePath) return;

        let fd: number;
        try {
            fd = fs.openSync(this.logFilePath, 'r');
        } catch {
            return;
        }

        try {
            const stat = fs.fstatSync(fd);

            if (stat.size < this.filePosition) {
                // File was truncated / rotated — reset position
                this.filePosition = 0;
            }

            const length = stat.size - this.filePosition;
            if (length === 0) return;

            const buf = Buffer.alloc(length);
            const bytesRead = fs.readSync(fd, buf, 0, length, this.filePosition);
            this.filePosition += bytesRead;

            const lines = buf.toString('utf8').split('\n');
            for (const line of lines) {
                // Try to extract model name from message_start, info lines, or debug lines
                const lineModel = extractModelFromLine(line);
                if (lineModel) {
                    this.lastSeenModel = lineModel;
                }

                // Check if this is a ccreq success line — provides category info
                const ccreq = parseCcreqLine(line);
                if (ccreq && this.pendingEvent) {
                    this.pendingEvent.category = ccreq.category;
                    this.pendingEvent.categoryDetail = ccreq.detail;
                    // ccreq model is more authoritative (includes redirect)
                    if (ccreq.model) {
                        this.pendingEvent.model = ccreq.model;
                    }
                    this.flushPending();
                    continue;
                }

                const event = parseTokenUsage(line);
                if (event) {
                    // Flush any previous pending event before storing new one
                    this.flushPending();

                    // If parser couldn't find a model in this line, use the cached one
                    if (!event.model && this.lastSeenModel) {
                        event.model = this.lastSeenModel;
                    }
                    // Hold the event — waiting for the next ccreq line
                    this.pendingEvent = event;
                    // Safety: flush after 500ms if no ccreq line arrives
                    if (this.pendingFlushTimer) clearTimeout(this.pendingFlushTimer);
                    this.pendingFlushTimer = setTimeout(() => this.flushPending(), 500);
                }
            }
        } finally {
            fs.closeSync(fd);
        }
    }

    /** Returns the resolved log file path, or undefined if not found yet. */
    getLogFilePath(): string | undefined {
        return this.logFilePath;
    }

    private flushPending(): void {
        if (this.pendingFlushTimer) {
            clearTimeout(this.pendingFlushTimer);
            this.pendingFlushTimer = undefined;
        }
        if (this.pendingEvent) {
            this.onTokenUsage(this.pendingEvent);
            this.pendingEvent = undefined;
        }
    }

    dispose(): void {
        this.disposed = true;
        this.flushPending();
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
        }
        this.fileWatcher?.close();
    }
}
