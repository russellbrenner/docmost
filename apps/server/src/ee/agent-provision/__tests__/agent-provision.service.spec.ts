import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole, SpaceRole } from '../../../common/helpers/types/permission';
import { Workspace } from '@docmost/db/types/entity.types';

/*
 * We test the AgentProvisionService in isolation by manually constructing it
 * with mocked dependencies. We must mock the transitive dependency chain that
 * uses 'src/' path prefix (which Jest cannot resolve without baseUrl config).
 */

// Block the transitive import chain: workspace.service → space.service → 'src/...'
jest.mock('../../../core/workspace/services/workspace.service', () => ({
  WorkspaceService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../core/space/services/space-member.service', () => ({
  SpaceMemberService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../api-key/api-key.service', () => ({
  ApiKeyService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../agent-registry.repo', () => ({
  AgentRegistryRepo: jest.fn().mockImplementation(() => ({})),
}));

// Mock executeTx to run the callback synchronously with a fake transaction
const mockExecuteTx = jest.fn(
  (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
    callback({} as unknown),
);
jest.mock('@docmost/db/utils', () => ({
  executeTx: (db: unknown, cb: (trx: unknown) => Promise<unknown>) => mockExecuteTx(db, cb),
}));

// Dynamically require the service AFTER jest.mock calls take effect
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AgentProvisionService } = require('../agent-provision.service');

