/**
 * What the Windows installer should do, decided as pure data.
 *
 * Same split as the launcher: the decisions live here as functions over plain
 * values, and the PowerShell in scripts/production/windows carries them out.
 * Copying files and writing registry keys cannot be unit tested without
 * becoming a mock exercise — but "is this an upgrade or a fresh install",
 * "which files must survive it", and "what may an uninstall delete" are exactly
 * the questions that destroy someone's data when answered wrongly.
 *
 * THE RULE THIS MODULE ENFORCES: an upgrade never touches operator data.
 * Configuration, uploaded proof images and issue photos belong to the hotel,
 * not to the release. The database is never touched at all — it lives in
 * PostgreSQL, outside the install directory, and nothing here can reach it.
 */

/** Node versions the repository declares support for. */
export const MIN_NODE_MAJOR = 22;

/** Paths, relative to the install root, that belong to the OPERATOR. */
export const OPERATOR_DATA: readonly string[] = [
  // Configuration, including the database URL. Replacing it on upgrade would
  // point a working install at nothing.
  '.env',
  // Guest documents. These are evidence of what a branch actually did.
  'server/uploads',
  // Launcher and installer history.
  'logs',
];

/** Paths the installer OWNS and replaces wholesale on every upgrade. */
export const RELEASE_PAYLOAD: readonly string[] = [
  'server/dist',
  'client/dist',
  'prisma',
  'node_modules',
  'package.json',
  'Kas.cmd',
];

export type InstallKind =
  /** Nothing installed at the target yet. */
  | 'FRESH'
  /** A different version is present; replace the payload, keep the data. */
  | 'UPGRADE'
  /** The same version is present; replace the payload to fix damage. */
  | 'REPAIR';

export type InstallProblem =
  | 'NODE_MISSING'
  | 'NODE_TOO_OLD'
  | 'TARGET_NOT_WRITABLE'
  | 'PAYLOAD_INCOMPLETE'
  | 'TARGET_OCCUPIED_BY_OTHER';

/** Everything the decision depends on, gathered by the installer script. */
export interface InstallEnvironment {
  /** Major version of the Node found on PATH, or null when there is none. */
  nodeMajor: number | null;
  /** The chosen install directory. */
  targetDir: string;
  /** The directory exists and can be written to. */
  targetWritable: boolean;
  /** A Kas install is already present at the target. */
  existingInstall: boolean;
  /** Version recorded by a previous install, when there is one. */
  existingVersion: string | null;
  /** Version being installed. */
  incomingVersion: string;
  /** The staged release contains every file in RELEASE_PAYLOAD. */
  payloadComplete: boolean;
  /**
   * The target directory has files in it but no Kas install — someone chose a
   * folder that already belongs to something else.
   */
  targetOccupiedByOther: boolean;
}

export type InstallAction =
  | { kind: InstallKind; preserve: readonly string[] }
  | { kind: 'ABORT'; problem: InstallProblem };

/**
 * Decides what kind of install this is, and what must survive it.
 *
 * Prerequisites are checked before anything is classified: an installer that
 * decides "this is an upgrade" and only then discovers Node is missing has
 * already told the operator something it cannot deliver.
 */
export function decideInstall(env: InstallEnvironment): InstallAction {
  if (env.nodeMajor === null) return { kind: 'ABORT', problem: 'NODE_MISSING' };
  if (env.nodeMajor < MIN_NODE_MAJOR) return { kind: 'ABORT', problem: 'NODE_TOO_OLD' };
  if (!env.payloadComplete) return { kind: 'ABORT', problem: 'PAYLOAD_INCOMPLETE' };
  if (!env.targetWritable) return { kind: 'ABORT', problem: 'TARGET_NOT_WRITABLE' };
  // Refusing here is what stops an install into "C:\" or a documents folder
  // from later being uninstalled and taking the contents with it.
  if (env.targetOccupiedByOther) return { kind: 'ABORT', problem: 'TARGET_OCCUPIED_BY_OTHER' };

  if (!env.existingInstall) return { kind: 'FRESH', preserve: [] };

  // Same version present means the operator is fixing a broken install rather
  // than moving to a new one. Both replace the payload; the distinction is
  // reported so the log says what actually happened.
  const kind: InstallKind = env.existingVersion === env.incomingVersion ? 'REPAIR' : 'UPGRADE';
  return { kind, preserve: OPERATOR_DATA };
}

