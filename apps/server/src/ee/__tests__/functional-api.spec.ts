/**
 * Functional API tests for the EE agent-provision and granular-edit modules.
 * Requires a running Docmost instance at TEST_DOCMOST_URL with EE license.
 *
 * Run with: TEST_DOCMOST_URL=https://test-wiki.itsa.house pnpm jest --testPathPatterns="ee/__tests__/functional" --no-cache
 *
 * These tests exercise the full HTTP stack, not mocked services.
 *
 * NOTE: All Docmost REST responses are wrapped by TransformHttpResponseInterceptor:
 *   { data: <payload>, success: true, status: <code> }
 * Access the actual payload via resp.data.data.
 */

const TEST_URL = process.env.TEST_DOCMOST_URL || 'https://test-wiki.itsa.house';

// We need an admin token to bootstrap. The initial setup creates one.
let adminToken: string;
let testSpaceId: string;
let testPageId: string;
let agentSlug: string;
let agentToken: string;

async function post(path: string, body: Record<string, unknown> = {}, token?: string) {
  const resp = await fetch(`${TEST_URL}/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(token ? { Cookie: `authToken=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  // Extract Set-Cookie authToken if present
  const setCookie = resp.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/authToken=([^;]+)/);
  const authToken = cookieMatch ? cookieMatch[1] : undefined;
  return { status: resp.status, data, ok: resp.ok, authToken };
}

async function setupWorkspace(): Promise<string> {
  // Try initial setup (creates workspace + admin user)
  const setupResp = await post('auth/setup', {
    name: 'Test Admin',
    email: 'admin@test.local',
    password: 'TestPassword123!',
    workspaceName: 'Test Workspace',
  });

  if (setupResp.ok && setupResp.authToken) {
    return setupResp.authToken;
  }

  // If setup already done, log in
  // Docmost returns JWT in Set-Cookie (HttpOnly), not in response body
  const loginResp = await post('auth/login', {
    email: 'admin@test.local',
    password: 'TestPassword123!',
  });

  if (loginResp.ok && loginResp.authToken) {
    return loginResp.authToken;
  }

  throw new Error(
    `Could not set up or log in. Setup: ${setupResp.status} (token: ${!!setupResp.authToken}), Login: ${loginResp.status} (token: ${!!loginResp.authToken})`,
  );
}

