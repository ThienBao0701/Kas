import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Tags, Trash2 } from 'lucide-react';
import {
  ALIAS_SOURCE_LABEL,
  adminBranchesApi,
  type AdminBranch,
  type AliasSource,
  type CreateBranchInput,
  type NewAliasInput,
} from '../api/adminBranches';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorAlert } from '../components/ErrorAlert';
import { Modal } from '../components/Modal';
import { PageHeader, QueryState } from '../components/PageState';
import { Toast } from '../components/Toast';

const inputClass =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

/** Local mirror of the server's suggestion, so the code appears while typing. */
function suggestCode(address: string): string {
  const tokens = address
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) return '';
  // A house number may be a range ("40-42", "170-172-174"): the whole leading
  // numeric run is the number, and only its first part goes into the code.
  let lead = 0;
  while (lead < tokens.length && /^\d/.test(tokens[lead]!)) lead += 1;
  const idx = lead > 0 ? 0 : tokens.findIndex((t) => /^\d/.test(t));
  const houseNumber = idx >= 0 ? tokens[idx]! : null;
  const words = lead > 0 ? tokens.slice(lead) : tokens.filter((_, i) => i !== idx);
  return [...words, ...(houseNumber ? [houseNumber] : [])].join('_').slice(0, 60);
}

function aliasesOf(branch: AdminBranch, source: AliasSource) {
  return branch.aliases.filter((a) => a.source === source);
}

/**
 * Admin-only hotel & branch management: branch numbers, internal names,
 * addresses, breakfast, contact details, activation, and the Booking.com / Agoda
 * hotel names that route pasted text to each branch.
 */
