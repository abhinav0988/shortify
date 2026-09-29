import { QueryClient, type QueryClient as QueryClientType } from "@tanstack/react-query";
import { ApiError } from "./api-client";

export function createQueryClient(): QueryClientType {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && (error.status === 0 || error.status === 503 || (error.status >= 400 && error.status < 500))) {
            return false;
          }
          return failureCount < 1;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export async function refreshLinkQueries(queryClient: QueryClientType, linkId?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["links"] }),
    linkId ? queryClient.invalidateQueries({ queryKey: ["link", linkId] }) : Promise.resolve(),
    linkId ? queryClient.invalidateQueries({ queryKey: ["analytics", linkId] }) : Promise.resolve(),
  ]);
}
