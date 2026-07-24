import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, RotateCcw, RotateCw, Scan, X } from 'lucide-react';

export interface ImageViewerProps {
  /** Image source. Reuse the existing preview object URL — never re-upload or recreate the blob. */
  src: string;
  /** Accessible description of the image. */
  alt?: string;
  /** Optional filename shown in the toolbar. */
  fileName?: string;
  /** Closes the viewer (ESC, backdrop click, or the close button). */
  onClose: () => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.2;

const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

/**
 * A modern, view-only image viewer modal. Supports zoom presets (100/150/200 %,
 * fit width, original size), mouse-wheel zoom, 90° rotation (left/right), drag to
 * pan when zoomed, reset, keyboard shortcuts and a focus trap.
 *
 * It is strictly **view-only**: rotation and zoom never modify the file, blob or
 * pixels — they are CSS transforms on the same `src` the caller already owns. The
 * viewer never creates or revokes object URLs, so it always reuses the current
 * preview without re-reading or re-uploading the image.
 */
export function ImageViewer({ src, alt = 'Ảnh xem chi tiết', fileName, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0); // degrees: 0 / 90 / 180 / 270
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [shown, setShown] = useState(false); // drives the fade-in
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const titleId = useId();

  const zoomIn = useCallback(() => setScale((s) => clampScale(s * ZOOM_FACTOR)), []);
  const zoomOut = useCallback(() => setScale((s) => clampScale(s / ZOOM_FACTOR)), []);
  const rotateRight = useCallback(() => setRotation((r) => (r + 90) % 360), []);
  const rotateLeft = useCallback(() => setRotation((r) => (r + 270) % 360), []);
  const setPreset = useCallback((next: number) => {
    setScale(clampScale(next));
    setOffset({ x: 0, y: 0 });
  }, []);
  const original = useCallback(() => setPreset(1), [setPreset]);
  const fitWidth = useCallback(() => {
    const stageW = stageRef.current?.clientWidth ?? 0;
    if (nat && nat.w > 0 && stageW > 0) {
      setPreset(stageW / nat.w);
    } else {
      setPreset(1); // no natural size yet (e.g. not decoded) → safe fallback
    }
  }, [nat, setPreset]);
  const reset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Fade in after mount for a smooth entrance.
  useEffect(() => {
    setShown(true);
  }, []);

  // Lock body scroll while the viewer is open; restore on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Move focus into the dialog on open and restore it to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Global keyboard shortcuts: ESC close, +/- zoom, 0 reset, R/L rotate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomIn();
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomOut();
          break;
        case '0':
          e.preventDefault();
          reset();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          rotateRight();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          rotateLeft();
          break;
        default:
          break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, zoomIn, zoomOut, reset, rotateRight, rotateLeft]);

  // Keep focus inside the dialog (simple focus trap on Tab).
  const onDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => clampScale(e.deltaY < 0 ? s * ZOOM_FACTOR : s / ZOOM_FACTOR));
  };

  // Drag-to-pan.
  const onPointerDown = (e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return;
    setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const endDrag = () => {
    dragStart.current = null;
    setDragging(false);
  };

  // Double-click / double-tap toggles fit-width ⇄ original size.
  const onDoubleClick = () => {
    if (Math.abs(scale - 1) < 0.01) fitWidth();
    else original();
  };

  // Optional pinch-to-zoom (mobile).
  const touchDist = (t: React.TouchList) => {
    const dx = t[0]!.clientX - t[1]!.clientX;
    const dy = t[0]!.clientY - t[1]!.clientY;
    return Math.hypot(dx, dy);
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStart.current = { dist: touchDist(e.touches), scale };
    } else if (e.touches.length === 1) {
      dragStart.current = { x: e.touches[0]!.clientX - offset.x, y: e.touches[0]!.clientY - offset.y };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      const ratio = touchDist(e.touches) / (pinchStart.current.dist || 1);
      setScale(clampScale(pinchStart.current.scale * ratio));
    } else if (e.touches.length === 1 && dragStart.current) {
      setOffset({ x: e.touches[0]!.clientX - dragStart.current.x, y: e.touches[0]!.clientY - dragStart.current.y });
    }
  };
  const onTouchEnd = () => {
    pinchStart.current = null;
    dragStart.current = null;
  };

  const percent = Math.round(scale * 100);
  const canPan = scale > 1;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onDialogKeyDown}
      onClick={onClose}
      className={`fixed inset-0 z-[60] flex flex-col bg-black/90 transition-opacity duration-150 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span id={titleId} className="mr-1 min-w-0 flex-1 truncate text-sm font-medium" title={fileName}>
          {fileName ?? 'Xem ảnh'}
        </span>

        <ToolButton label="Thu nhỏ (phím -)" onClick={zoomOut}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        <span className="w-14 text-center text-sm tabular-nums" role="status" aria-live="polite" aria-label={`Mức phóng ${percent} phần trăm`}>
          {percent}%
        </span>
        <ToolButton label="Phóng to (phím +)" onClick={zoomIn}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        <span className="mx-1 hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />

        <PresetButton onClick={() => setPreset(1)}>100%</PresetButton>
        <PresetButton onClick={() => setPreset(1.5)}>150%</PresetButton>
        <PresetButton onClick={() => setPreset(2)}>200%</PresetButton>
        <ToolButton label="Vừa chiều ngang" onClick={fitWidth}>
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Kích thước gốc" onClick={original}>
          <Scan className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        <span className="mx-1 hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />

        <ToolButton label="Xoay trái (phím L)" onClick={rotateLeft}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Xoay phải (phím R)" onClick={rotateRight}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </ToolButton>

        <PresetButton onClick={reset}>Đặt lại</PresetButton>

        <ToolButton label="Đóng (ESC)" onClick={onClose} ref={closeRef}>
          <X className="h-5 w-5" aria-hidden="true" />
        </ToolButton>
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={onDoubleClick}
        style={{ cursor: dragging ? 'grabbing' : canPan ? 'grab' : 'default' }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transition: dragging ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
    </div>
  );
}

const ToolButton = forwardRef<
  HTMLButtonElement,
  { label: string; onClick: () => void; children: React.ReactNode }
>(function ToolButton({ label, onClick, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      {children}
    </button>
  );
});

function PresetButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      {children}
    </button>
  );
}
