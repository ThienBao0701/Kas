export type UserRole = 'ADMIN' | 'RECEPTIONIST';

export interface Branch {
  id: number;
  code: string;
  hotelName: string;
  address: string;
  /**
   * The operator-facing "Chi nhánh N" label, added in Milestone C.3.7. Optional
   * because older cached payloads (and fixtures) may predate it — never use it
   * for identity or authorization, which always key off `id` / `code`.
   */
  branchNumber?: number;
  breakfastIncluded?: boolean;
}

/** "Chi nhánh 2 — 260 Lý Tự Trọng", falling back to the address alone. */
export function branchLabel(branch: Pick<Branch, 'address' | 'branchNumber'>): string {
  return branch.branchNumber ? `Chi nhánh ${branch.branchNumber} — ${branch.address}` : branch.address;
}

/** The safe authenticated user as returned by GET /api/auth/me. */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  branch: Branch | null;
  active: boolean;
  mustChangePassword: boolean;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  mustChangePassword: boolean;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
