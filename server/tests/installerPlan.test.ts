/**
 * What the Windows installer decides.
 *
 * THE PROPERTY THIS FILE PROTECTS: an upgrade never destroys operator data.
 * Configuration holds the database password, and server/uploads holds the proof
 * images that are the only evidence a branch created a reservation correctly.
 * An installer that replaced either would be discovered days later, by which
 * time the originals are gone.
 *
 * The second property is that an uninstall keeps that data unless the operator
 * explicitly asks otherwise, and that the database is never in scope at all.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_NODE_MAJOR,
  OPERATOR_DATA,
  RELEASE_PAYLOAD,
  decideInstall,
  describeInstall,
  installProblemMessage,
  isProtectedPath,
  shortcutSpecs,
  uninstallTargets,
  type InstallEnvironment,
} from '../src/installer/plan';

/** A machine where everything is ready and nothing is installed yet. */
/** Narrows away ABORT so 'preserve' can be read without an unchecked cast. */
function proceeding(action: ReturnType<typeof decideInstall>) {
  if (action.kind === 'ABORT') throw new Error('mong doi cai dat tiep tuc, nhung bi ABORT');
  return action;
}

const ready = (over: Partial<InstallEnvironment> = {}): InstallEnvironment => ({
  nodeMajor: MIN_NODE_MAJOR,
  targetDir: 'C:\\Users\\op\\AppData\\Local\\Kas',
  targetWritable: true,
  existingInstall: false,
  existingVersion: null,
  incomingVersion: '1.2.0',
  payloadComplete: true,
  targetOccupiedByOther: false,
  ...over,
});

/* ================================================================== */
/* Install kind                                                        */
/* ================================================================== */
describe('classifying the install', () => {
  it('is a fresh install when nothing is there', () => {
    expect(decideInstall(ready())).toEqual({ kind: 'FRESH', preserve: [] });
  });

  it('is an upgrade when a different version is present', () => {
    const action = decideInstall(ready({ existingInstall: true, existingVersion: '1.1.0' }));
    expect(action.kind).toBe('UPGRADE');
  });

  it('is a repair when the same version is present', () => {
    // The operator is fixing damage, not moving forward. Both replace the
    // payload; naming it correctly is what makes the log honest.
    const action = decideInstall(ready({ existingInstall: true, existingVersion: '1.2.0' }));
    expect(action.kind).toBe('REPAIR');
  });

  it('preserves nothing on a fresh install, because there is nothing to keep', () => {
    expect(proceeding(decideInstall(ready())).preserve).toEqual([]);
  });
});

/* ================================================================== */
/* The data that must survive                                          */
/* ================================================================== */
describe('operator data', () => {
  it('is preserved by an upgrade', () => {
    const action = proceeding(decideInstall(ready({ existingInstall: true, existingVersion: '1.1.0' })));
    expect(action.preserve).toEqual(OPERATOR_DATA);
  });

  it('is preserved by a repair too', () => {
    const action = proceeding(decideInstall(ready({ existingInstall: true, existingVersion: '1.2.0' })));
    expect(action.preserve).toEqual(OPERATOR_DATA);
  });

  it('covers configuration, uploads and logs', () => {
    expect(OPERATOR_DATA).toContain('.env');
    expect(OPERATOR_DATA).toContain('server/uploads');
    expect(OPERATOR_DATA).toContain('logs');
  });

  it('never overlaps with the files the installer replaces', () => {
    // An item in both lists would be preserved and overwritten at once, and
    // which happened would depend on ordering.
    for (const item of RELEASE_PAYLOAD) {
      expect(OPERATOR_DATA, item).not.toContain(item);
    }
  });

  it('protects everything beneath an operator path, not just the path itself', () => {
    expect(isProtectedPath('server/uploads')).toBe(true);
    expect(isProtectedPath('server/uploads/booking-proofs/proof-1.png')).toBe(true);
    expect(isProtectedPath('server/uploads/issue-photos/x.jpg')).toBe(true);
    expect(isProtectedPath('.env')).toBe(true);
  });

  it('tolerates Windows separators and leading ./', () => {
    expect(isProtectedPath('server\\uploads\\booking-proofs\\a.png')).toBe(true);
    expect(isProtectedPath('./.env')).toBe(true);
  });

  it('does not protect the application files', () => {
    expect(isProtectedPath('server/dist/index.js')).toBe(false);
    expect(isProtectedPath('node_modules/express/index.js')).toBe(false);
    expect(isProtectedPath('client/dist/index.html')).toBe(false);
  });

  it('does not protect a path that merely starts with the same letters', () => {
    // "server/uploads-old" is not inside "server/uploads".
    expect(isProtectedPath('server/uploads-old/x.png')).toBe(false);
    expect(isProtectedPath('.environment')).toBe(false);
  });
});

/* ================================================================== */
/* Uninstall                                                           */
/* ================================================================== */
describe('uninstall', () => {
  it('keeps operator data by default', () => {
    const targets = uninstallTargets(false);
    for (const kept of OPERATOR_DATA) expect(targets).not.toContain(kept);
    expect(targets).toEqual(RELEASE_PAYLOAD);
  });

  it('removes operator data only when explicitly asked', () => {
    const targets = uninstallTargets(true);
    for (const item of [...RELEASE_PAYLOAD, ...OPERATOR_DATA]) expect(targets).toContain(item);
  });

  it('never lists anything resembling the database', () => {
    // The database lives in PostgreSQL, outside the install directory. It must
    // not be reachable from an uninstall under any flag.
    for (const purge of [false, true]) {
      const joined = uninstallTargets(purge).join(' ').toLowerCase();
      expect(joined).not.toContain('postgres');
      expect(joined).not.toContain('.sql');
      expect(joined).not.toContain('backup');
    }
  });
});