// Skip all tests if TEST_DOCMOST_URL is not reachable
beforeAll(async () => {
  try {
    const health = await fetch(`${TEST_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) {
      throw new Error(`Health check failed: ${health.status}`);
    }
  } catch (err) {
    console.warn(`Skipping functional tests: ${TEST_URL} not reachable. ${err}`);
    // This will cause all tests to be skipped
    return;
  }

  adminToken = await setupWorkspace();

  // Create a test space (or use the existing one)
  const spaceResp = await post('spaces/create', {
    name: 'Agent Test Space',
    slug: 'agenttestspace',
  }, adminToken);

  if (spaceResp.ok && spaceResp.data?.data?.id) {
    testSpaceId = spaceResp.data.data.id;
  } else {
    // Space might already exist, find it in the list
    const spacesResp = await post('spaces', {}, adminToken);
    if (spacesResp.ok) {
      const spaceList = spacesResp.data?.data?.data?.items
        || spacesResp.data?.data?.items
        || spacesResp.data?.data
        || (Array.isArray(spacesResp.data?.data) ? spacesResp.data.data : []);
      const existing = Array.isArray(spaceList) && spaceList.find?.((s: any) => s.slug === 'agenttestspace');
      if (existing) {
        testSpaceId = existing.id;
      }
    }
  }

  if (!testSpaceId) {
    throw new Error('Could not create or find test space');
  }
}, 30000);

describe('Agent Provisioning API', () => {
  it('should provision a new agent', async () => {
    if (!adminToken) return;

    const resp = await post('agents/provision', {
      name: 'Test Research Agent',
      email: 'test-research@agents.itsa.house',
      spaceIds: [testSpaceId],
    }, adminToken);

    expect(resp.ok).toBe(true);
    // All responses wrapped: { data: <payload>, success: true, status: N }
    expect(resp.data.data?.agent).toBeDefined();
    expect(resp.data.data.agent.slug).toBe('test-research-agent');
    expect(resp.data.data?.token).toBeDefined();
    expect(typeof resp.data.data.token).toBe('string');
    expect(resp.data.data.token.length).toBeGreaterThan(20);

    agentSlug = resp.data.data.agent.slug;
    agentToken = resp.data.data.token;
  });

  it('should reject duplicate agent slug', async () => {
    if (!adminToken) return;

    const resp = await post('agents/provision', {
      name: 'Test Research Agent',
      email: 'test-research-2@agents.itsa.house',
    }, adminToken);

    expect(resp.ok).toBe(false);
    // May return 400 (service validation) or 500 (DB unique constraint)
    expect([400, 500]).toContain(resp.status);
  });

  it('should list agents in registry', async () => {
    if (!adminToken) return;

    const resp = await post('agents/registry', {}, adminToken);

    expect(resp.ok).toBe(true);
    // Registry returns raw array, interceptor wraps: { data: [...], success: true }
    expect(resp.data.data).toBeDefined();
    expect(Array.isArray(resp.data.data)).toBe(true);
    expect(resp.data.data.length).toBeGreaterThanOrEqual(1);

    const agent = resp.data.data.find((a: any) => a.slug === agentSlug);
    expect(agent).toBeDefined();
    expect(agent.token).toBeDefined();
  });
});

describe('Agent Token Authentication', () => {
  it('should authenticate with agent token and create a page', async () => {
    if (!agentToken) return;

    const resp = await post('pages/create', {
      title: 'Agent Test Page',
      content: '# Introduction\n\nThis is the introduction paragraph with some test content.\n\n## Details\n\nSome detail text here about the topic.\n\n## Conclusion\n\nFinal thoughts on the testing topic.',
      format: 'markdown',
      spaceId: testSpaceId,
    }, agentToken);

    expect(resp.ok).toBe(true);
    expect(resp.data.data?.id).toBeDefined();
    expect(resp.data.data?.creatorId).toBeDefined();

    testPageId = resp.data.data.id;
  });

  it('should show agent as page creator', async () => {
    if (!testPageId || !adminToken) return;

    const resp = await post('pages/info', {
      pageId: testPageId,
      format: 'markdown',
    }, adminToken);

    expect(resp.ok).toBe(true);
    // The creator should be the agent user, not the admin
    expect(resp.data.data?.creator?.email).toBe('test-research@agents.itsa.house');
  });
});

describe('Granular Editing API', () => {
  it('should find and replace text', async () => {
    if (!testPageId || !agentToken) return;

    const resp = await post('pages/granular-update', {
      pageId: testPageId,
      operation: 'find_replace',
      findText: 'introduction paragraph',
      replaceText: 'opening section',
      matchCase: false,
      occurrence: 1,
    }, agentToken);

    expect(resp.ok).toBe(true);
    expect(resp.data.data?.operation).toBe('find_replace');
    expect(resp.data.data?.matchCount).toBe(1);
    expect(resp.data.data?.replacedCount).toBe(1);

    // Verify the change
    const page = await post('pages/info', { pageId: testPageId, format: 'markdown' }, agentToken);
    expect(page.ok).toBe(true);
    expect(page.data.data?.content).toContain('opening section');
    expect(page.data.data?.content).not.toContain('introduction paragraph');
  });

  it('should return 404 when find text not found', async () => {
    if (!testPageId || !agentToken) return;

    const resp = await post('pages/granular-update', {
      pageId: testPageId,
      operation: 'find_replace',
      findText: 'nonexistent text that does not appear anywhere',
      replaceText: 'replacement',
    }, agentToken);

    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(404);
  });

  it('should replace section content under a heading', async () => {
    if (!testPageId || !agentToken) return;

    const resp = await post('pages/granular-update', {
      pageId: testPageId,
      operation: 'replace_section',
      sectionIdentifier: 'Details',
      identifierType: 'text',
      content: 'This section has been completely rewritten by an agent.\n\nIt now contains two paragraphs.',
      format: 'markdown',
    }, agentToken);

    expect(resp.ok).toBe(true);
    expect(resp.data.data?.operation).toBe('replace_section');
    expect(resp.data.data?.success).toBe(true);

    // Verify the change
    const page = await post('pages/info', { pageId: testPageId, format: 'markdown' }, agentToken);
    expect(page.ok).toBe(true);
    expect(page.data.data?.content).toContain('completely rewritten by an agent');
    expect(page.data.data?.content).not.toContain('detail text here about');
    // Introduction and Conclusion should be untouched
    expect(page.data.data?.content).toContain('Introduction');
    expect(page.data.data?.content).toContain('Conclusion');
  });

  it('should return 404 when section heading not found', async () => {
    if (!testPageId || !agentToken) return;

    const resp = await post('pages/granular-update', {
      pageId: testPageId,
      operation: 'replace_section',
      sectionIdentifier: 'Nonexistent Heading',
      identifierType: 'text',
      content: 'New content',
      format: 'markdown',
    }, agentToken);

    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(404);
  });

  it('should insert content after a heading', async () => {
    if (!testPageId || !agentToken) return;

    const resp = await post('pages/granular-update', {
      pageId: testPageId,
      operation: 'insert_after',
      sectionIdentifier: 'Conclusion',
      identifierType: 'text',
      content: 'This paragraph was inserted by an agent after the Conclusion heading.',
      format: 'markdown',
    }, agentToken);

    expect(resp.ok).toBe(true);
    expect(resp.data.data?.operation).toBe('insert_after');
    expect(resp.data.data?.success).toBe(true);

    // Verify the change
    const page = await post('pages/info', { pageId: testPageId, format: 'markdown' }, agentToken);
    expect(page.ok).toBe(true);
    expect(page.data.data?.content).toContain('inserted by an agent after the Conclusion');
  });

  it('should show agent in contributor list after edits', async () => {
    if (!testPageId || !adminToken) return;

    const resp = await post('pages/info', { pageId: testPageId }, adminToken);
    expect(resp.ok).toBe(true);
    expect(resp.data.data?.lastUpdatedBy?.email).toBe('test-research@agents.itsa.house');
  });
});

describe('Agent Token Rotation', () => {
  it('should rotate agent token', async () => {
    if (!adminToken || !agentSlug) return;

    const resp = await post('agents/rotate-token', { slug: agentSlug }, adminToken);

    expect(resp.ok).toBe(true);
    expect(resp.data.data?.token).toBeDefined();
    expect(resp.data.data.token).not.toBe(agentToken);

    // Old token should no longer work
    const oldTokenResp = await post('pages/info', { pageId: testPageId }, agentToken);
    expect(oldTokenResp.ok).toBe(false);

    // New token should work
    const newToken = resp.data.data.token;
    const newTokenResp = await post('pages/info', { pageId: testPageId }, newToken);
    expect(newTokenResp.ok).toBe(true);

    agentToken = newToken;
  });
});

describe('Agent Revocation', () => {
  it('should revoke agent', async () => {
    if (!adminToken || !agentSlug) return;

    const resp = await post('agents/revoke', { slug: agentSlug }, adminToken);
    expect(resp.ok).toBe(true);

    // Revoked agent token should no longer work
    const authResp = await post('pages/info', { pageId: testPageId }, agentToken);
    expect(authResp.ok).toBe(false);
  });

  it('should no longer list revoked agent', async () => {
    if (!adminToken) return;

    const resp = await post('agents/registry', {}, adminToken);
    expect(resp.ok).toBe(true);

    const agent = (resp.data.data as any[])?.find((a: any) => a.slug === agentSlug);
    expect(agent).toBeUndefined();
  });
});

// Cleanup
afterAll(async () => {
  if (!adminToken) return;

  // Delete test page
  if (testPageId) {
    await post('pages/delete', { pageId: testPageId, permanentlyDelete: true }, adminToken);
  }

  // Delete test space (if we created it)
  // Note: Docmost may not support space deletion via API, so this is best-effort
}, 10000);
