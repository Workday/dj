import { describe, expect, it, jest } from '@jest/globals';
import {
  isLightdashProjectUuid,
  resolveLightdashProjectUuid,
} from '@services/lightdash/projectResolver';

const PROD_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PREVIEW_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const connection = {
  serverUrl: 'https://lightdash.example.com',
  apiKey: 'ldpat_secret',
};

function fakeFetch(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  return jest.fn(async (_url: unknown, _init?: unknown) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as jest.MockedFunction<typeof fetch> & {
    mock: { calls: unknown[][] };
  };
}

const orgProjects = {
  status: 'ok',
  results: [
    { projectUuid: PROD_UUID, slug: 'jaffle-prod', name: 'Jaffle prod' },
    { projectUuid: PREVIEW_UUID, slug: 'jaffle-dev', name: 'Jaffle dev' },
  ],
};

describe('isLightdashProjectUuid', () => {
  it('accepts canonical UUIDs in any case', () => {
    expect(isLightdashProjectUuid(PROD_UUID)).toBe(true);
    expect(isLightdashProjectUuid(PROD_UUID.toUpperCase())).toBe(true);
  });

  it('rejects slugs and malformed values', () => {
    expect(isLightdashProjectUuid('jaffle-prod')).toBe(false);
    expect(isLightdashProjectUuid('AAA-111')).toBe(false);
  });
});

describe('resolveLightdashProjectUuid', () => {
  it('returns UUIDs unchanged without touching the network', async () => {
    const fetchImpl = fakeFetch(orgProjects);
    const readConnection = jest.fn(() => connection);
    const result = await resolveLightdashProjectUuid(`  ${PROD_UUID}  `, {
      fetch: fetchImpl,
      readConnection,
    });
    expect(result).toEqual({ ok: true, uuid: PROD_UUID });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readConnection).not.toHaveBeenCalled();
  });

  it('rejects an empty value', async () => {
    const result = await resolveLightdashProjectUuid('   ', {
      fetch: fakeFetch(orgProjects),
      readConnection: () => connection,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringMatching(/project slug or uuid is required/i),
      }),
    );
  });

  it('resolves a slug to its project UUID using the organization project list', async () => {
    const fetchImpl = fakeFetch(orgProjects);
    const result = await resolveLightdashProjectUuid('jaffle-prod', {
      fetch: fetchImpl,
      readConnection: () => connection,
    });
    expect(result).toEqual({ ok: true, uuid: PROD_UUID });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lightdash.example.com/api/v1/org/projects');
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: 'ApiKey ldpat_secret' }),
    );
  });

  it('accepts a bare array of projects as well as the results envelope', async () => {
    const result = await resolveLightdashProjectUuid('jaffle-dev', {
      fetch: fakeFetch(orgProjects.results),
      readConnection: () => connection,
    });
    expect(result).toEqual({ ok: true, uuid: PREVIEW_UUID });
  });

  it('matches slugs exactly', async () => {
    const result = await resolveLightdashProjectUuid('Jaffle-Prod', {
      fetch: fakeFetch(orgProjects),
      readConnection: () => connection,
    });
    expect(result.error).toMatch(/no project found/i);
  });

  it('reports an unknown slug', async () => {
    const result = await resolveLightdashProjectUuid('missing', {
      fetch: fakeFetch(orgProjects),
      readConnection: () => connection,
    });
    expect(result).toEqual({
      ok: false,
      error: 'No project found with UUID or slug "missing".',
    });
  });

  it('refuses an ambiguous slug instead of picking one', async () => {
    const result = await resolveLightdashProjectUuid('jaffle-prod', {
      fetch: fakeFetch({
        results: [
          { projectUuid: PROD_UUID, slug: 'jaffle-prod' },
          { projectUuid: PREVIEW_UUID, slug: 'jaffle-prod' },
        ],
      }),
      readConnection: () => connection,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/more than one project/i);
  });

  it('reports missing credentials without calling the network', async () => {
    const fetchImpl = fakeFetch(orgProjects);
    const result = await resolveLightdashProjectUuid('jaffle-prod', {
      fetch: fetchImpl,
      readConnection: () => undefined,
    });
    expect(result.error).toMatch(/no lightdash credentials/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a non-OK HTTP response', async () => {
    const result = await resolveLightdashProjectUuid('jaffle-prod', {
      fetch: fakeFetch({}, { ok: false, status: 401 }),
      readConnection: () => connection,
    });
    expect(result.error).toMatch(/HTTP 401/);
  });

  it('reports a network failure', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await resolveLightdashProjectUuid('jaffle-prod', {
      fetch: fetchImpl,
      readConnection: () => connection,
    });
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('sends the proxy authorization header when configured', async () => {
    const fetchImpl = fakeFetch(orgProjects);
    await resolveLightdashProjectUuid('jaffle-prod', {
      fetch: fetchImpl,
      readConnection: () => ({
        ...connection,
        proxyAuthorization: 'Basic abc',
      }),
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ 'Proxy-Authorization': 'Basic abc' }),
    );
  });
});
