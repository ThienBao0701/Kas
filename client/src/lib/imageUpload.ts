/**
 * Shared, backend-aligned image-upload helpers. These mirror the server's proof
 * limits (PNG/JPEG/WebP, 10 MB) and are pure UX validation — the backend remains
 * authoritative (magic-byte sniff, MIME + size). Reused by the proof upload and
 * available for hotel-issue photos / future OCR input.
 */

export const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME)[number];

/** The `accept` attribute value for a native file input. */
export const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_MIME.join(',');

/** Maximum image size in bytes (10 MB) — matches the backend limit. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function isAcceptedImage(type: string | undefined | null): type is AcceptedImageMime {
  return !!type && (ACCEPTED_IMAGE_MIME as readonly string[]).includes(type);
}

export interface ImageValidation {
  ok: boolean;
  error?: string;
}

/** Validates a picked/pasted/dropped image for the client (UX only). */
export function validateImageFile(file: File, maxBytes: number = MAX_IMAGE_BYTES): ImageValidation {
  if (!isAcceptedImage(file.type)) return { ok: false, error: 'Định dạng ảnh không được hỗ trợ.' };
  if (file.size > maxBytes) return { ok: false, error: 'Ảnh vượt quá dung lượng tối đa 10 MB.' };
  return { ok: true };
}

const EXT: Record<AcceptedImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** A safe, server-independent filename for a pasted image (extension from MIME). */
export function pastedFileName(type: AcceptedImageMime, now: number = Date.now()): string {
  return `pasted-proof-${now}.${EXT[type]}`;
}

/** Short display label for an accepted image MIME (e.g. "PNG"). */
export function imageTypeLabel(type: string): string {
  if (type === 'image/png') return 'PNG';
  if (type === 'image/jpeg') return 'JPEG';
  if (type === 'image/webp') return 'WebP';
  return type;
}
