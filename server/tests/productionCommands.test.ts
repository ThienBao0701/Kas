/**
 * The command surface, and the single source of truth for the version.
 *
 * TWO PROPERTIES.
 *
 * An unrecognised verb must never start the application. `Kas.cmd --diagnoze`
 * silently launching Kas is how "I ran the diagnostic and nothing happened"
 * becomes a support call — the operator believes they checked the system and
 * they did not.
 *
 * And the version must come from a file on disk, not from the environment. The
 * defect this replaces: `process.env.npm_package_version` is set by npm and NOT
 * by node, so every backup taken by the nightly scheduled task — which runs
 * node directly — recorded `appVersion: "0.0.0"`. A backup that misreports its
 * own version is worse than one that omits it, because an operator restoring
 * after an upgrade would compare it against the running build and conclude the
 * archive was ancient.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMANDS,
  helpText,
  parseCommand,
  unknownCommandMessage,
} from '../src/service/plan';
import {
  readGitCommit,
  resetVersionCache,
  versionInfo,
  versionLine,
  versionReport,
} from '../src/production/version';

/* ================================================================== */
/* Parsing                                                             */
/* ================================================================== */
describe('reading a command', () => {
  it('starts interactively with no arguments', () => {
    expect(parseCommand([])).toEqual({ kind: 'START', mode: 'INTERACTIVE' });
  });

  it('starts in service mode for --service', () => {
    expect(parseCommand(['--service'])).toEqual({ kind: 'START', mode: 'SERVICE' });
  });

  it.each([
    ['--stop', 'STOP'],
    ['--restart', 'RESTART'],
    ['--diagnose', 'DIAGNOSE'],
    ['--health', 'HEALTH'],
    ['--version', 'VERSION'],
    ['--logs', 'LOGS'],
    ['--help', 'HELP'],
  ])('recognises %s', (flag, kind) => {
    expect(parseCommand([flag]).kind).toBe(kind);
  });

  it('accepts -h as help, because people type it', () => {
    expect(parseCommand(['-h']).kind).toBe('HELP');
  });

  it('never starts the application for an unrecognised verb', () => {
    // THE PROPERTY. A typo must be reported, not obeyed as "just start".
    const result = parseCommand(['--diagnoze']);
    expect(result.kind).toBe('UNKNOWN');
    expect(result).toMatchObject({ argument: '--diagnoze' });
  });

  it('reports the exact argument it did not understand', () => {
    expect(unknownCommandMessage('--diagnoze')).toContain('--diagnoze');
  });

  it('diagnoses rather than starting when both are given', () => {
    // Someone typing `--service --diagnose` plainly wants the diagnosis; the
    // alternative silently starts a background server they did not ask for.
    expect(parseCommand(['--service', '--diagnose']).kind).toBe('DIAGNOSE');
  });

  it('ignores non-flag arguments rather than calling them unknown', () => {
    // Windows shortcuts and drag-and-drop both append stray arguments.
    expect(parseCommand(['C:\\some\\path']).kind).toBe('START');
  });
});

/* ================================================================== */
/* Help                                                                */
/* ================================================================== */
describe('help', () => {
  it('lists every verb the parser accepts', () => {
    const help = helpText().join('\n');
    for (const flag of ['--service', '--stop', '--restart', '--diagnose', '--health', '--version', '--logs']) {
      expect(help, flag).toContain(flag);
    }
  });

  it('documents each command with what it does', () => {
    for (const { flag, summary } of COMMANDS) {
      expect(summary.length, flag).toBeGreaterThan(10);
    }
  });

  it('names the other two entry points, which are separate programs', () => {
    const help = helpText().join('\n');
    expect(help).toContain('KasBackup.cmd');
    expect(help).toContain('KasService.cmd');
  });

  it('says which commands change nothing', () => {
    const diagnose = COMMANDS.find((c) => c.flag === '--diagnose');
    expect(diagnose?.summary).toContain('Không thay đổi dữ liệu');
  });
});

