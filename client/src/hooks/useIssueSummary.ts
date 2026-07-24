import { useQuery } from '@tanstack/react-query';
import { issuesApi } from '../api/issues';

/** Shared query key so the sidebar badge, dashboard card and Issues page all
 *  read one cached, polled unresolved-issue summary. */
export const ISSUE_SUMMARY_KEY = ['issues', 'summary'] as const;

const POLL_MS = 20_000;

/**
 * Polls the unresolved-issue summary (NEW + IN_PROGRESS) within the caller's
 * branch scope. The backend returns all branches for an Admin and only the
 * receptionist's own branch otherwise, so this never leaks other branches.
 */
export function useIssueSummary(enabled = true) {
  return useQuery({
    queryKey: ISSUE_SUMMARY_KEY,
    queryFn: () => issuesApi.summary(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}
