import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { devTestApi, type GenerateSummary } from '../api/devTest';
import { branchesApi } from '../api/bookings';
import { useDevTools } from '../hooks/useDevTools';
import { toUserMessage } from '../api/errors';
import { Card } from './Card';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorAlert } from './ErrorAlert';
import { Toast } from './Toast';

const CLEAR_PHRASE = 'XOA DU LIEU DEMO';

/**
 * Admin-only developer panel (Settings) for generating and clearing demo data.
 * Renders nothing unless the server's developer tools are enabled.
 */
export function DevToolsPanel() {
  const status = useDevTools();
  const queryClient = useQueryClient();
  // The branch count is read from the server, never hardcoded: a ninth branch
  // added by the Admin is generated for automatically.
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list(), staleTime: 5 * 60_000 });
  const branchCount = branches.data ? branches.data.branches.length : null;
  const [form, setForm] = useState({ bookingsPerBranch: 10, issuesPerBranch: 3, includeProofs: true, includeOcr: true, includeComparisons: true, seed: 12345 });
  const [confirmGen, setConfirmGen] = useState(false);
  const [clearStep, setClearStep] = useState<0 | 1 | 2>(0);
  const [phrase, setPhrase] = useState('');
  const [summary, setSummary] = useState<GenerateSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => devTestApi.generate(form),
    onSuccess: (res) => {
      setSummary(res.summary);
      setConfirmGen(false);
      void queryClient.invalidateQueries();
    },
  });
  const clear = useMutation({
    mutationFn: () => devTestApi.clear(phrase),
    onSuccess: () => {
      setClearStep(0);
      setPhrase('');
      setSummary(null);
      void queryClient.invalidateQueries();
      setToast('Đã xóa toàn bộ dữ liệu demo.');
    },
  });

  if (!status.data?.enabled) return null;

  const num = (v: string, min: number) => Math.max(min, Number(v) || 0);

  return (
    <Card className="mt-6 border-amber-300 bg-amber-50/40 p-5">
      <div className="flex items-center gap-2 text-amber-800">
        <FlaskConical className="h-5 w-5" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Công cụ dữ liệu test</h2>
      </div>
      <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-800">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        Chỉ dùng trong môi trường phát triển. Không sử dụng với dữ liệu vận hành thật.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Số booking mỗi chi nhánh
          <input type="number" min={0} max={100} value={form.bookingsPerBranch} onChange={(e) => setForm({ ...form, bookingsPerBranch: num(e.target.value, 0) })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-slate-600">
          Số sự cố mỗi chi nhánh
          <input type="number" min={0} max={50} value={form.issuesPerBranch} onChange={(e) => setForm({ ...form, issuesPerBranch: num(e.target.value, 0) })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-slate-600">
          Seed
          <input type="number" value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-col justify-center gap-1 text-sm text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.includeProofs} onChange={(e) => setForm({ ...form, includeProofs: e.target.checked })} /> Bao gồm proof</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.includeOcr} onChange={(e) => setForm({ ...form, includeOcr: e.target.checked })} /> Bao gồm OCR</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.includeComparisons} onChange={(e) => setForm({ ...form, includeComparisons: e.target.checked })} /> Bao gồm comparison</label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => setConfirmGen(true)} disabled={generate.isPending}>
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="h-4 w-4" aria-hidden="true" />}
          {branchCount === null ? 'Tạo dữ liệu demo cho các chi nhánh' : `Tạo dữ liệu demo cho ${branchCount} chi nhánh`}
        </Button>
        <Button variant="danger" onClick={() => setClearStep(1)} disabled={clear.isPending}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Xóa toàn bộ dữ liệu demo
        </Button>
      </div>

      {generate.isError ? <div className="mt-3"><ErrorAlert>{toUserMessage(generate.error)}</ErrorAlert></div> : null}

      {summary ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <p className="font-medium text-slate-800">Đã tạo dữ liệu demo</p>
          <p className="text-xs text-slate-500">Batch {summary.batchId}</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-3">
            <li>{summary.branches} chi nhánh</li>
            <li>{summary.bookingsCreated} booking</li>
            <li>{summary.issuesCreated} sự cố</li>
            <li>{summary.proofsCreated} proof</li>
            <li>{summary.analysesCreated} OCR</li>
            <li>{summary.comparisonsCreated} đối chiếu</li>
          </ul>
        </div>
      ) : null}

      {/* Generate confirmation */}
      <Modal
        open={confirmGen}
        title="Tạo dữ liệu demo"
        onClose={() => setConfirmGen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmGen(false)}>Hủy</Button>
            <Button onClick={() => generate.mutate()} loading={generate.isPending}>Tiếp tục</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Hệ thống sẽ tạo dữ liệu giả cho toàn bộ {branchCount ?? ''} chi nhánh đang hoạt động. Tiếp tục?
        </p>
      </Modal>

      {/* Clear: two-step confirmation */}
      <Modal
        open={clearStep === 1}
        title="Xóa dữ liệu demo"
        onClose={() => setClearStep(0)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearStep(0)}>Hủy</Button>
            <Button variant="danger" onClick={() => setClearStep(2)}>Tôi hiểu, tiếp tục</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Bạn sắp xóa toàn bộ dữ liệu demo của {branchCount ?? ''} chi nhánh.</p>
        <p className="mt-2 text-xs text-slate-500">
          Sẽ được giữ lại: toàn bộ chi nhánh và cấu hình tên nền tảng · Tài khoản Admin · Tài khoản lễ tân test · Cấu hình hệ thống.
        </p>
      </Modal>
      <Modal
        open={clearStep === 2}
        title="Xác nhận xóa dữ liệu demo"
        onClose={() => { setClearStep(0); setPhrase(''); }}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setClearStep(0); setPhrase(''); }}>Hủy</Button>
            <Button variant="danger" onClick={() => clear.mutate()} loading={clear.isPending} disabled={phrase !== CLEAR_PHRASE}>
              Xóa vĩnh viễn
            </Button>
          </>
        }
      >
        <label className="block text-sm text-slate-600">
          Gõ chính xác <span className="font-mono font-semibold">{CLEAR_PHRASE}</span> để xác nhận:
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" aria-label="Cụm từ xác nhận xóa" />
        </label>
        {clear.isError ? <div className="mt-3"><ErrorAlert>{toUserMessage(clear.error)}</ErrorAlert></div> : null}
      </Modal>

      <Toast message={toast} onDone={() => setToast(null)} />
    </Card>
  );
}
