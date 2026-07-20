import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/errors';

/**
 * Shared React Query client. ApiErrors (auth/permission/validation) are never
 * retried; only transient failures (e.g. NetworkError) get a couple of retries.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
