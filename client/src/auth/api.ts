import { api } from '../api/client';
import type {
  AuthUser,
  ChangePasswordInput,
  LoginInput,
  LoginResponse,
} from './types';

/** Thin typed wrappers around the Phase 2 backend auth endpoints. */
export const authApi = {
  me: () => api.get<{ user: AuthUser }>('/auth/me'),
  login: (input: LoginInput) => api.post<LoginResponse>('/auth/login', input),
  logout: () => api.post<{ success: boolean }>('/auth/logout'),
  changePassword: (input: ChangePasswordInput) =>
    api.post<{ success: boolean }>('/auth/change-password', input),
};
