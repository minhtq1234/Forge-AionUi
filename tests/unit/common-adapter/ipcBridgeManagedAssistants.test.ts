/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  ManagedAssistantAdminDetail,
  ManagedAssistantAdminSummary,
  ManagedAssistantDetail,
  ManagedAssistantDraftRequest,
  ManagedAssistantSummary,
} from '@/common/types/agent/managedAssistantTypes';
import { managedAssistantAdmin, managedAssistants } from '@/common/adapter/ipcBridge';

type HttpCall = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
};

const httpBridgeMocks = vi.hoisted(() => {
  const calls: HttpCall[] = [];
  const provider =
    (method: HttpCall['method']) =>
    <Data, Params = undefined>(path: string | ((params: Params) => string), mapBody?: (params: Params) => unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async (params?: Params) => {
        const resolvedPath = typeof path === 'function' ? path(params as Params) : path;
        calls.push({
          method,
          path: resolvedPath,
          body:
            method === 'POST' || method === 'PUT' || method === 'PATCH'
              ? params !== undefined
                ? mapBody
                  ? mapBody(params as Params)
                  : params
                : undefined
              : undefined,
        });
        return true as Data;
      }),
    });
  const emitter = () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() });

  return {
    calls,
    httpGet: provider('GET'),
    httpPost: provider('POST'),
    httpPut: provider('PUT'),
    httpPatch: provider('PATCH'),
    httpDelete: provider('DELETE'),
    httpRequest: vi.fn(),
    stubProvider: vi.fn((name: string, defaultValue: unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async () => defaultValue),
    })),
    withResponseMap: vi.fn(
      (
        inner: { provider: unknown; invoke: (params?: unknown) => Promise<unknown> },
        map: (raw: unknown) => unknown
      ) => ({
        provider: inner.provider,
        invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
      })
    ),
    wsEmitter: vi.fn(emitter),
    wsMappedEmitter: vi.fn(emitter),
    stubEmitter: vi.fn(emitter),
  };
});

vi.mock('@/common/adapter/httpBridge', () => httpBridgeMocks);

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      on: vi.fn(() => vi.fn()),
      emit: vi.fn(),
    })),
  },
}));

const draftRequest: ManagedAssistantDraftRequest = {
  name: 'managed-assistant',
  rules_content: 'rules',
  governance: {
    business_owner: 'owner',
    audience: {
      all_members: true,
      user_ids: [],
      summary: 'all members',
    },
  },
  employee_brief: {
    job_summary: 'summary',
    job_summary_i18n: {},
    trained_for: [],
    trained_for_i18n: {},
    inputs_required: [],
    inputs_required_i18n: {},
    data_access_summary: 'none',
    data_access_summary_i18n: {},
    boundaries: [],
    boundaries_i18n: {},
    human_review_requirements: [],
    human_review_requirements_i18n: {},
  },
  personalization_policy: {
    allowed_fields: [],
    optional_skill_ids: [],
    allowed_model_ids: [],
  },
};