describe('AgentProvisionService', () => {
  let service: InstanceType<typeof AgentProvisionService>;
  let mockUserRepo: Record<string, jest.Mock>;
  let mockApiKeyService: Record<string, jest.Mock>;
  let mockWorkspaceService: Record<string, jest.Mock>;
  let mockGroupUserRepo: Record<string, jest.Mock>;
  let mockSpaceMemberService: Record<string, jest.Mock>;
  let mockAgentRegistryRepo: Record<string, jest.Mock>;
  let mockDb: Record<string, unknown>;

  const workspaceId = 'workspace-001';
  const workspace = { id: workspaceId } as Workspace;
  const callerUserId = 'caller-user-001';

  beforeEach(() => {
    mockUserRepo = {
      insertUser: jest.fn(),
      findByEmail: jest.fn(),
      updateUser: jest.fn(),
    };

    mockApiKeyService = {
      createApiKey: jest.fn(),
      revokeApiKey: jest.fn(),
    };

    mockWorkspaceService = {
      addUserToWorkspace: jest.fn(),
    };

    mockGroupUserRepo = {
      addUserToDefaultGroup: jest.fn(),
    };

    mockSpaceMemberService = {
      addUserToSpace: jest.fn(),
    };

    mockAgentRegistryRepo = {
      findBySlug: jest.fn(),
      findAll: jest.fn(),
      insert: jest.fn(),
      softDelete: jest.fn(),
      updateToken: jest.fn(),
    };

    mockDb = {};

    // Construct service directly with mocked dependencies
    service = new AgentProvisionService(
      mockDb,
      mockUserRepo,
      mockApiKeyService,
      mockWorkspaceService,
      mockGroupUserRepo,
      mockSpaceMemberService,
      mockAgentRegistryRepo,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('provisionAgent', () => {
    const baseDto = {
      name: 'My Test Agent',
      email: 'agent@agents.itsa.house',
    };

    const mockUser = {
      id: 'user-agent-001',
      name: 'My Test Agent',
      email: 'agent@agents.itsa.house',
      role: UserRole.MEMBER,
    };

    const mockApiKeyResult = {
      apiKey: { id: 'apikey-001' },
      token: 'tok_abc123',
    };

    const mockAgentRecord = {
      id: 'agent-reg-001',
      name: 'My Test Agent',
      slug: 'my-test-agent',
      userId: 'user-agent-001',
      apiKeyId: 'apikey-001',
      workspaceId,
    };

    beforeEach(() => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(undefined);
      mockUserRepo.findByEmail.mockResolvedValue(undefined);
      mockUserRepo.insertUser.mockResolvedValue(mockUser);
      mockApiKeyService.createApiKey.mockResolvedValue(mockApiKeyResult);
      mockAgentRegistryRepo.insert.mockResolvedValue(mockAgentRecord);
      mockWorkspaceService.addUserToWorkspace.mockResolvedValue(undefined);
      mockGroupUserRepo.addUserToDefaultGroup.mockResolvedValue(undefined);
    });

    it('should create user, API key, and registry entry', async () => {
      const result = await service.provisionAgent(baseDto, workspace, callerUserId);

      expect(result).toEqual({
        agent: {
          id: mockAgentRecord.id,
          name: mockAgentRecord.name,
          slug: mockAgentRecord.slug,
          email: mockUser.email,
          userId: mockUser.id,
        },
        token: mockApiKeyResult.token,
      });

      expect(mockUserRepo.insertUser).toHaveBeenCalledWith(
        expect.objectContaining({
          name: baseDto.name,
          email: baseDto.email,
          role: UserRole.MEMBER,
          workspaceId,
        }),
        expect.anything(),
      );

      expect(mockWorkspaceService.addUserToWorkspace).toHaveBeenCalledWith(
        mockUser.id,
        workspaceId,
        undefined,
        expect.anything(),
      );

      expect(mockGroupUserRepo.addUserToDefaultGroup).toHaveBeenCalledWith(
        mockUser.id,
        workspaceId,
        expect.anything(),
      );

      expect(mockApiKeyService.createApiKey).toHaveBeenCalledWith({
        name: `Agent: ${baseDto.name}`,
        creatorId: mockUser.id,
        workspaceId,
      });

      expect(mockAgentRegistryRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: baseDto.name,
          slug: 'my-test-agent',
          userId: mockUser.id,
          apiKeyId: mockApiKeyResult.apiKey.id,
          token: mockApiKeyResult.token,
          workspaceId,
        }),
        expect.anything(),
      );
    });

    it('should set admin role when dto.role is admin', async () => {
      const dto = { ...baseDto, role: 'admin' };

      await service.provisionAgent(dto, workspace, callerUserId);

      expect(mockUserRepo.insertUser).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
        expect.anything(),
      );
    });

    it('should generate correct slug from name', async () => {
      const dto = { ...baseDto, name: 'Claude Agent v2' };

      await service.provisionAgent(dto, workspace, callerUserId);

      expect(mockAgentRegistryRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'claude-agent-v2' }),
        expect.anything(),
      );
    });

    it('should strip leading and trailing hyphens from slug', async () => {
      const dto = { ...baseDto, name: '---Special Agent---' };

      await service.provisionAgent(dto, workspace, callerUserId);

      expect(mockAgentRegistryRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'special-agent' }),
        expect.anything(),
      );
    });

    it('should throw if agent slug already exists', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(mockAgentRecord);

      await expect(
        service.provisionAgent(baseDto, workspace, callerUserId),
      ).rejects.toThrow(BadRequestException);

      expect(mockUserRepo.insertUser).not.toHaveBeenCalled();
    });

    it('should throw if email already exists in workspace', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.provisionAgent(baseDto, workspace, callerUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if name has no alphanumeric characters', async () => {
      const dto = { ...baseDto, name: '---' };

      await expect(
        service.provisionAgent(dto, workspace, callerUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should add user to specified spaces', async () => {
      const dto = { ...baseDto, spaceIds: ['space-001', 'space-002'] };

      await service.provisionAgent(dto, workspace, callerUserId);

      expect(mockSpaceMemberService.addUserToSpace).toHaveBeenCalledTimes(2);
      expect(mockSpaceMemberService.addUserToSpace).toHaveBeenCalledWith(
        mockUser.id,
        'space-001',
        SpaceRole.WRITER,
        workspaceId,
        expect.anything(),
      );
    });

    it('should not add user to spaces when spaceIds absent', async () => {
      await service.provisionAgent(baseDto, workspace, callerUserId);

      expect(mockSpaceMemberService.addUserToSpace).not.toHaveBeenCalled();
    });

    it('should create user with no password and verified email', async () => {
      await service.provisionAgent(baseDto, workspace, callerUserId);

      const insertCall = mockUserRepo.insertUser.mock.calls[0][0];
      expect(insertCall).not.toHaveProperty('password');
      expect(insertCall.emailVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('listAgents', () => {
    it('should return all active agents', async () => {
      const agents = [
        { id: 'a1', name: 'Agent One', slug: 'agent-one' },
        { id: 'a2', name: 'Agent Two', slug: 'agent-two' },
      ];
      mockAgentRegistryRepo.findAll.mockResolvedValue(agents);

      const result = await service.listAgents(workspaceId);

      expect(result).toEqual(agents);
      expect(mockAgentRegistryRepo.findAll).toHaveBeenCalledWith(workspaceId);
    });

    it('should return empty array when no agents exist', async () => {
      mockAgentRegistryRepo.findAll.mockResolvedValue([]);

      const result = await service.listAgents(workspaceId);

      expect(result).toEqual([]);
    });
  });

  describe('revokeAgent', () => {
    const slug = 'my-agent';
    const agentRecord = {
      slug,
      userId: 'user-001',
      apiKeyId: 'apikey-001',
    };

    it('should revoke key, deactivate user, and soft-delete entry', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(agentRecord);

      await service.revokeAgent(slug, workspaceId);

      expect(mockApiKeyService.revokeApiKey).toHaveBeenCalledWith(
        agentRecord.apiKeyId,
        workspaceId,
      );
      expect(mockUserRepo.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ deactivatedAt: expect.any(Date) }),
        agentRecord.userId,
        workspaceId,
      );
      expect(mockAgentRegistryRepo.softDelete).toHaveBeenCalledWith(slug, workspaceId);
    });

    it('should throw NotFoundException if agent not found', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(undefined);

      await expect(service.revokeAgent(slug, workspaceId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockApiKeyService.revokeApiKey).not.toHaveBeenCalled();
    });
  });

  describe('rotateToken', () => {
    const slug = 'my-agent';
    const agentRecord = {
      slug,
      name: 'My Agent',
      userId: 'user-001',
      apiKeyId: 'apikey-old',
    };

    it('should create new key, revoke old, and update registry', async () => {
      const newResult = { apiKey: { id: 'apikey-new' }, token: 'tok_new' };
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(agentRecord);
      mockApiKeyService.createApiKey.mockResolvedValue(newResult);

      const result = await service.rotateToken(slug, workspaceId);

      expect(result).toEqual({
        slug,
        name: agentRecord.name,
        token: newResult.token,
      });
      expect(mockApiKeyService.revokeApiKey).toHaveBeenCalledWith(
        'apikey-old',
        workspaceId,
      );
      expect(mockAgentRegistryRepo.updateToken).toHaveBeenCalledWith(
        slug,
        workspaceId,
        'tok_new',
        'apikey-new',
      );
    });

    it('should throw NotFoundException if agent not found', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(undefined);

      await expect(service.rotateToken(slug, workspaceId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
