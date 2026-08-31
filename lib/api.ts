'use client';
import { useQuery } from '@tanstack/react-query';
import type { PublicUser, SteamTag } from './types';
export class ApiFailure extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method =
    options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'x-fng-request': '1',
      ...(options.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiFailure(
      'The server returned an unreadable response. Please retry.',
      'invalid_response',
      response.status,
    );
  }
  if (!response.ok) {
    const failure =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    throw new ApiFailure(
      typeof failure.error === 'string'
        ? failure.error
        : 'This action could not be completed.',
      typeof failure.code === 'string' ? failure.code : 'request_failed',
      response.status,
    );
  }
  return data as T;
}
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) =>
      api<{
        user: PublicUser | null;
        site: {
          catalogMode: string;
          billingEnabled: boolean;
          turnstileSiteKey: string | null;
        };
      }>('me', { signal }),
    retry: false,
  });
}
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: ({ signal }) => api<{ tags: SteamTag[] }>('tags', { signal }),
    staleTime: 5 * 60_000,
  });
}
export function signInPath(returnTo = '/onboarding') {
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/onboarding')}`;
}
export function assetUrl(reference: string): string {
  return reference.startsWith('r2:')
    ? `/api/assets/${encodeURIComponent(reference.slice(3))}`
    : reference;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}
