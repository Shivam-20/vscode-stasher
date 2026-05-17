/**
 * Tests for the logger — verifies that init, level filtering, and dispose
 * work correctly without a real VS Code output channel.
 */
import assert from 'assert';

// ─── Stub vscode so the logger module can be loaded outside VS Code ───────────

const lines: string[] = [];
const mockChannel = {
  appendLine: (line: string) => { lines.push(line); },
  show: () => {},
  dispose: () => {},
};

// Patch the require cache before importing logger
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (request: string, ...args: unknown[]) {
  if (request === 'vscode') {
    return {
      window: {
        createOutputChannel: () => mockChannel,
      },
    };
  }
  return _origLoad.call(this, request, ...args);
};

// Now import logger (will use mock vscode)
import { logger } from '../logger';

// Restore module loader
Module._load = _origLoad;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Logger', () => {
  beforeEach(() => {
    lines.length = 0;
    logger.init('debug');
  });

  it('logs info messages', () => {
    logger.info('hello world');
    assert.ok(lines.some((l) => l.includes('[INFO ]') && l.includes('hello world')));
  });

  it('logs debug messages when level = debug', () => {
    logger.debug('debug msg');
    assert.ok(lines.some((l) => l.includes('[DEBUG]') && l.includes('debug msg')));
  });

  it('suppresses debug messages when level = info', () => {
    lines.length = 0;
    logger.init('info');
    logger.debug('should not appear');
    assert.ok(!lines.some((l) => l.includes('should not appear')));
  });

  it('logs error messages', () => {
    logger.error('boom', { code: 42 });
    assert.ok(lines.some((l) => l.includes('[ERROR]') && l.includes('boom') && l.includes('42')));
  });

  it('logs warn messages', () => {
    logger.warn('watch out');
    assert.ok(lines.some((l) => l.includes('[WARN ]') && l.includes('watch out')));
  });

  it('serializes data as JSON', () => {
    logger.info('test', { key: 'val' });
    assert.ok(lines.some((l) => l.includes('"key"') && l.includes('"val"')));
  });

  it('includes ISO timestamp', () => {
    logger.info('ts check');
    assert.ok(lines.some((l) => /\d{4}-\d{2}-\d{2}T/.test(l)));
  });
});