/* ================================================================== */
/* The version, from disk                                              */
/* ================================================================== */
describe('the version provider', () => {
  let root = '';

  beforeEach(() => {
    resetVersionCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kas-version-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    resetVersionCache();
  });

  it('reads the version from package.json, not from the environment', () => {
    // The whole point: npm sets npm_package_version and node does not, so the
    // nightly backup was stamping "0.0.0".
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    delete process.env.npm_package_version;
    expect(versionInfo(root).appVersion).toBe('9.9.9');
  });

  it('is not fooled by a stale npm_package_version', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    process.env.npm_package_version = '0.0.1';
    try {
      expect(versionInfo(root).appVersion).toBe('2.0.0');
    } finally {
      delete process.env.npm_package_version;
    }
  });

  it('falls back to the server package when the root one is missing', () => {
    fs.mkdirSync(path.join(root, 'server'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server', 'package.json'), JSON.stringify({ version: '3.1.4' }));
    expect(versionInfo(root).appVersion).toBe('3.1.4');
  });

  it('says "unknown" rather than inventing a version', () => {
    expect(versionInfo(root).appVersion).toBe('unknown');
  });

  it('reads the commit from a git checkout', () => {
    fs.mkdirSync(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'main'), 'a'.repeat(40));
    delete process.env.APP_RELEASE_REF;
    expect(readGitCommit(root)).toBe('a'.repeat(40));
  });

  it('reads a detached HEAD', () => {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), `${'b'.repeat(40)}\n`);
    expect(readGitCommit(root)).toBe('b'.repeat(40));
  });

  it('returns null for an installed copy with no .git', () => {
    // An install has no checkout. Inventing a commit would make a deployment
    // report look authoritative when it is not.
    expect(readGitCommit(root)).toBeNull();
  });

  it('follows a worktree, where .git is a FILE pointing elsewhere', () => {
    // Caught by manual validation: this repository is a linked worktree, and
    // the naive reader reported "no commit" on a machine that plainly had one.
    const real = path.join(root, 'realrepo', '.git');
    const worktreeDir = path.join(real, 'worktrees', 'wt');
    fs.mkdirSync(path.join(real, 'refs', 'heads'), { recursive: true });
    fs.mkdirSync(worktreeDir, { recursive: true });
    fs.writeFileSync(path.join(real, 'refs', 'heads', 'main'), 'c'.repeat(40));

    // The worktree keeps its own HEAD and points at the shared refs.
    fs.writeFileSync(path.join(worktreeDir, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(worktreeDir, 'commondir'), '../..\n');

    const checkout = path.join(root, 'checkout');
    fs.mkdirSync(checkout, { recursive: true });
    fs.writeFileSync(path.join(checkout, '.git'), `gitdir: ${worktreeDir.replace(/\\/g, '/')}\n`);

    expect(readGitCommit(checkout)).toBe('c'.repeat(40));
  });

  it('finds a ref that git has packed away', () => {
    // After `git gc` the loose ref file is gone and the hash lives in
    // packed-refs. Reporting "no commit" then would be wrong on any
    // long-lived checkout.
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(
      path.join(root, '.git', 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${'d'.repeat(40)} refs/heads/main\n`,
    );
    expect(readGitCommit(root)).toBe('d'.repeat(40));
  });

  it('refuses a HEAD that is not a commit hash', () => {
    // A truncated or corrupt HEAD must produce "unknown", not a fake commit.
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'not-a-hash\n');
    expect(readGitCommit(root)).toBeNull();
  });

  it('prefers APP_RELEASE_REF, which is how an install states its build', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    process.env.APP_RELEASE_REF = 'v1.2.3';
    try {
      expect(versionInfo(root).gitCommit).toBe('v1.2.3');
    } finally {
      delete process.env.APP_RELEASE_REF;
    }
  });
});

/* ================================================================== */
/* One version, displayed the same way everywhere                      */
/* ================================================================== */
describe('presenting the version', () => {
  const info = {
    appVersion: '0.1.0',
    gitCommit: 'abcdef1234567890',
    buildDate: '2026-08-05T10:00:00.000Z',
    environment: 'production',
    nodeVersion: '22.4.0',
  };

  it('gives one line for a log', () => {
    const line = versionLine(info);
    expect(line).toContain('0.1.0');
    expect(line).toContain('abcdef12');
    expect(line).toContain('production');
  });

  it('shortens the commit consistently', () => {
    expect(versionLine(info)).toContain('abcdef12');
    expect(versionLine(info)).not.toContain('abcdef1234567890');
  });

  it('says so plainly when there is no commit', () => {
    expect(versionLine({ ...info, gitCommit: null })).toContain('không rõ');
  });

  it('reports every field for --version', () => {
    const report = versionReport(info).join('\n');
    expect(report).toContain('0.1.0');
    expect(report).toContain('abcdef1234567890');
    expect(report).toContain('2026-08-05');
    expect(report).toContain('production');
    expect(report).toContain('22.4.0');
  });

  it('explains an absent build date rather than printing nothing', () => {
    expect(versionReport({ ...info, buildDate: null }).join('\n')).toContain('chưa build');
  });
});
