import { api } from './client';
import type { Branch } from '../auth/types';
import type { Actor, Pagination } from './bookings';

export type IssueCategory =
  | 'DOOR'
  | 'AIR_CONDITIONER'
  | 'TOILET'
  | 'TV'
  | 'WIFI'
  | 'ELECTRICITY'
  | 'WATER'
  | 'FURNITURE'
  | 'HOUSEKEEPING'
  | 'GUEST_REQUEST'
  | 'OTHER';

export type IssueStatus = 'NEW' | 'IN_PROGRESS' | 'RESOLVED';

/** Vietnamese labels (dropdown/display order). */
export const ISSUE_CATEGORIES: { value: IssueCategory; label: string }[] = [
  { value: 'DOOR', label: 'Cửa' },
  { value: 'AIR_CONDITIONER', label: 'Máy lạnh' },
  { value: 'TOILET', label: 'Nhà vệ sinh' },
  { value: 'TV', label: 'TV' },
  { value: 'WIFI', label: 'Wifi' },
  { value: 'ELECTRICITY', label: 'Điện' },
  { value: 'WATER', label: 'Nước' },
  { value: 'FURNITURE', label: 'Nội thất' },
  { value: 'HOUSEKEEPING', label: 'Buồng phòng' },
  { value: 'GUEST_REQUEST', label: 'Yêu cầu của khách' },
  { value: 'OTHER', label: 'Khác' },
];

export const ISSUE_CATEGORY_LABEL: Record<IssueCategory, string> = Object.fromEntries(
  ISSUE_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<IssueCategory, string>;

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  NEW: 'Mới',
  IN_PROGRESS: 'Đang xử lý',
  RESOLVED: 'Đã xử lý',
};

export interface Issue {
  id: string;
  branchId: number;
  branch: Branch | null;
  roomNumber: string | null;
  category: IssueCategory;
  description: string;
  photoUrl: string | null;
  status: IssueStatus;
  reportedBy: Actor | null;
  acceptedBy: Actor | null;
  resolvedBy: Actor | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface IssueListResponse {
  issues: Issue[];
  pagination: Pagination;
}

/** Unresolved (NEW + IN_PROGRESS) counters for one branch. */
export interface BranchIssueSummary {
  branchId: number;
  code: string;
  address: string;
  hotelName: string;
  newCount: number;
  inProgressCount: number;
  totalUnresolved: number;
}

/** Unresolved-issue summary within the caller's branch scope. */
export interface IssueSummary {
  totalUnresolved: number;
  newCount: number;
  inProgressCount: number;
  byBranch: BranchIssueSummary[];
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface NewIssueInput {
  category: IssueCategory;
  description: string;
  roomNumber?: string;
  photo?: File;
}

export const issuesApi = {
  list: (params: { branchId?: number; status?: IssueStatus; page?: number; pageSize?: number } = {}) =>
    api.get<IssueListResponse>(`/issues${query(params)}`),

  detail: (id: string) => api.get<{ issue: Issue }>(`/issues/${id}`),

  create: (input: NewIssueInput) => {
    const form = new FormData();
    form.append('category', input.category);
    form.append('description', input.description);
    if (input.roomNumber && input.roomNumber.trim().length > 0) form.append('roomNumber', input.roomNumber.trim());
    if (input.photo) form.append('image', input.photo);
    return api.postForm<{ issue: Issue }>('/issues', form);
  },

  accept: (id: string) => api.post<{ issue: Issue }>(`/issues/${id}/accept`, {}),
  resolve: (id: string) => api.post<{ issue: Issue }>(`/issues/${id}/resolve`, {}),

  summary: () => api.get<{ summary: IssueSummary }>('/issues/summary'),
};