describe('managed assistant IPC bridge clients', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
  });

  it('exposes the managed assistant response types', () => {
    expectTypeOf(managedAssistants.list.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantSummary[]>>();
    expectTypeOf(managedAssistants.get.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantDetail>>();
    expectTypeOf(managedAssistants.setAdoption.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantDetail>>();
    expectTypeOf(managedAssistants.updatePreferences.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantDetail>>();
    expectTypeOf(managedAssistants.resetPreferences.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantDetail>>();
    expectTypeOf(managedAssistants.acknowledge.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantDetail>>();
    expectTypeOf(managedAssistants.markNoticeSeen.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantDetail>>();
    expectTypeOf(managedAssistantAdmin.list.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantAdminSummary[]>>();
    expectTypeOf(managedAssistantAdmin.createDraft.invoke).returns.toEqualTypeOf<
      Promise<ManagedAssistantAdminDetail>
    >();
    expectTypeOf(managedAssistantAdmin.get.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantAdminDetail>>();
    expectTypeOf(managedAssistantAdmin.saveDraft.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantAdminDetail>>();
    expectTypeOf(managedAssistantAdmin.publish.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantAdminDetail>>();
    expectTypeOf(managedAssistantAdmin.retire.invoke).returns.toEqualTypeOf<Promise<ManagedAssistantAdminDetail>>();
  });

  it('lists employee managed assistants', async () => {
    await managedAssistants.list.invoke();

    expect(httpBridgeMocks.calls).toEqual([{ method: 'GET', path: '/api/managed-assistants', body: undefined }]);
  });

  it('gets an employee managed assistant with encoded id and locale', async () => {
    await managedAssistants.get.invoke({ id: 'finance/team', locale: 'en-US' });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'GET', path: '/api/managed-assistants/finance%2Fteam?locale=en-US', body: undefined },
    ]);
  });

  it('sets employee adoption without sending the path id in the body', async () => {
    await managedAssistants.setAdoption.invoke({ id: 'finance/team', active: true });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'PUT', path: '/api/managed-assistants/finance%2Fteam/adoption', body: { active: true } },
    ]);
  });

  it('updates employee preferences without sending the path id in the body', async () => {
    await managedAssistants.updatePreferences.invoke({ id: 'finance/team', nickname: 'Fin' });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'PUT', path: '/api/managed-assistants/finance%2Fteam/preferences', body: { nickname: 'Fin' } },
    ]);
  });

  it('resets employee preferences', async () => {
    await managedAssistants.resetPreferences.invoke({ id: 'finance/team' });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'DELETE', path: '/api/managed-assistants/finance%2Fteam/preferences', body: undefined },
    ]);
  });

  it('acknowledges an employee managed assistant version without sending the path id in the body', async () => {
    await managedAssistants.acknowledge.invoke({ id: 'finance/team', version: 4 });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'POST', path: '/api/managed-assistants/finance%2Fteam/acknowledgements', body: { version: 4 } },
    ]);
  });

  it('marks an employee managed assistant notice seen without sending the path id in the body', async () => {
    await managedAssistants.markNoticeSeen.invoke({ id: 'finance/team', version: 4 });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'POST', path: '/api/managed-assistants/finance%2Fteam/notices/seen', body: { version: 4 } },
    ]);
  });

  it('lists admin managed assistants with locale', async () => {
    await managedAssistantAdmin.list.invoke({ locale: 'vi-VN' });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'GET', path: '/api/admin/managed-assistants?locale=vi-VN', body: undefined },
    ]);
  });

  it('creates an admin managed assistant draft', async () => {
    await managedAssistantAdmin.createDraft.invoke(draftRequest);

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'POST', path: '/api/admin/managed-assistants', body: draftRequest },
    ]);
  });

  it('gets an admin managed assistant with encoded id and locale', async () => {
    await managedAssistantAdmin.get.invoke({ id: 'finance/team', locale: 'en-US' });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'GET', path: '/api/admin/managed-assistants/finance%2Fteam?locale=en-US', body: undefined },
    ]);
  });

  it('saves an admin managed assistant draft without sending the path id in the body', async () => {
    await managedAssistantAdmin.saveDraft.invoke({ id: 'finance/team', ...draftRequest });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'PUT', path: '/api/admin/managed-assistants/finance%2Fteam/draft', body: draftRequest },
    ]);
  });

  it('publishes an admin managed assistant without sending the path id in the body', async () => {
    await managedAssistantAdmin.publish.invoke({ id: 'finance/team', release_notes: 'release', draft_version: 4 });

    expect(httpBridgeMocks.calls).toEqual([
      {
        method: 'POST',
        path: '/api/admin/managed-assistants/finance%2Fteam/publish',
        body: { release_notes: 'release', draft_version: 4 },
      },
    ]);
  });

  it('retires an admin managed assistant without sending the path id in the body', async () => {
    await managedAssistantAdmin.retire.invoke({ id: 'finance/team', reason: 'replacement', cutoff_at: 123 });

    expect(httpBridgeMocks.calls).toEqual([
      {
        method: 'POST',
        path: '/api/admin/managed-assistants/finance%2Fteam/retire',
        body: { reason: 'replacement', cutoff_at: 123 },
      },
    ]);
  });
});
