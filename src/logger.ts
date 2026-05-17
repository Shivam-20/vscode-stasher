import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Lightweight VS Code OutputChannel logger for Stasher.
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('Stash created', { index: 0 });
 *
 * The channel is created lazily on first use and disposed on deactivation
 * via logger.dispose().
 */
class Logger {
  private _channel: vscode.OutputChannel | undefined;
  private _level: LogLevel = 'info';

  private readonly _levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  /** Initialise (call once from activate()). */
  init(level: LogLevel = 'info'): void {
    this._level = level;
    if (!this._channel) {
      this._channel = vscode.window.createOutputChannel('Stasher', { log: true });
    }
  }

  private _channel_(): vscode.OutputChannel {
    if (!this._channel) {
      this._channel = vscode.window.createOutputChannel('Stasher', { log: true });
    }
    return this._channel;
  }

  private _shouldLog(level: LogLevel): boolean {
    return this._levelOrder[level] >= this._levelOrder[this._level];
  }

  private _write(level: LogLevel, message: string, data?: unknown): void {
    if (!this._shouldLog(level)) {
      return;
    }
    const ts = new Date().toISOString();
    const tag = level.toUpperCase().padEnd(5);
    const suffix = data !== undefined ? `  ${JSON.stringify(data)}` : '';
    this._channel_().appendLine(`[${ts}] [${tag}] ${message}${suffix}`);
  }

  debug(message: string, data?: unknown): void {
    this._write('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this._write('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this._write('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this._write('error', message, data);
  }

  /** Show the output panel in the UI. */
  show(): void {
    this._channel_().show(true);
  }

  dispose(): void {
    this._channel?.dispose();
    this._channel = undefined;
  }
}

export const logger = new Logger();
