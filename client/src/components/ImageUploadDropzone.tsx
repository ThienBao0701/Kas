import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ImageUp, RefreshCw, UploadCloud, X, ZoomIn } from 'lucide-react';
import { Button } from './Button';
import { ImageViewer } from './ImageViewer';
import { formatFileSize } from '../lib/format';
import {
  ACCEPTED_IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  imageTypeLabel,
  isAcceptedImage,
  pastedFileName,
  validateImageFile,
} from '../lib/imageUpload';

export interface ImageUploadDropzoneProps {
  /** The currently selected image (controlled), or null when empty. */
  value: File | null;
  /** Called with a validated file, or null when the image is removed. */
  onChange: (file: File | null) => void;
  /** Disables all interaction (e.g. while the parent is uploading). */
  disabled?: boolean;
  /** Max size in bytes (defaults to the shared 10 MB limit). */
  maxBytes?: number;
  className?: string;
}

/**
 * A reusable image upload surface supporting **clipboard paste (Ctrl+V), drag &
 * drop, and click-to-browse**, with an immediate preview, replace/remove, and
 * client-side validation (UX only — the backend stays authoritative). Object URLs
 * are always revoked on change/unmount. Fully keyboard-accessible.
 *
 * It is deliberately self-contained (validation, preview, paste/drag all live
 * here) so booking proof, hotel-issue photos and future OCR input can reuse it
 * without duplicating upload logic.
 */
export function ImageUploadDropzone({ value, onChange, disabled = false, maxBytes = MAX_IMAGE_BYTES, className = '' }: ImageUploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const errorId = useId();

  // Own the preview object URL for the current value; always revoke it.
  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      setDims(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    setDims(null);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  /** Validates and commits a file. Returns true when accepted (callers own the notice). */
  const accept = useCallback(
    (file: File | undefined): boolean => {
      if (!file) return false;
      const result = validateImageFile(file, maxBytes);
      if (!result.ok) {
        setError(result.error ?? 'Ảnh không hợp lệ.');
        return false;
      }
      setError(null);
      onChange(file);
      return true;
    },
    [maxBytes, onChange],
  );

  // Clipboard paste. A single document-level listener (no duplicate handling from
  // nested elements) that acts only on an image item — plain-text pastes are left
  // untouched, so we never intercept paste outside this upload context.
  useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      let picked: DataTransferItem | null = null;
      let sawUnsupportedImage = false;
      for (const item of items) {
        if (item.kind !== 'file') continue;
        if (isAcceptedImage(item.type)) {
          picked = item;
          break;
        }
        if (item.type.startsWith('image/')) sawUnsupportedImage = true;
      }
      if (picked) {
        e.preventDefault();
        const blob = picked.getAsFile();
        if (!blob) return;
        const named = new File([blob], pastedFileName(picked.type as never), { type: picked.type });
        setNotice(accept(named) ? 'Đã dán ảnh từ clipboard.' : null);
      } else if (sawUnsupportedImage) {
        e.preventDefault();
        setError('Clipboard không có ảnh PNG, JPEG hoặc WebP hợp lệ.');
        setNotice(null);
      }
      // else: plain text / no image → ignore.
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [disabled, accept]);

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setNotice(null);
    accept(files[0]);
    if (files.length > 1) setNotice('Chỉ được gửi một ảnh cho mỗi lần xác nhận.');
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // required so the drop fires and the browser does not navigate
    if (!disabled) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };

  return (
    <div
      className={className}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Hidden native input — the accessible browse fallback (mobile/gallery/camera). */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          setNotice(null);
          accept(e.target.files?.[0] ?? undefined);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />

      {value && previewUrl ? (
        <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-slate-200 p-3">
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label="Phóng to ảnh xem trước"
            className="group relative block shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <img
              src={previewUrl}
              alt="Xem trước ảnh sẽ gửi"
              className="max-h-40 w-40 object-contain"
              onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
              <ZoomIn className="h-6 w-6" aria-hidden="true" />
            </span>
          </button>
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium text-slate-800" title={value.name}>{value.name}</p>
            <p className="mt-0.5 text-slate-500">
              {imageTypeLabel(value.type)} · {formatFileSize(value.size)}
              {dims && dims.w > 0 ? ` · ${dims.w} × ${dims.h}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={openPicker} disabled={disabled}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Thay ảnh
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  onChange(null);
                }}
                disabled={disabled}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Xóa ảnh
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="Vùng tải ảnh: dán bằng Ctrl+V, kéo thả hoặc nhấn để chọn ảnh"
          aria-disabled={disabled || undefined}
          aria-describedby={error ? errorId : undefined}
          onClick={openPicker}
          onKeyDown={onKeyDown}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
            disabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
              : dragActive
                ? 'cursor-copy border-brand-500 bg-brand-50'
                : 'cursor-pointer border-slate-300 bg-slate-50/60 hover:border-brand-400 hover:bg-brand-50/40'
          }`}
        >
          {dragActive ? (
            <UploadCloud className="h-7 w-7 text-brand-600" aria-hidden="true" />
          ) : (
            <ImageUp className="h-7 w-7 text-slate-400" aria-hidden="true" />
          )}
          <p className="text-sm font-medium text-slate-700">
            {dragActive ? 'Thả ảnh vào đây' : 'Dán ảnh bằng Ctrl+V, kéo thả hoặc nhấn để chọn ảnh'}
          </p>
          <p className="text-xs text-slate-500">Chấp nhận PNG, JPEG hoặc WebP. Tối đa 10 MB.</p>
        </div>
      )}

      {/* Live region for notices (paste success) and validation errors. */}
      {notice ? (
        <p role="status" className="mt-2 text-xs font-medium text-green-700">{notice}</p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs font-medium text-red-600">{error}</p>
      ) : null}

      {/* Reuses the current preview object URL — never re-reads or re-uploads the file. */}
      {viewerOpen && value && previewUrl ? (
        <ImageViewer src={previewUrl} alt="Xem trước ảnh sẽ gửi" fileName={value.name} onClose={() => setViewerOpen(false)} />
      ) : null}
    </div>
  );
}
