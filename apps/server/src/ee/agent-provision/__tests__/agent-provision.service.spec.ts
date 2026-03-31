import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentProvisionService } from '../agent-provision.service';
import { AgentRegistryRepo } from '../agent-registry.repo';
import { ApiKeyService } from '../../api-key/api-key.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { WorkspaceService } from '../../../core/workspace/services/workspace.service';
import { SpaceMemberService } from '../../../core/space/services/space-member.service';
import { UserRole, SpaceRole } from '../../../common/helpers/types/permission';
import { Workspace } from '@docmost/db/types/entity.types';

// Mock executeTx to run callback immediately with a fake transaction
jest.mock('@docmost/db/utils', () => ({
  executeTx: jest.fn((_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
    callback({} as unknown),
  ),
}));

describe('AgentProvisionService', () => {
  let service: AgentProvisionService;
  let mockUserRepo: jest.Mocked<Pick<UserRepo, 'insertUser' | 'findByEmail' | 'updateUser'>>;
  let mockApiKeyService: jest.Mocked<Pick<ApiKeyService, 'createApiKey' | 'revokeApiKey'>>;
  let mockWorkspaceService: jest.Mocked<Pick<WorkspaceService, 'addUserToWorkspace'>>;
  let mockGroupUserRepo: jest.Mocked<Pick<GroupUserRepo, 'addUserToDefaultGroup'>>;
  let mockSpaceMemberService: jest.Mocked<Pick<SpaceMemberService, 'addUserToSpace'>>;
  let mockAgentRegistryRepo: jest.Mocked<Pick<AgentRegistryRepo, 'findBySlug' | 'findAll' | 'insert' | 'softDelete' | 'updateToken'>>;

  const workspaceId = 'workspace-001';
  const workspace: Partial<Workspace> = { id: workspaceId } as Workspace;
  const callerUserId = 'caller-user-001';

  beforeEach(async () => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentProvisionService,
        { provide: UserRepo, useValue: mockUserRepo },
        { provide: ApiKeyService, useValue: mockApiKeyService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: GroupUserRepo, useValue: mockGroupUserRepo },
        { provide: SpaceMemberService, useValue: mockSpaceMemberService },
        { provide: AgentRegistryRepo, useValue: mockAgentRegistryRepo },
        { provide: 'KYSELY_MODULE_CONNECTION', useValue: {} },
      ],
    }).compile();

    service = module.get(AgentProvisionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('provisionAgent', () => {
    const baseDto = {
      name: 'My Test Agent',
      email: 'agent@test.com',
    };

    const mockUser = {
      id: 'user-agent-001',
      name: 'My Test Agent',
      email: 'agent@test.com',
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
      mockUserRepo.insertUser.mockResolvedValue(mockUser as any);
      mockApiKeyService.createApiKey.mockResolvedValue(mockApiKeyResult as any);
      mockAgentRegistryRepo.insert.mockResolvedValue(mockAgentRecord as any);
      mockWorkspaceService.addUserToWorkspace.mockResolvedValue(undefined);
      mockGroupUserRepo.addUserToDefaultGroup.mockResolvedValue(undefined);
    });

    it('should create user, API key, and registry entry', async () => {
      const result = await service.provisionAgent(baseDto, workspace as Workspace, callerUserId);

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
        expect.anything(), // transaction
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

      await service.provisionAgent(dto, workspace as Workspace, callerUserId);

      expect(mockUserRepo.insertUser).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
        expect.anything(),
      );
    });

    it('should generate correct slug from name (spaces to hyphens, lowercase)', async () => {
      const dto = { ...baseDto, name: 'Claude Agent v2' };

      await service.provisionAgent(dto, workspace as Workspace, callerUserId);

      expect(mockAgentRegistryRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'claude-agent-v2' }),
        expect.anything(),
      );
    });

    it('should strip leading and trailing hyphens from slug', async () => {
      const dto = { ...baseDto, name: '---Special Agent---' };

      await service.provisionAgent(dto, workspace as Workspace, callerUserId);

      expect(mockAgentRegistryRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'special-agent' }),
        expect.anything(),
      );
    });

    it('should throw BadRequestException if agent slug already exists', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(mockAgentRecord as any);

      await expect(
        service.provisionAgent(baseDto, workspace as Workspace, callerUserId),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.provisionAgent(baseDto, workspace as Workspace, callerUserId),
      ).rejects.toThrow(/already exists/);

      expect(mockUserRepo.insertUser).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if email already exists in workspace', async () => {
      mockUserRepo.findByEmail.mockResolvedValue(mockUser as any);

      await expect(
        service.provisionAgent(baseDto, workspace as Workspace, callerUserId),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.provisionAgent(baseDto, workspace as Workspace, callerUserId),
      ).rejects.toThrow(/already exists/);
    });

    it('should throw BadRequestException if name has no alphanumeric characters', async () => {
      const dto = { ...baseDto, name: '---' };

      await expect(
        service.provisionAgent(dto, workspace as Workspace, callerUserId),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.provisionAgent(dto, workspace as Workspace, callerUserId),
      ).rejects.toThrow(/alphanumeric/);
    });

    it('should add user to specified spaces when spaceIds provided', async () => {
      const spaceIds = ['space-001', 'space-002'];
      const dto = { ...baseDto, spaceIds };
      mockSpaceMemberService.addUserToSpace.mockResolvedValue(undefined);

      await service.provisionAgent(dto, workspace as Workspace, callerUserId);

      expect(mockSpaceMemberService.addUserToSpace).toHaveBeenCalledTimes(2);
      expect(mockSpaceMemberService.addUserToSpace).toHaveBeenCalledWith(
        mockUser.id,
        'space-001',
        SpaceRole.WRITER,
        workspaceId,
        expect.anything(),
      );
      expect(mockSpaceMemberService.addUserToSpace).toHaveBeenCalledWith(
        mockUser.id,
        'space-002',
        SpaceRole.WRITER,
        workspaceId,
        expect.anything(),
      );
    });

    it('should not add user to spaces when spaceIds is empty or absent', async () => {
      await service.provisionAgent(baseDto, workspace as Workspace, callerUserId);

      expect(mockSpaceMemberService.addUserToSpace).not.toHaveBeenCalled();
    });

    it('should create user with no password (emailVerifiedAt set)', async () => {
      await service.provisionAgent(baseDto, workspace as Workspace, callerUserId);

      const insertCall = mockUserRepo.insertUser.mock.calls[0][0];
      expect(insertCall).not.toHaveProperty('password');
      expect(insertCall.emailVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('listAgents', () => {
    it('should return all active agents from registry', async () => {
      const agents = [
        { id: 'a1', name: 'Agent One', slug: 'agent-one', lastUsedAt: new Date() },
        { id: 'a2', name: 'Agent Two', slug: 'agent-two', lastUsedAt: null },
      ];
      mockAgentRegistryRepo.findAll.mockResolvedValue(agents as any);

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
      id: 'agent-001',
      name: 'My Agent',
      slug,
      userId: 'user-001',
      apiKeyId: 'apikey-001',
      workspaceId,
    };

    it('should revoke API key, deactivate user, and soft-delete registry entry', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(agentRecord as any);
      mockApiKeyService.revokeApiKey.mockResolvedValue(undefined);
      mockUserRepo.updateUser.mockResolvedValue(undefined);
      mockAgentRegistryRepo.softDelete.mockResolvedValue(undefined);

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

      await expect(service.revokeAgent(slug, workspaceId)).rejects.toThrow(NotFoundException);

      expect(mockApiKeyService.revokeApiKey).not.toHaveBeenCalled();
      expect(mockUserRepo.updateUser).not.toHaveBeenCalled();
      expect(mockAgentRegistryRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('rotateToken', () => {
    const slug = 'my-agent';
    const agentRecord = {
      id: 'agent-001',
      name: 'My Agent',
      slug,
      userId: 'user-001',
      apiKeyId: 'apikey-old',
      workspaceId,
    };

    it('should create new API key, revoke old one, and update registry', async () => {
      const newApiKeyResult = {
        apiKey: { id: 'apikey-new' },
        token: 'tok_new456',
      };

      mockAgentRegistryRepo.findBySlug.mockResolvedValue(agentRecord as any);
      mockApiKeyService.revokeApiKey.mockResolvedValue(undefined);
      mockApiKeyService.createApiKey.mockResolvedValue(newApiKeyResult as any);
      mockAgentRegistryRepo.updateToken.mockResolvedValue(undefined);

      const result = await service.rotateToken(slug, workspaceId);

      expect(result).toEqual({
        slug: agentRecord.slug,
        name: agentRecord.name,
        token: newApiKeyResult.token,
      });

      // Old key revoked
      expect(mockApiKeyService.revokeApiKey).toHaveBeenCalledWith(
        agentRecord.apiKeyId,
        workspaceId,
      );

      // New key created for agent's user
      expect(mockApiKeyService.createApiKey).toHaveBeenCalledWith({
        name: `Agent: ${agentRecord.name}`,
        creatorId: agentRecord.userId,
        workspaceId,
      });

      // Registry updated with new token and key ID
      expect(mockAgentRegistryRepo.updateToken).toHaveBeenCalledWith(
        slug,
        workspaceId,
        newApiKeyResult.token,
        newApiKeyResult.apiKey.id,
      );
    });

    it('should throw NotFoundException if agent not found', async () => {
      mockAgentRegistryRepo.findBySlug.mockResolvedValue(undefined);

      await expect(service.rotateToken(slug, workspaceId)).rejects.toThrow(NotFoundException);

      expect(mockApiKeyService.revokeApiKey).not.toHaveBeenCalled();
      expect(mockApiKeyService.createApiKey).not.toHaveBeenCalled();
      expect(mockAgentRegistryRepo.updateToken).not.toHaveBeenCalled();
    });
  });
});
