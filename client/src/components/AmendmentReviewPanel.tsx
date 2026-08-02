/**
 * Reviewing an amended reservation before anything is applied.
 *
 * An amended mail restates a booking the branch is already working from, so the
 * screen shows ONLY what differs — old beside new — and applies nothing until a
 * person says so. Every row can be deselected individually: a mail that changes
 * four things is rarely four changes an operator agrees with.
 *
 * The server computes the comparison and performs the write; this panel holds
 * no business rules. It decides one thing only: which fields the reviewer
 * ticked.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import {
  otaReviewApi,
  type AmendmentChange,
  type AmendmentPreview,
  type AmendmentResult,
  type OtaReviewSource,
} from '../api/otaReview';
import { toUserMessage } from '../api/errors';
import { Button } from './Button';
import { Card } from './Card';
import { ErrorAlert } from './ErrorAlert';

interface AmendmentReviewPanelProps {
  source: OtaReviewSource;
  rawText: string;
  /** Called after a successful apply, so the page can refresh what it shows. */
  onApplied?: (result: AmendmentResult) => void;
  onCancel?: () => void;
}

export function AmendmentReviewPanel({
  source,
  rawText,
  onApplied,
  onCancel,
}: AmendmentReviewPanelProps) {
  const [preview, setPreview] = useState<AmendmentPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Which fields are ticked. Every change starts ACCEPTED. */
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<AmendmentResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await otaReviewApi.amendment(source, rawText);
      setPreview(data);
      setAccepted(new Set(data.changes.map((c) => c.field)));
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  }, [source, rawText]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (field: string): void => {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  /**
   * Applies the ticked fields.
   *
   * `applying` guards the whole call, so a double click cannot submit twice —
   * the second press finds the button disabled and the guard already set. On
   * failure nothing is marked as applied: the panel reports the error and
   * leaves the selection exactly as it was, so the reviewer can retry without
   * re-ticking anything.
   */
  const applySelected = async (fields: string[]): Promise<void> => {
    if (applying || !preview) return;
    setApplying(true);
    setError(null);
    try {
      const applied = await otaReviewApi.applyAmendment(
        source,
        rawText,
        fields,
        preview.expectedVersion,
      );
      setResult(applied);
      onApplied?.(applied);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <Card><p className="text-sm text-slate-500">Đang so sánh nội dung sửa đổi…</p></Card>;
  }

  if (error && !preview) {
    return (
      <div className="space-y-3">
        <ErrorAlert>{error}</ErrorAlert>
        {onCancel ? <Button variant="secondary" onClick={onCancel}>Đóng</Button> : null}
      </div>
    );
  }

  if (!preview) return null;

  /* ---- After applying ------------------------------------------------- */
  if (result) {
    return (
      <div className="space-y-4" data-testid="amendment-result">
        <Card>
          <h3 className="text-base font-semibold text-slate-900">Đã cập nhật đơn</h3>

          <p className="mt-2 text-sm font-medium text-emerald-700">
            Đã áp dụng {result.applied.length} thay đổi
          </p>
          <ul className="mt-1 space-y-1 text-sm text-slate-700" data-testid="amendment-applied">
            {result.applied.map((c) => (
              <li key={c.field}>
                {c.label}: <span className="text-slate-500">{c.oldValue ?? '—'}</span> →{' '}
                <strong>{c.newValue ?? '—'}</strong>
              </li>
            ))}
          </ul>

          {result.rejected.length > 0 ? (
            <>
              <p className="mt-3 text-sm font-medium text-slate-600">
                Bỏ qua {result.rejected.length} thay đổi
              </p>
              <ul className="mt-1 space-y-1 text-sm text-slate-500" data-testid="amendment-ignored">
                {result.rejected.map((c) => (
                  <li key={c.field}>{c.label}</li>
                ))}
              </ul>
            </>
          ) : null}

          {/* The actual audit rows, so "it was recorded" is verifiable. */}
          {result.correctionIds.length > 0 ? (
            <p className="mt-3 text-xs text-slate-500" data-testid="amendment-correction-ids">
              Mã lưu vết: {result.correctionIds.join(', ')}
            </p>
          ) : null}
        </Card>
        {onCancel ? <Button variant="secondary" onClick={onCancel}>Đóng</Button> : null}
      </div>
    );
  }

  /* ---- The comparison -------------------------------------------------- */
  return (
    <div className="space-y-4" data-testid="amendment-review">
      {/*
        A cancelled mail is a WARNING and nothing more. The booking's status is
        never changed here — someone must cancel it deliberately from the
        booking itself.
      */}
      {preview.otaCancelled ? (
        <div
          data-testid="amendment-cancelled-banner"
          className="flex gap-3 rounded-lg border-2 border-red-300 bg-red-50 p-4"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="text-sm text-red-800">
            <p className="font-semibold">OTA báo đơn này ĐÃ HUỶ</p>
            <p className="mt-1">
              Hệ thống KHÔNG tự huỷ đơn. Đơn hiện vẫn ở trạng thái{' '}
              <strong>{preview.currentStatus}</strong>. Nếu đúng là khách đã huỷ, vui lòng huỷ đơn
              thủ công trong màn hình đơn đặt phòng.
            </p>
          </div>
        </div>
      ) : null}

      {error ? <ErrorAlert>{error}</ErrorAlert> : null}

      <Card>
        <h3 className="text-base font-semibold text-slate-900">Nội dung sửa đổi</h3>

        {preview.changes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600" data-testid="amendment-no-changes">
            Nội dung này không thay đổi thông tin nào so với đơn đã gửi.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {preview.changes.map((change: AmendmentChange) => (
              <li key={change.field} className="flex items-start gap-3 py-3">
                <input
                  type="checkbox"
                  aria-label={`Áp dụng ${change.label}`}
                  checked={accepted.has(change.field)}
                  onChange={() => toggle(change.field)}
                  disabled={applying}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {change.label}
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">
                      đã thay đổi
                    </span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500 line-through">{change.oldValue ?? '—'}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <strong className="text-slate-900">{change.newValue ?? '—'}</strong>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void applySelected([...accepted])}
          disabled={applying || accepted.size === 0 || preview.changes.length === 0}
          loading={applying}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Áp dụng {accepted.size} thay đổi
        </Button>
        <Button
          variant="secondary"
          onClick={() => void applySelected([])}
          disabled={applying || preview.changes.length === 0}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Từ chối tất cả
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={applying}>
            Huỷ
          </Button>
        ) : null}
      </div>
    </div>
  );
}