/**
 * Whether a path may be removed while replacing the payload.
 *
 * Everything under an operator-data path is protected, not just the exact
 * path — `server/uploads/booking-proofs/x.png` is as untouchable as
 * `server/uploads` itself.
 */
export function isProtectedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return OPERATOR_DATA.some(
    (protectedPath) => normalized === protectedPath || normalized.startsWith(`${protectedPath}/`),
  );
}

/** What an uninstall removes, given whether the operator asked to purge data. */
export function uninstallTargets(purgeData: boolean): readonly string[] {
  // Default keeps everything the hotel produced. An uninstall that silently
  // deleted proof images would destroy the only record that a branch created a
  // reservation correctly.
  return purgeData ? [...RELEASE_PAYLOAD, ...OPERATOR_DATA] : RELEASE_PAYLOAD;
}

/** One shortcut the installer creates. */
export interface ShortcutSpec {
  /** File name without the .lnk extension. */
  name: string;
  /** Where it goes. */
  location: 'Desktop' | 'StartMenu';
  /** Relative to the install root. */
  target: string;
  iconRelativePath: string;
}

/**
 * The shortcuts to create.
 *
 * Both point at Kas.cmd — the launcher built in Phase 6.2 — rather than at node
 * or a URL. A URL shortcut would open a browser at a server that is not
 * running; the launcher starts it first, and opens localhost so the app stays
 * installable.
 */
export function shortcutSpecs(): ShortcutSpec[] {
  const shared = {
    target: 'Kas.cmd',
    iconRelativePath: 'client/dist/favicon.ico',
  };
  return [
    { name: 'Kas', location: 'Desktop', ...shared },
    { name: 'Kas', location: 'StartMenu', ...shared },
  ];
}

/** What to print when a prerequisite fails. Every message names the remedy. */
export function installProblemMessage(problem: InstallProblem, env: InstallEnvironment): string {
  switch (problem) {
    case 'NODE_MISSING':
      return (
        'Không tìm thấy Node.js. Kas cần Node.js để chạy. ' +
        'Hãy cài bản LTS tại https://nodejs.org rồi chạy lại trình cài đặt.'
      );
    case 'NODE_TOO_OLD':
      return (
        `Node.js quá cũ: phiên bản ${env.nodeMajor}, cần tối thiểu ${MIN_NODE_MAJOR}. ` +
        'Hãy cập nhật Node.js tại https://nodejs.org rồi chạy lại.'
      );
    case 'PAYLOAD_INCOMPLETE':
      return (
        'Gói cài đặt thiếu tệp. Hãy tải lại bản phát hành đầy đủ ' +
        '(giải nén toàn bộ thư mục trước khi chạy trình cài đặt).'
      );
    case 'TARGET_NOT_WRITABLE':
      return (
        `Không ghi được vào "${env.targetDir}". ` +
        'Hãy chọn thư mục khác, hoặc chạy trình cài đặt với quyền Administrator.'
      );
    case 'TARGET_OCCUPIED_BY_OTHER':
      return (
        `Thư mục "${env.targetDir}" đã có dữ liệu không phải của Kas. ` +
        'Hãy chọn một thư mục trống hoặc thư mục Kas đã cài trước đó.'
      );
  }
}

/** A human summary of what is about to happen, for the log and the console. */
export function describeInstall(action: InstallAction, env: InstallEnvironment): string[] {
  if (action.kind === 'ABORT') return [`KHÔNG THỂ CÀI ĐẶT: ${installProblemMessage(action.problem, env)}`];

  const lines = [`Thư mục cài đặt : ${env.targetDir}`, `Phiên bản       : ${env.incomingVersion}`];

  if (action.kind === 'FRESH') {
    lines.push('Kiểu cài đặt    : cài mới');
  } else {
    lines.push(
      `Kiểu cài đặt    : ${action.kind === 'UPGRADE' ? 'nâng cấp' : 'sửa chữa'}` +
        (env.existingVersion ? ` (từ ${env.existingVersion})` : ''),
    );
    lines.push(`Giữ nguyên      : ${action.preserve.join(', ')}`);
  }
  // Stated every time, because it is the assurance an operator most needs.
  lines.push('Cơ sở dữ liệu   : không bị thay đổi (PostgreSQL nằm ngoài thư mục cài đặt)');
  return lines;
}
