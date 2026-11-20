import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
const originalFetch = window.fetch;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  window.sessionStorage.clear(); window.history.replaceState(null, '', '/tags');
  window.fetch = mocks.fetch; mocks.fetch.mockResolvedValue(new Response('ok'));
  const auth = await import('@/lib/auth-token'); auth.setAuthToken('app-test'); auth.installAuthFetch();
});
afterEach(() => { window.fetch = originalFetch; window.sessionStorage.clear(); });
it.each(['/tags', '/api/tags/sort', '/api/tags/imports'])('uses only the existing login token for %s, without permission exchange', async path => {
  await window.fetch(path, { method: 'POST', headers: path === '/tags' ? { 'next-action': 'action-id' } : {}, body: '{}' });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  const headers = mocks.fetch.mock.calls[0][1].headers as Headers;
  expect(headers.get('x-auth-token')).toBe('app-test');
  expect(headers.has('x-tag-management-proof')).toBe(false);
});
it('never sends the application credential to external origins', async () => {
  await window.fetch('https://unrelated.example/api');
  expect(mocks.fetch.mock.calls[0][1]).toBeUndefined();
});
it('uses the current team credential after switching teams', async () => {
  const auth = await import('@/lib/auth-token'); auth.setAuthToken('new-team-test');
  await window.fetch('/api/tags/sort', { method: 'POST', body: '{}' });
  expect(mocks.fetch.mock.calls[0][1].headers.get('x-auth-token')).toBe('new-team-test');
});
