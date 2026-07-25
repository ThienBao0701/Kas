import { api } from './client';
import type { Branch } from '../auth/types';

/**
 * Developer test tools (DEVELOPMENT ONLY). Every endpoint 404s when the tools are
 * disabled on the server; the client treats that as "not enabled" and shows no UI.
 */
export interface DevToolsStatus {
  enabled: boolean;
  testUsername: string;
  isTestReceptionist: boolean;
  activeTestBranchId: number | null;
}

export interface GenerateParams {
  bookingsPerBranch: number;
  issuesPerBranch: number;
  includeProofs: boolean;
  includeOcr: boolean;
  includeComparisons: boolean;
  seed: number;
}

export interface GenerateSummary {
  batchId: string;
  branches: number;
  bookingsCreated: number;
  issuesCreated: number;
  proofsCreated: number;
  analysesCreated: number;
  comparisonsCreated: number;
  notificationsCreated: number;
  perBranch: { branchId: number; address: string; bookings: number; issues: number }[];
}

export interface ClearSummary {
  batchesDeleted: number;
  bookingsDeleted: number;
  issuesDeleted: number;
  notificationsDeleted: number;
  proofFilesDeleted: number;
  issuePhotosDeleted: number;
}

const DISABLED: DevToolsStatus = { enabled: false, testUsername: 'reception_test', isTestReceptionist: false, activeTestBranchId: null };

export const devTestApi = {
  /** Normalised status — resolves to a disabled status when the endpoint 404s. */
  status: async (): Promise<DevToolsStatus> => {
    try {
      return await api.get<DevToolsStatus>('/dev-test/status');
    } catch {
      return DISABLED;
    }
  },
  ensureTestAccount: () => api.post<{ user: unknown }>('/dev-test/ensure-test-account', {}),
  setActiveBranch: (branchId: number) => api.post<{ activeTestBranchId: number; branch: Branch }>('/dev-test/active-branch', { branchId }),
  generate: (params: GenerateParams) => api.post<{ summary: GenerateSummary }>('/dev-test/demo/generate', params),
  clear: (confirmPhrase: string) => api.del<{ summary: ClearSummary }>('/dev-test/demo', { confirmPhrase }),
};
