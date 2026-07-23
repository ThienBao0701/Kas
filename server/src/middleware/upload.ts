import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer, { MulterError } from 'multer';
import { ApiError } from '../lib/errors';
import { ALLOWED_PROOF_MIME, MAX_PROOF_BYTES, type ProofMime } from '../booking/proofStorage';

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
