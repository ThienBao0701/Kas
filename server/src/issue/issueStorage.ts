import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ISSUE_UPLOAD_DIR } from '../config/env';
import { ApiError } from '../lib/errors';
import { sniffImageMime, type ProofMime } from '../booking/proofStorage';

// Reuse the exact same accepted image types, size limit and magic-byte sniffing
// as proof screenshots — an issue photo has the identical security posture.
export { sniffImageMime };
export { ALLOWED_PROOF_MIME as ALLOWED_ISSUE_MIME, MAX_PROOF_BYTES as MAX_ISSUE_BYTES } from '../booking/proofStorage';

const EXTENSION: Record<ProofMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function ensureIssueDir(): void {
  fs.mkdirSync(ISSUE_UPLOAD_DIR, { recursive: true });
}

/**
 * A server-generated file name for an issue photo, built only from the issue id,
 * a random token and the sniffed extension — the client's original name never
 * influences the path.
 */
export function generateIssuePhotoName(issueId: string, mime: ProofMime): string {
  const safeId = issueId.replace(/[^a-zA-Z0-9]/g, '');
  const token = randomBytes(8).toString('hex');
  return `${safeId}_${token}.${EXTENSION[mime]}`;
}

/** Resolves a stored name to a path *inside* ISSUE_UPLOAD_DIR (traversal-safe). */
export function resolveIssuePhotoPath(storedFileName: string): string {
  if (
    storedFileName.length === 0 ||
    storedFileName.includes('/') ||
    storedFileName.includes('\\') ||
    storedFileName.includes('\0') ||
    path.basename(storedFileName) !== storedFileName
  ) {
    throw ApiError.notFound('Không tìm thấy tệp.');
  }
  const root = path.resolve(ISSUE_UPLOAD_DIR);
  const resolved = path.resolve(root, storedFileName);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw ApiError.notFound('Không tìm thấy tệp.');
  }
  return resolved;
}

/** Writes the validated image buffer under a server-generated name. */
export async function saveIssuePhoto(buffer: Buffer, storedFileName: string): Promise<void> {
  ensureIssueDir();
  await fsp.writeFile(resolveIssuePhotoPath(storedFileName), buffer, { flag: 'wx' });
}

/** Reads a stored issue photo, or throws NOT_FOUND when the file is gone. */
export async function readIssuePhoto(storedFileName: string): Promise<Buffer> {
  try {
    return await fsp.readFile(resolveIssuePhotoPath(storedFileName));
  } catch {
    throw ApiError.notFound('Không tìm thấy tệp.');
  }
}
