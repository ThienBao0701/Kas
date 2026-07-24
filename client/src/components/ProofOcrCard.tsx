import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, Loader2, RefreshCw, ScanText, TriangleAlert } from 'lucide-react';
import {
  isAnalysisPending,
  ocrApi,
  type OcrField,
  type ProofExtractedData,
} from '../api/ocr';
import { toUserMessage } from '../api/errors';
import { formatMoney, paymentLabel } from '../lib/format';
import { Button } from './Button';

const POLL_MS = 5_000;

/**
 * Admin-only card that shows what OCR *read* from a proof screenshot. It is
 * advisory extraction only — there is deliberately no ĐÚNG/SAI/MATCH/MISMATCH and
 * no approval recommendation here; the Admin still checks the image themselves.
 */
export function ProofOcrCard({ bookingId, proofId }: { bookingId: string; proofId: string }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['proof-ocr', bookingId, proofId],
    queryFn: () => ocrApi.latest(bookingId, proofId),
    // Poll only while a run is still in progress; stop once it is terminal.
    refetchInterval: (q) => (isAnalysisPending(q.state.data?.analysis?.status) ? POLL_MS : false),
  });

  const analysis = query.data?.analysis ?? null;

  const analyze = useMutation({
    mutationFn: () => ocrApi.analyze(bookingId, proofId),
    onSuccess: (res) => {
      queryClient.setQueryData(['proof-ocr', bookingId, proofId], { analysis: res.analysis });
      void queryClient.invalidateQueries({ queryKey: ['proof-ocr', bookingId, proofId] });
    },
  });

  const status = analysis?.status;
  const pending = query.isLoading || isAnalysisPending(status);
  const canReanalyze = status !== 'DISABLED' && !isAnalysisPending(status) && !analyze.isPending;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4" aria-label="Dữ liệu nhận diện từ ảnh">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ScanText className="h-4 w-4 text-slate-400" aria-hidden="true" />
          Dữ liệu nhận diện từ ảnh
        </p>
        {canReanalyze ? (
          <Button variant="secondary" onClick={() => analyze.mutate()} loading={analyze.isPending}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Phân tích lại ảnh
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        {query.isError ? (
          <StateLine tone="error">Không thể tải dữ liệu nhận diện.</StateLine>
        ) : pending ? (
          <StateLine tone="muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Đang phân tích ảnh…
          </StateLine>
        ) : status === 'DISABLED' ? (
          <StateLine tone="muted">OCR đang tắt. Vui lòng kiểm tra ảnh thủ công.</StateLine>
        ) : status === 'FAILED' ? (
          <StateLine tone="error">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            Không thể nhận diện ảnh. Vui lòng kiểm tra ảnh thủ công.
          </StateLine>
        ) : status === 'COMPLETED' && analysis?.fields ? (
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-green-700" role="status">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Đã nhận diện
            </p>
            <div className="mt-3">
              <CompletedFields fields={analysis.fields} />
            </div>
          </div>
        ) : (
          <StateLine tone="muted">Chưa có dữ liệu nhận diện.</StateLine>
        )}
      </div>

      {analyze.isError ? <StateLine tone="error">{toUserMessage(analyze.error)}</StateLine> : null}

      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span>
          Kết quả OCR chỉ là dữ liệu nhận diện từ ảnh. Admin vẫn phải tự kiểm tra ảnh trước khi xác nhận.
        </span>
      </p>
    </section>
  );
}

function StateLine({ tone, children }: { tone: 'muted' | 'error'; children: React.ReactNode }) {
  const cls = tone === 'error' ? 'text-red-600' : 'text-slate-500';
  return <p className={`flex items-center gap-2 text-sm ${cls}`} role="status">{children}</p>;
}

function CompletedFields({ fields }: { fields: ProofExtractedData }) {
  const roomTypeText =
    fields.roomTypes.length > 0 ? fields.roomTypes.map((r) => r.value).join(', ') : null;
  const roomTypeConfidence = fields.roomTypes[0]?.confidence;

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <FieldRow label="Mã Booking" field={fields.bookingCode} mono />
      <FieldRow label="Tên khách" field={fields.customerName} />
      <FieldRow label="Check-in" field={fields.checkInDate} />
      <FieldRow label="Check-out" field={fields.checkOutDate} />
      <FieldRow label="Số đêm" field={fields.nights} format={(v) => String(v)} />
      <FieldRow label="Số lượng phòng" field={fields.roomQuantity} format={(v) => String(v)} />
      <FieldValue label="Hạng phòng" text={roomTypeText} confidence={roomTypeConfidence} />
      <FieldValue
        label="Tổng tiền"
        text={fields.totalAmount ? formatMoney(fields.totalAmount.value, fields.totalAmount.currency) : null}
        confidence={fields.totalAmount?.confidence}
      />
      <FieldValue
        label="Thanh toán"
        text={fields.paymentStatus ? paymentLabel(fields.paymentStatus.value) : null}
        confidence={fields.paymentStatus?.confidence}
      />
      <FieldRow label="Ghi chú" field={fields.note} />
    </dl>
  );
}

function FieldRow<T extends string | number>({
  label,
  field,
  mono = false,
  format,
}: {
  label: string;
  field: OcrField<T> | null;
  mono?: boolean;
  format?: (v: T) => string;
}) {
  const text = field ? (format ? format(field.value) : String(field.value)) : null;
  return <FieldValue label={label} text={text} confidence={field?.confidence} mono={mono} />;
}

function FieldValue({
  label,
  text,
  confidence,
  mono = false,
}: {
  label: string;
  text: string | null;
  confidence: number | undefined;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      {text ? (
        <>
          <dd className={`mt-0.5 break-words text-sm font-medium text-slate-800 ${mono ? 'font-mono' : ''}`}>{text}</dd>
          {typeof confidence === 'number' ? (
            <dd className="text-xs text-slate-400">Độ tin cậy OCR: {confidence}%</dd>
          ) : null}
        </>
      ) : (
        <dd className="mt-0.5 text-sm italic text-slate-400">Không nhận diện được</dd>
      )}
    </div>
  );
}
