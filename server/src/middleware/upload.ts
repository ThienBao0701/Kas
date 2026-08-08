import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer, { MulterError } from 'multer';
import { ApiError } from '../lib/errors';
import { ALLOWED_PROOF_MIME, MAX_PROOF_BYTES, type ProofMime } from '../booking/proofStorage';
import {
  CHARGE_DOCUMENT_MIME,
  MAX_CHARGE_FILES_PER_REQUEST,
  MAX_CHARGE_FILE_BYTES,
} from '../charge/chargeDocStorage';

// Buffer the upload in memory (max 10 MB) so we can sniff its magic bytes and
// write it ourselves under a server-generated name. The client's declared MIME
// is only a first-pass filter; proofStorage re-verifies the real image type.
const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_PROOF_MIME as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError('UNSUPPORTED_MEDIA', 'Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.'));
    }
  },
});

/**
 * A single-image ("image") multipart handler that translates multer's own errors
 * into the app's ApiError shape (oversized -> 413, wrong type -> 415).
 */
export function proofUpload(): RequestHandler {
  const single = uploader.single('image');
  return (req: Request, res: Response, next: NextFunction) => {
    single(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(ApiError.fileTooLarge());
          return;
        }
        next(ApiError.badRequest('Tải ảnh không hợp lệ.'));
        return;
      }
      next(err); // already an ApiError (e.g. unsupported media) or unexpected
    });
  };
}

export type { ProofMime };

/**
 * Multi-file handler for Chứng từ attachments.
 *
 * Separate from `proofUpload` on purpose: it accepts several files and it
 * accepts PDF, neither of which the proof path should quietly gain. The
 * declared MIME here is only a first-pass filter — `chargeDocStorage` sniffs
 * every buffer's magic bytes before anything is written, and that is the check
 * that actually decides.
 */
const chargeUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHARGE_FILE_BYTES, files: MAX_CHARGE_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if ((CHARGE_DOCUMENT_MIME as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError('UNSUPPORTED_MEDIA', 'Chỉ chấp nhận ảnh PNG, JPEG, WebP hoặc tệp PDF.'));
    }
  },
});

export function chargeUpload(): RequestHandler {
  const many = chargeUploader.array('files', MAX_CHARGE_FILES_PER_REQUEST);
  return (req: Request, res: Response, next: NextFunction) => {
    many(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(ApiError.fileTooLarge());
          return;
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          next(ApiError.badRequest(`Tối đa ${MAX_CHARGE_FILES_PER_REQUEST} tệp mỗi lần tải lên.`));
          return;
        }
        next(ApiError.badRequest('Tải tệp không hợp lệ.'));
        return;
      }
      next(err);
    });
  };
}