/* ================================================================== */
/* Prerequisites, checked before anything is classified                */
/* ================================================================== */
describe('prerequisites', () => {
  it('refuses when Node is absent', () => {
    expect(decideInstall(ready({ nodeMajor: null }))).toEqual({
      kind: 'ABORT',
      problem: 'NODE_MISSING',
    });
  });

  it('refuses an unsupported Node', () => {
    expect(decideInstall(ready({ nodeMajor: MIN_NODE_MAJOR - 1 }))).toEqual({
      kind: 'ABORT',
      problem: 'NODE_TOO_OLD',
    });
  });

  it('refuses an incomplete download', () => {
    expect(decideInstall(ready({ payloadComplete: false })).kind).toBe('ABORT');
  });

  it('refuses a directory it cannot write to', () => {
    expect(decideInstall(ready({ targetWritable: false }))).toEqual({
      kind: 'ABORT',
      problem: 'TARGET_NOT_WRITABLE',
    });
  });

  it('refuses a folder that belongs to something else', () => {
    // This is what stops an install into Documents from later being
    // uninstalled and taking the contents with it.
    expect(decideInstall(ready({ targetOccupiedByOther: true }))).toEqual({
      kind: 'ABORT',
      problem: 'TARGET_OCCUPIED_BY_OTHER',
    });
  });

  it('checks prerequisites before classifying an upgrade', () => {
    // Telling the operator "upgrading from 1.1.0" and only then discovering
    // Node is missing promises something the installer cannot deliver.
    const action = decideInstall(
      ready({ nodeMajor: null, existingInstall: true, existingVersion: '1.1.0' }),
    );
    expect(action).toEqual({ kind: 'ABORT', problem: 'NODE_MISSING' });
  });

  it('allows an existing Kas folder — that is an upgrade, not an obstruction', () => {
    const action = decideInstall(
      ready({ existingInstall: true, existingVersion: '1.1.0', targetOccupiedByOther: false }),
    );
    expect(action.kind).toBe('UPGRADE');
  });
});

/* ================================================================== */
/* Shortcuts                                                           */
/* ================================================================== */
describe('shortcuts', () => {
  it('creates one on the Desktop and one in the Start Menu', () => {
    const specs = shortcutSpecs();
    expect(specs.map((s) => s.location).sort()).toEqual(['Desktop', 'StartMenu']);
  });

  it('points at the launcher, never at node or a URL', () => {
    // A URL shortcut would open a browser at a server that is not running;
    // the launcher starts it first and opens localhost, which is what keeps
    // the app installable as a PWA.
    for (const spec of shortcutSpecs()) {
      expect(spec.target).toBe('Kas.cmd');
      expect(spec.target).not.toContain('http');
      expect(spec.target).not.toContain('node');
    }
  });

  it('uses the application icon that ships with the client build', () => {
    for (const spec of shortcutSpecs()) {
      expect(spec.iconRelativePath).toBe('client/dist/favicon.ico');
    }
  });
});

/* ================================================================== */
/* What the operator is told                                           */
/* ================================================================== */
describe('the messages', () => {
  it('names where to get Node when it is missing', () => {
    expect(installProblemMessage('NODE_MISSING', ready({ nodeMajor: null }))).toContain('nodejs.org');
  });

  it('names the directory it could not write to', () => {
    const env = ready({ targetWritable: false });
    const message = installProblemMessage('TARGET_NOT_WRITABLE', env);
    expect(message).toContain(env.targetDir);
    expect(message).toContain('Administrator');
  });

  it('states that the database is untouched, every time', () => {
    // The assurance an operator most needs before running an upgrade.
    for (const existing of [null, '1.1.0']) {
      const env = ready({ existingInstall: existing !== null, existingVersion: existing });
      const lines = describeInstall(decideInstall(env), env).join('\n');
      expect(lines).toContain('Cơ sở dữ liệu');
      expect(lines).toContain('không bị thay đổi');
    }
  });

  it('says what will be preserved on an upgrade', () => {
    const env = ready({ existingInstall: true, existingVersion: '1.1.0' });
    const lines = describeInstall(decideInstall(env), env).join('\n');
    expect(lines).toContain('nâng cấp');
    expect(lines).toContain('1.1.0');
    expect(lines).toContain('.env');
  });

  it('reports only the failure when it cannot proceed', () => {
    const env = ready({ nodeMajor: null });
    const lines = describeInstall(decideInstall(env), env);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('KHÔNG THỂ CÀI ĐẶT');
  });

  it('never prints anything resembling a connection string', () => {
    const problems = [
      'NODE_MISSING',
      'NODE_TOO_OLD',
      'TARGET_NOT_WRITABLE',
      'PAYLOAD_INCOMPLETE',
      'TARGET_OCCUPIED_BY_OTHER',
    ] as const;
    for (const problem of problems) {
      const message = installProblemMessage(problem, ready());
      expect(message, problem).not.toContain('postgresql://');
      expect(message, problem).not.toMatch(/:\/\/[^\s]*:[^\s]*@/);
    }
  });
});
