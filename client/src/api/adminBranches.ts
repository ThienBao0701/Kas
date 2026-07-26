import { api } from './client';

export type AliasSource = 'BOOKING_COM' | 'AGODA' | 'MANUAL' | 'OTHER';
export type AliasMatchMode = 'EXACT' | 'SIMILARITY';

export const ALIAS_SOURCE_LABEL: Record<AliasSource, string> = {
  BOOKING_COM: 'Booking.com',
  AGODA: 'Agoda',
  MANUAL: 'Nhập tay',
  OTHER: 'Nguồn khác',
};

export interface BranchAlias {
  id: number;
  source: AliasSource;
  alias: string;
  normalizedAlias: string;
  matchMode: AliasMatchMode;
  active: boolean;
  priority: number;
}

export interface AdminBranch {
  id: number;
  branchNumber: number;
  code: string;
  hotelName: string;
  address: string;
  breakfastIncluded: boolean;
  active: boolean;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  note: string | null;
  aliases: BranchAlias[];
  receptionistCount: number;
  activeReceptionistCount: number;
  createdAt: string;
  updatedAt: string;
}

/** An alias typed into the add-branch form, before the branch exists. */
export interface NewAliasInput {
  source: AliasSource;
  alias: string;
  matchMode?: AliasMatchMode;
}

export interface CreateBranchInput {
  branchNumber: number;
  hotelName: string;
  address: string;
  code: string;
  breakfastIncluded: boolean;
  active: boolean;
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
  note?: string | null;
  aliases?: NewAliasInput[];
}

export type UpdateBranchInput = Partial<
  Pick<
    CreateBranchInput,
    'branchNumber' | 'hotelName' | 'address' | 'breakfastIncluded' | 'active' | 'phone' | 'email' | 'contactName' | 'note'
  >
>;

export interface AffectedReceptionist {
  id: number;
  username: string;
  fullName: string;
  active: boolean;
}

export interface BranchHistoryEntry {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: { id: number; fullName: string } | null;
  changedAt: string;
}

export const adminBranchesApi = {
  list: () => api.get<{ branches: AdminBranch[] }>('/admin/branches'),
  get: (id: number) => api.get<{ branch: AdminBranch }>(`/admin/branches/${id}`),
  suggestCode: (address: string) =>
    api.get<{ code: string }>(`/admin/branches/suggest-code?address=${encodeURIComponent(address)}`),
  create: (input: CreateBranchInput) => api.post<{ branch: AdminBranch }>('/admin/branches', input),
  update: (id: number, input: UpdateBranchInput) =>
    api.patch<{ branch: AdminBranch }>(`/admin/branches/${id}`, input),
  addAlias: (id: number, input: NewAliasInput) =>
    api.post<{ branch: AdminBranch }>(`/admin/branches/${id}/aliases`, input),
  updateAlias: (id: number, aliasId: number, input: Partial<BranchAlias>) =>
    api.patch<{ branch: AdminBranch }>(`/admin/branches/${id}/aliases/${aliasId}`, input),
  removeAlias: (id: number, aliasId: number) =>
    api.del<{ branch: AdminBranch }>(`/admin/branches/${id}/aliases/${aliasId}`),
  activate: (id: number) => api.post<{ branch: AdminBranch }>(`/admin/branches/${id}/activate`),
  deactivate: (id: number) =>
    api.post<{ branch: AdminBranch; affectedReceptionists: AffectedReceptionist[] }>(
      `/admin/branches/${id}/deactivate`,
    ),
  receptionists: (id: number) =>
    api.get<{ receptionists: AffectedReceptionist[] }>(`/admin/branches/${id}/receptionists`),
  history: (id: number) => api.get<{ history: BranchHistoryEntry[] }>(`/admin/branches/${id}/history`),
};
