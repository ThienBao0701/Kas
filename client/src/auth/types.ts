export type UserRole = 'ADMIN' | 'RECEPTIONIST';

export interface Branch {
  id: number;
  code: string;
  hotelName: string;
  address: string;
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
