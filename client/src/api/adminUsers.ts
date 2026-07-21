import { api } from './client';
import type { Branch, UserRole } from '../auth/types';

export interface ManagedUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  branch: Branch | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  temporaryPassword: string;
  branchId: number;
}

export const adminUsersApi = {
  list: () => api.get<{ users: ManagedUser[] }>('/admin/users'),
  create: (input: CreateUserInput) => api.post<{ user: ManagedUser }>('/admin/users', input),
  enable: (id: number) => api.post<{ user: ManagedUser }>(`/admin/users/${id}/enable`),
  disable: (id: number) => api.post<{ user: ManagedUser }>(`/admin/users/${id}/disable`),
  resetPassword: (id: number, temporaryPassword: string) =>
    api.post<{ success: true }>(`/admin/users/${id}/reset-password`, { temporaryPassword }),
};
