import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { adminUsersApi, type CreateUserInput } from '../api/adminUsers';
import { branchesApi } from '../api/bookings';
import { branchLabel, type Branch } from '../auth/types';
import { toUserMessage } from '../api/errors';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ErrorAlert } from '../components/ErrorAlert';
import { Modal } from '../components/Modal';
import { PageHeader, QueryState } from '../components/PageState';
import { DevToolsPanel } from '../components/DevToolsPanel';
import { formatDateTime } from '../lib/format';

const inputClass =
  'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => adminUsersApi.list() });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => branchesApi.list(), staleTime: 5 * 60_000 });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      active ? adminUsersApi.disable(id) : adminUsersApi.enable(id),
    onSuccess: () => void invalidate(),
  });

  return (
    <div>
      <PageHeader
        title="Quản lý tài khoản"
        description="Tạo và quản lý tài khoản lễ tân cho từng chi nhánh."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Thêm lễ tân
          </Button>
        }
      />

      <QueryState isLoading={users.isLoading} isError={users.isError} error={users.error}>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Tài khoản</th>
                  <th className="px-4 py-3">Họ tên</th>
                  <th className="px-4 py-3">Chi nhánh</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Đăng nhập gần nhất</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {(users.data?.users ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 font-mono text-slate-800">{u.username}</td>
                    <td className="px-4 py-3 text-slate-800">{u.fullName}</td>
                    <td className="px-4 py-3 text-slate-600">{u.branch?.address ?? '—'}</td>
                    <td className="px-4 py-3">
                      {u.active ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Hoạt động</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Đã khoá</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Chưa đăng nhập'}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={u.active ? 'secondary' : 'primary'}
                        onClick={() => toggle.mutate({ id: u.id, active: u.active })}
                        loading={toggle.isPending && toggle.variables?.id === u.id}
                      >
                        {u.active ? 'Khoá' : 'Mở khoá'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {(users.data?.users.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                      Chưa có tài khoản lễ tân nào.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </QueryState>

      {/* Development-only demo data tools (hidden unless the server enables them). */}
      <DevToolsPanel />

      <CreateUserModal
        open={createOpen}
        branches={branches.data?.branches ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void invalidate();
        }}
      />
    </div>
  );
}

function CreateUserModal({
  open,
  branches,
  onClose,
  onCreated,
}: {
  open: boolean;
  branches: Branch[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const EMPTY: CreateUserInput = {
    username: '',
    fullName: '',
    temporaryPassword: '',
    role: 'RECEPTIONIST',
    branchId: 0,
  };
  const [form, setForm] = useState<CreateUserInput>(EMPTY);
  const isReceptionist = form.role !== 'BOOKING_DEPARTMENT';

  const create = useMutation({
    // Bộ phận đặt phòng is global, so no branch is sent at all — the server
    // refuses one, and sending 0 would be a validation error rather than "none".
    mutationFn: () =>
      adminUsersApi.create(
        isReceptionist ? form : { ...form, branchId: undefined },
      ),
    onSuccess: () => {
      setForm(EMPTY);
      onCreated();
    },
  });

  const valid =
    form.username.trim() &&
    form.fullName.trim() &&
    form.temporaryPassword.length >= 8 &&
    (!isReceptionist || (form.branchId ?? 0) > 0);

  return (
    <Modal
      open={open}
      title="Thêm tài khoản"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button onClick={() => create.mutate()} disabled={!valid} loading={create.isPending}>Tạo</Button>
        </>
      }
    >
      {create.isError ? <div className="mb-3"><ErrorAlert>{toUserMessage(create.error)}</ErrorAlert></div> : null}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-600">
          Tên đăng nhập
          <input className={`${inputClass} mt-1`} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          Họ tên
          <input className={`${inputClass} mt-1`} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          Mật khẩu tạm (tối thiểu 8 ký tự, có chữ và số)
          <input className={`${inputClass} mt-1`} value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-600">
          Vai trò
          <select
            aria-label="Vai trò"
            className={`${inputClass} mt-1`}
            value={form.role ?? 'RECEPTIONIST'}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value as CreateUserInput['role'], branchId: 0 })
            }
          >
            <option value="RECEPTIONIST">Lễ tân</option>
            <option value="BOOKING_DEPARTMENT">Bộ phận đặt phòng</option>
          </select>
        </label>
        {/*
          A branch belongs to a receptionist alone. Bộ phận đặt phòng works
          across every branch and picks one on each charge document, so offering
          the field would imply a scope the account does not have.
        */}
        {isReceptionist ? (
          <label className="block text-sm font-medium text-slate-600">
            Chi nhánh
            <select aria-label="Chi nhánh" className={`${inputClass} mt-1`} value={form.branchId || ''} onChange={(e) => setForm({ ...form, branchId: Number(e.target.value) })}>
              <option value="">— Chọn chi nhánh —</option>
              {branches.map((b) => (
                // Only ACTIVE branches reach here: /api/branches filters them out.
                <option key={b.id} value={b.id}>{branchLabel(b)}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Tài khoản bộ phận đặt phòng làm việc trên tất cả chi nhánh và chọn chi nhánh trong từng
            chứng từ.
          </p>
        )}
      </div>
    </Modal>
  );
}
