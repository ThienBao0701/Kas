import { CheckCircle2, CircleDashed, Info, Loader2, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { useProofComparison } from '../hooks/useProofComparison';
import type { FieldComparison, FieldResult, OverallStatus } from '../api/compare';

/**
 * Admin-only card that shows the deterministic proof-vs-booking comparison. It is
 * advisory: there is no auto-approval/rejection and the manual verdict buttons are
 * unaffected. Colour is never the only signal — every state has text + an icon.
 */
export function ProofComparisonCard({ bookingId, proofId }: { bookingId: string; proofId: string }) {
  const query = useProofComparison(bookingId, proofId);
  const comparison = query.data?.comparison ?? null;
  const overall: OverallStatus = comparison?.overallStatus ?? 'UNAVAILABLE';
  const fields = comparison?.result?.fields ?? [];

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Kết quả đối chiếu">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">Kết quả đối chiếu</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          aria-label="Làm mới đối chiếu"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Làm mới
        </button>
      </div>

      <div className="mt-3">
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Đang tải kết quả đối chiếu…
          </p>
        ) : query.isError ? (
          <p className="flex items-center gap-2 text-sm text-red-600" role="status">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            Không thể tải kết quả đối chiếu.
          </p>
        ) : (
          <>
            <OverallBanner overall={overall} />
            {fields.length > 0 ? <FieldTable fields={fields} /> : null}
          </>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span>Kết quả đối chiếu chỉ mang tính hỗ trợ. Admin phải kiểm tra ảnh trước khi xác nhận.</span>
      </p>
    </section>
  );
}

const OVERALL: Record<OverallStatus, { text: string; sub: string; cls: string; Icon: typeof CheckCircle2 }> = {
  MATCH: { text: 'KHỚP', sub: 'Các trường quan trọng đã nhận diện đều khớp.', cls: 'border-green-200 bg-green-50 text-green-800', Icon: CheckCircle2 },
  WARNING: { text: 'CẦN KIỂM TRA', sub: 'Không phát hiện sai khác nghiêm trọng nhưng còn dữ liệu thiếu hoặc chưa chắc chắn.', cls: 'border-amber-200 bg-amber-50 text-amber-800', Icon: TriangleAlert },
  MISMATCH: { text: 'CÓ SAI KHÁC', sub: 'Có ít nhất một trường quan trọng không khớp.', cls: 'border-red-200 bg-red-50 text-red-800', Icon: XCircle },
  UNAVAILABLE: { text: 'CHƯA CÓ KẾT QUẢ', sub: 'OCR chưa hoàn thành hoặc chưa thể đối chiếu.', cls: 'border-slate-200 bg-slate-50 text-slate-600', Icon: CircleDashed },
};

function OverallBanner({ overall }: { overall: OverallStatus }) {
  const o = OVERALL[overall];
  const Icon = o.Icon;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${o.cls}`} role="status" aria-label={`Kết quả đối chiếu: ${o.text}`}>
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{o.text}</p>
        <p className="text-xs">{o.sub}</p>
      </div>
    </div>
  );
}

const RESULT_META: Record<FieldResult, { label: string; cls: string }> = {
  MATCH: { label: 'Khớp', cls: 'text-green-700' },
  MISMATCH: { label: 'Sai', cls: 'text-red-700' },
  WARNING: { label: 'Cần kiểm tra', cls: 'text-amber-700' },
  NOT_FOUND: { label: 'Không tìm thấy', cls: 'text-slate-500' },
  NOT_APPLICABLE: { label: 'Không áp dụng', cls: 'text-slate-400' },
};

function FieldTable({ fields }: { fields: FieldComparison[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Hạng mục</th>
            <th className="py-2 pr-3">Kết quả</th>
            <th className="py-2 pr-3">Admin gửi</th>
            <th className="py-2">OCR nhận diện</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const meta = RESULT_META[f.result];
            return (
              <tr key={f.field} className="border-b border-slate-100 align-top last:border-b-0">
                <td className="py-2 pr-3">
                  <span className="font-medium text-slate-800">{f.label}</span>
                  {f.result !== 'MATCH' && f.message ? <p className="mt-0.5 text-xs text-slate-500">{f.message}</p> : null}
                </td>
                <td className={`py-2 pr-3 font-medium ${meta.cls}`}>{meta.label}</td>
                <td className="py-2 pr-3 text-slate-700">{f.expected ?? '—'}</td>
                <td className="py-2 text-slate-700">{f.detected ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
