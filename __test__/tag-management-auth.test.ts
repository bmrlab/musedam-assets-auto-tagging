// @vitest-environment node
import { withTagManagementAuth } from '@/app/tags/tagManagementAuth';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/app/(auth)/withAuth', () => ({
  withAuth: (run: (ctx: unknown) => unknown) => run({ team: { id: 7, slug: 't/77' }, user: { id: 9, slug: 'u/99' } }),
}));
vi.mock('@/app/(auth)/lib', () => ({ checkUserPermission: mocks.access }));
vi.mock('@/app/tags/tagImportJobContext', () => ({ getTagImportJobContext: () => undefined }));
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockReset(); });
it.each(['admin', 'content'])('uses existing authenticated application management role %s without new credentials', async roleCode => {
  mocks.access.mockResolvedValue({ roleCode });
  const write = vi.fn(async () => ({ success: true as const, data: undefined }));
  expect(await withTagManagementAuth(write)).toMatchObject({ success: true });
  expect(write).toHaveBeenCalledOnce();
  expect(mocks.access).toHaveBeenCalledWith({ team: { id: 7, slug: 't/77' }, user: { id: 9, slug: 'u/99' } });
});
it('allows existing explicitly assigned application administrators', async () => {
  mocks.access.mockResolvedValue({ roleCode: null, accessRole: 'admin' });
  expect(await withTagManagementAuth(async () => ({ success: true, data: undefined }))).toMatchObject({ success: true });
});
it.each([{ roleCode: null }, { roleCode: null, accessRole: 'reviewer' }, { roleCode: 'viewer', canManageTags: true }])('denies read-only or forged browser claims: %j', async access => {
  mocks.access.mockResolvedValue(access);
  const write = vi.fn();
  expect(await withTagManagementAuth(write)).toMatchObject({ success: false, code: 'forbidden' });
  expect(write).not.toHaveBeenCalled();
});
it('checks once for nested saving but rechecks in the next request', async () => {
  mocks.access.mockResolvedValue({ roleCode: 'admin' });
  expect(await withTagManagementAuth(() => withTagManagementAuth(async () => ({ success: true, data: undefined })))).toMatchObject({ success: true });
  expect(mocks.access).toHaveBeenCalledOnce();
  mocks.access.mockRejectedValueOnce(new Error('Membership revoked'));
  expect(await withTagManagementAuth(async () => ({ success: true, data: undefined }))).toMatchObject({ success: false });
  expect(mocks.access).toHaveBeenCalledTimes(2);
});