export function BranchesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBranch | null>(null);
  const [managingAliases, setManagingAliases] = useState<AdminBranch | null>(null);
  const [confirming, setConfirming] = useState<AdminBranch | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const branches = useQuery({ queryKey: ['admin-branches'], queryFn: () => adminBranchesApi.list() });
  const rows = useMemo(() => branches.data?.branches ?? [], [branches.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-branches'] });
    await queryClient.invalidateQueries({ queryKey: ['branches'] });
  };

  // Keep the open dialogs pointed at fresh data after every mutation.
  useEffect(() => {
    const sync = (b: AdminBranch | null) => (b ? (rows.find((r) => r.id === b.id) ?? b) : null);
    setEditing((prev) => sync(prev));
    setManagingAliases((prev) => sync(prev));
    setConfirming((prev) => sync(prev));
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Quản lý khách sạn & chi nhánh"
        description="Số chi nhánh, tên nội bộ, địa chỉ, ăn sáng và tên khách sạn trên Booking.com / Agoda."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Thêm khách sạn / chi nhánh
          </Button>
        }
      />

      <QueryState isLoading={branches.isLoading} isError={branches.isError} error={branches.error}>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Danh sách khách sạn và chi nhánh</caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-3">Số CN</th>
                  <th scope="col" className="px-4 py-3">Tên nội bộ</th>
                  <th scope="col" className="px-4 py-3">Địa chỉ</th>
                  <th scope="col" className="px-4 py-3">Mã chi nhánh</th>
                  <th scope="col" className="px-4 py-3">Tên trên nền tảng</th>
                  <th scope="col" className="px-4 py-3">Ăn sáng</th>
                  <th scope="col" className="px-4 py-3">Lễ tân</th>
                  <th scope="col" className="px-4 py-3">Trạng thái</th>
                  <th scope="col" className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 align-top last:border-b-0">
                    <td className="px-4 py-3 font-semibold text-slate-800">{b.branchNumber}</td>
                    <td className="px-4 py-3 text-slate-800">{b.hotelName}</td>
                    <td className="px-4 py-3 text-slate-600">{b.address}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{b.code}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <AliasSummary branch={b} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {b.breakfastIncluded ? 'Có ăn sáng' : 'Không ăn sáng'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{b.activeReceptionistCount}</td>
                    <td className="px-4 py-3">
                      {b.active ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Đang hoạt động</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Đã vô hiệu hóa</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="secondary" onClick={() => setEditing(b)}>Chỉnh sửa</Button>
                        <Button variant="secondary" onClick={() => setManagingAliases(b)}>
                          <Tags className="h-4 w-4" aria-hidden="true" />
                          Quản lý tên trên nền tảng
                        </Button>
                        <Button
                          variant={b.active ? 'danger' : 'primary'}
                          onClick={() => setConfirming(b)}
                        >
                          {b.active ? 'Vô hiệu hóa' : 'Kích hoạt lại'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                      Chưa có chi nhánh nào.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </QueryState>

      <BranchFormModal
        open={createOpen}
        branch={null}
        onClose={() => setCreateOpen(false)}
        onSaved={async (message) => {
          setCreateOpen(false);
          await invalidate();
          setToast(message);
        }}
      />
      <BranchFormModal
        open={editing !== null}
        branch={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          await invalidate();
          setToast(message);
        }}
      />
      <AliasModal
        branch={managingAliases}
        onClose={() => setManagingAliases(null)}
        onChanged={invalidate}
      />
      <ActivationModal
        branch={confirming}
        onClose={() => setConfirming(null)}
        onDone={async (message) => {
          setConfirming(null);
          await invalidate();
          setToast(message);
        }}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function AliasSummary({ branch }: { branch: AdminBranch }) {
  const booking = aliasesOf(branch, 'BOOKING_COM');
  const agoda = aliasesOf(branch, 'AGODA');
  if (booking.length === 0 && agoda.length === 0) {
    return <span className="italic text-slate-400">Chưa cấu hình tên nền tảng</span>;
  }
  return (
    <ul className="space-y-0.5">
      {[...booking, ...agoda].map((a) => (
        <li key={a.id} className={a.active ? '' : 'text-slate-400 line-through'}>
          <span className="font-medium text-slate-500">{ALIAS_SOURCE_LABEL[a.source]}:</span> {a.alias}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Add / edit branch                                                   */
/* ------------------------------------------------------------------ */

const EMPTY_FORM: CreateBranchInput = {
  branchNumber: 0,
  hotelName: '',
  address: '',
  code: '',
  breakfastIncluded: false,
  active: true,
  phone: '',
  email: '',
  contactName: '',
  note: '',
  aliases: [],
};

function BranchFormModal({
  open,
  branch,
  onClose,
  onSaved,
}: {
  open: boolean;
  branch: AdminBranch | null;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const isEdit = branch !== null;
  const [form, setForm] = useState<CreateBranchInput>(EMPTY_FORM);
  const [codeTouched, setCodeTouched] = useState(false);
  const [pendingAliases, setPendingAliases] = useState<NewAliasInput[]>([]);
  const [draftAlias, setDraftAlias] = useState<NewAliasInput>({ source: 'BOOKING_COM', alias: '' });

  useEffect(() => {
    if (!open) return;
    setCodeTouched(isEdit);
    setPendingAliases([]);
    setDraftAlias({ source: 'BOOKING_COM', alias: '' });
    setForm(
      branch
        ? {
            branchNumber: branch.branchNumber,
            hotelName: branch.hotelName,
            address: branch.address,
            code: branch.code,
            breakfastIncluded: branch.breakfastIncluded,
            active: branch.active,
            phone: branch.phone ?? '',
            email: branch.email ?? '',
            contactName: branch.contactName ?? '',
            note: branch.note ?? '',
          }
        : EMPTY_FORM,
    );
  }, [open, branch, isEdit]);

  const save = useMutation({
    mutationFn: async () => {
      const contact = {
        phone: form.phone || null,
        email: form.email || null,
        contactName: form.contactName || null,
        note: form.note || null,
      };
      if (branch) {
        return adminBranchesApi.update(branch.id, {
          branchNumber: form.branchNumber,
          hotelName: form.hotelName,
          address: form.address,
          breakfastIncluded: form.breakfastIncluded,
          ...contact,
        });
      }
      return adminBranchesApi.create({
        ...form,
        ...contact,
        code: form.code.trim().toUpperCase(),
        aliases: pendingAliases,
      });
    },
    onSuccess: () => void onSaved(branch ? 'Đã cập nhật chi nhánh.' : 'Đã tạo chi nhánh mới.'),
  });

  const codeError =
    !isEdit && form.code.length > 0 && !/^[A-Z0-9_]+$/.test(form.code.trim().toUpperCase())
      ? 'Mã chi nhánh chỉ được gồm chữ IN HOA, số và dấu gạch dưới.'
      : null;

  const valid =
    form.branchNumber > 0 &&
    form.hotelName.trim().length > 0 &&
    form.address.trim().length > 0 &&
    (isEdit || (form.code.trim().length >= 3 && !codeError));

  const addDraftAlias = () => {
    const alias = draftAlias.alias.trim();
    if (alias.length === 0) return;
    setPendingAliases((prev) => [...prev, { source: draftAlias.source, alias }]);
    setDraftAlias({ source: draftAlias.source, alias: '' });
  };

  return (
    <Modal
      open={open}
      title={isEdit ? 'Chỉnh sửa chi nhánh' : 'Thêm khách sạn / chi nhánh'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button onClick={() => save.mutate()} disabled={!valid} loading={save.isPending}>
            {isEdit ? 'Lưu thay đổi' : 'Tạo chi nhánh'}
          </Button>
        </>
      }
    >
      {save.isError ? <div className="mb-3"><ErrorAlert>{toUserMessage(save.error)}</ErrorAlert></div> : null}

      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-600">
          Số chi nhánh
          <input
            type="number"
            min={1}
            className={`${inputClass} mt-1`}
            value={form.branchNumber || ''}
            onChange={(e) => setForm({ ...form, branchNumber: Number(e.target.value) || 0 })}
          />
        </label>

        <label className="block text-sm font-medium text-slate-600">
          Tên nội bộ
          <input
            className={`${inputClass} mt-1`}
            value={form.hotelName}
            onChange={(e) => setForm({ ...form, hotelName: e.target.value })}
          />
        </label>

        <label className="block text-sm font-medium text-slate-600">
          Địa chỉ
          <input
            className={`${inputClass} mt-1`}
            value={form.address}
            onChange={(e) => {
              const address = e.target.value;
              setForm((prev) => ({
                ...prev,
                address,
                code: codeTouched ? prev.code : suggestCode(address),
              }));
            }}
          />
        </label>

        <label className="block text-sm font-medium text-slate-600">
          Mã chi nhánh (stable code)
          <input
            className={`${inputClass} mt-1 font-mono ${isEdit ? 'bg-slate-100 text-slate-500' : ''}`}
            value={form.code}
            readOnly={isEdit}
            disabled={isEdit}
            onChange={(e) => {
              setCodeTouched(true);
              setForm({ ...form, code: e.target.value.toUpperCase() });
            }}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            {isEdit
              ? 'Mã chi nhánh không thể thay đổi sau khi tạo.'
              : 'Gợi ý tự động từ địa chỉ. Có thể sửa trước khi tạo, sau đó sẽ cố định.'}
          </span>
          {codeError ? <span className="mt-1 block text-xs font-medium text-red-600">{codeError}</span> : null}
        </label>

        <fieldset className="rounded-xl border border-slate-200 px-3 py-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ăn sáng</legend>
          <div className="flex gap-4 py-1 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="breakfast"
                checked={form.breakfastIncluded}
                onChange={() => setForm({ ...form, breakfastIncluded: true })}
              />
              Có ăn sáng
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="breakfast"
                checked={!form.breakfastIncluded}
                onChange={() => setForm({ ...form, breakfastIncluded: false })}
              />
              Không ăn sáng
            </label>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Đang hoạt động
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-600">
            Số điện thoại (tuỳ chọn)
            <input className={`${inputClass} mt-1`} value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            Email (tuỳ chọn)
            <input className={`${inputClass} mt-1`} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            Người phụ trách (tuỳ chọn)
            <input className={`${inputClass} mt-1`} value={form.contactName ?? ''} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            Ghi chú nội bộ (tuỳ chọn)
            <input className={`${inputClass} mt-1`} value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </div>

        {!isEdit ? (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tên khách sạn trên nền tảng</p>
            <p className="mt-1 text-xs text-slate-500">
              Booking.com có thể đối chiếu gần đúng (tên bị cắt ngắn). Agoda chỉ đối chiếu chính xác tuyệt đối.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {pendingAliases.map((a, i) => (
                <li key={`${a.source}-${a.alias}`} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-slate-500">{ALIAS_SOURCE_LABEL[a.source]}:</span> {a.alias}
                  </span>
                  <button
                    type="button"
                    aria-label={`Xóa tên ${a.alias}`}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    onClick={() => setPendingAliases((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="new-alias-source">Nguồn</label>
              <select
                id="new-alias-source"
                className={`${inputClass} w-auto`}
                value={draftAlias.source}
                onChange={(e) => setDraftAlias({ ...draftAlias, source: e.target.value as AliasSource })}
              >
                <option value="BOOKING_COM">Booking.com</option>
                <option value="AGODA">Agoda</option>
              </select>
              <label className="sr-only" htmlFor="new-alias-name">Tên khách sạn</label>
              <input
                id="new-alias-name"
                className={`${inputClass} flex-1`}
                placeholder="Tên khách sạn trên nền tảng"
                value={draftAlias.alias}
                onChange={(e) => setDraftAlias({ ...draftAlias, alias: e.target.value })}
              />
              <Button variant="secondary" onClick={addDraftAlias}>Thêm tên</Button>
            </div>
          </div>
        ) : null}

        {!isEdit && form.branchNumber > 0 && form.address.trim().length > 0 ? (
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-sm" aria-live="polite">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              Xem trước
            </p>
            <p className="mt-1 font-medium text-slate-800">Chi nhánh {form.branchNumber}</p>
            <p className="text-slate-700">{form.address}</p>
            <p className="font-mono text-xs text-slate-500">{form.code.trim().toUpperCase()}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Platform names                                                      */
/* ------------------------------------------------------------------ */

function AliasModal({
  branch,
  onClose,
  onChanged,
}: {
  branch: AdminBranch | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<NewAliasInput>({ source: 'BOOKING_COM', alias: '' });
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);

  const add = useMutation({
    mutationFn: () => adminBranchesApi.addAlias(branch!.id, { ...draft, alias: draft.alias.trim() }),
    onSuccess: async () => {
      setDraft({ source: draft.source, alias: '' });
      await onChanged();
    },
  });
  const patch = useMutation({
    mutationFn: (vars: { aliasId: number; body: { alias?: string; active?: boolean } }) =>
      adminBranchesApi.updateAlias(branch!.id, vars.aliasId, vars.body),
    onSuccess: async () => {
      setRenaming(null);
      await onChanged();
    },
  });

  if (!branch) return null;

  return (
    <Modal open title={`Tên trên nền tảng — ${branch.address}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      {add.isError ? <div className="mb-3"><ErrorAlert>{toUserMessage(add.error)}</ErrorAlert></div> : null}
      {patch.isError ? <div className="mb-3"><ErrorAlert>{toUserMessage(patch.error)}</ErrorAlert></div> : null}

      <p className="text-xs text-slate-500">
        Đổi tên khách sạn trên nền tảng không làm đổi địa chỉ chi nhánh và không ảnh hưởng đơn đã lưu.
        Tên cũ vẫn tiếp tục nhận đơn cho tới khi bạn tắt thủ công.
      </p>

      <ul className="mt-3 space-y-2">
        {branch.aliases.map((a) => (
          <li key={a.id} className="rounded-xl border border-slate-200 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {ALIAS_SOURCE_LABEL[a.source]} · {a.matchMode === 'EXACT' ? 'Chính xác' : 'Gần đúng'}
                </p>
                {renaming?.id === a.id ? (
                  <input
                    className={`${inputClass} mt-1`}
                    aria-label={`Đổi tên ${a.alias}`}
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: a.id, value: e.target.value })}
                  />
                ) : (
                  <p className={`text-sm ${a.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{a.alias}</p>
                )}
              </div>
              <div className="flex gap-2">
                {renaming?.id === a.id ? (
                  <>
                    <Button variant="secondary" onClick={() => setRenaming(null)}>Huỷ</Button>
                    <Button
                      onClick={() => patch.mutate({ aliasId: a.id, body: { alias: renaming.value.trim() } })}
                      loading={patch.isPending}
                    >
                      Lưu tên
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => setRenaming({ id: a.id, value: a.alias })}>
                      Đổi tên
                    </Button>
                    <Button
                      variant={a.active ? 'danger' : 'primary'}
                      onClick={() => patch.mutate({ aliasId: a.id, body: { active: !a.active } })}
                    >
                      {a.active ? 'Tắt' : 'Bật lại'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
        {branch.aliases.length === 0 ? (
          <li className="py-4 text-center text-sm text-slate-400">Chi nhánh chưa có tên nền tảng nào.</li>
        ) : null}
      </ul>

      <div className="mt-4 rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thêm tên khách sạn</p>
        <p className="mt-1 text-xs text-slate-500">Agoda chỉ đối chiếu chính xác tuyệt đối.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="alias-source">Nguồn</label>
          <select
            id="alias-source"
            className={`${inputClass} w-auto`}
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value as AliasSource })}
          >
            <option value="BOOKING_COM">Booking.com</option>
            <option value="AGODA">Agoda</option>
          </select>
          <label className="sr-only" htmlFor="alias-name">Tên khách sạn</label>
          <input
            id="alias-name"
            className={`${inputClass} flex-1`}
            placeholder="Tên khách sạn trên nền tảng"
            value={draft.alias}
            onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
          />
          <Button onClick={() => add.mutate()} disabled={draft.alias.trim().length === 0} loading={add.isPending}>
            Thêm
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Activate / deactivate                                               */
/* ------------------------------------------------------------------ */

function ActivationModal({
  branch,
  onClose,
  onDone,
}: {
  branch: AdminBranch | null;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const deactivating = branch?.active === true;

  const receptionists = useQuery({
    queryKey: ['admin-branch-receptionists', branch?.id],
    queryFn: () => adminBranchesApi.receptionists(branch!.id),
    enabled: branch !== null && deactivating,
  });

  const run = useMutation({
    mutationFn: () => (deactivating ? adminBranchesApi.deactivate(branch!.id) : adminBranchesApi.activate(branch!.id)),
    onSuccess: () =>
      void onDone(deactivating ? 'Đã vô hiệu hóa chi nhánh.' : 'Đã kích hoạt lại chi nhánh.'),
  });

  if (!branch) return null;
  const assigned = receptionists.data?.receptionists ?? [];

  return (
    <Modal
      open
      title={deactivating ? 'Vô hiệu hóa chi nhánh' : 'Kích hoạt lại chi nhánh'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button variant={deactivating ? 'danger' : 'primary'} onClick={() => run.mutate()} loading={run.isPending}>
            {deactivating ? 'Vô hiệu hóa' : 'Kích hoạt lại'}
          </Button>
        </>
      }
    >
      {run.isError ? <div className="mb-3"><ErrorAlert>{toUserMessage(run.error)}</ErrorAlert></div> : null}

      <p className="text-sm text-slate-600">
        Chi nhánh {branch.branchNumber} — {branch.address}
      </p>

      {deactivating ? (
        <>
          <p className="mt-2 text-sm text-slate-600">
            Chi nhánh sẽ ngừng nhận đơn tự động và không thể chọn cho lễ tân mới. Dữ liệu cũ vẫn được giữ nguyên và Admin vẫn xem được.
          </p>
          {assigned.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
              <p className="font-medium">
                Có {assigned.length} tài khoản lễ tân đang thuộc chi nhánh này.
              </p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {assigned.map((u) => (
                  <li key={u.id}>{u.fullName} ({u.username})</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">
                Hệ thống sẽ không tự chuyển các tài khoản này. Sau khi vô hiệu hóa, hãy khoá tài khoản hoặc chuyển sang chi nhánh khác trong mục Quản lý tài khoản.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          Chi nhánh sẽ nhận lại đơn tự động theo các tên khách sạn đang bật.
        </p>
      )}
    </Modal>
  );
}
