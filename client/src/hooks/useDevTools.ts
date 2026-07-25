import { useQuery } from '@tanstack/react-query';
import { devTestApi } from '../api/devTest';

export const DEV_TOOLS_KEY = ['dev-tools', 'status'] as const;

/**
 * Reads the developer-tools status. Resolves to a disabled status when the server
 * has the tools off (the endpoint 404s), so no dev UI is ever shown by accident.
 */
export function useDevTools(enabled = true) {
  return useQuery({
    queryKey: DEV_TOOLS_KEY,
    queryFn: () => devTestApi.status(),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
}
