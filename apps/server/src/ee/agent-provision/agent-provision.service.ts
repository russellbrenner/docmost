import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { Workspace } from '@docmost/db/types/entity.types';
import { ApiKeyService } from '../api-key/api-key.service';
import { WorkspaceService } from '../../core/workspace/services/workspace.service';
import { SpaceMemberService } from '../../core/space/services/space-member.service';
import { AgentRegistryRepo } from './agent-registry.repo';
import { ProvisionAgentDto } from './agent-provision.dto';
import { UserRole, SpaceRole } from '../../common/helpers/types/permission';

@Injectable()
export class AgentProvisionService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly userRepo: UserRepo,
    private readonly apiKeyService: ApiKeyService,
    private readonly workspaceService: WorkspaceService,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly agentRegistryRepo: AgentRegistryRepo,
  ) {}

  /**
   * Provision a new agent user with an API key and optional space memberships.
   */
  async provisionAgent(
    dto: ProvisionAgentDto,
    workspace: Workspace,
    callerUserId: string,
  ) {
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (!slug) {
      throw new BadRequestException(
        'Agent name must contain at least one alphanumeric character',
      );
    }

    const existing = await this.agentRegistryRepo.findBySlug(
      slug,
      workspace.id,
    );
    if (existing) {
      throw new BadRequestException(
        `An agent with slug "${slug}" already exists in this workspace`,
      );
    }

    // Check if a user with this email already exists in the workspace
    const existingUser = await this.userRepo.findByEmail(
      dto.email,
      workspace.id,
    );
    if (existingUser) {
      throw new BadRequestException(
        `A user with email "${dto.email}" already exists in this workspace`,
      );
    }

    const result = await executeTx(this.db, async (trx) => {
      // Create agent user with a random password (agents authenticate via API key, never password)
      // UserRepo.insertUser unconditionally hashes the password field, so we must provide one
      const newUser = await this.userRepo.insertUser(
        {
          name: dto.name,
          email: dto.email,
          password: randomBytes(32).toString('hex'),
          role: dto.role === 'admin' ? UserRole.ADMIN : UserRole.MEMBER,
          emailVerifiedAt: new Date(),
          workspaceId: workspace.id,
        },
        trx,
      );

      // Add user to workspace with appropriate role
      await this.workspaceService.addUserToWorkspace(
        newUser.id,
        workspace.id,
        undefined,
        trx,
      );

      // Add to default group
      await this.groupUserRepo.addUserToDefaultGroup(
        newUser.id,
        workspace.id,
        trx,
      );

      // Create API key (100-year token when no expiresAt)
      const { apiKey, token } = await this.apiKeyService.createApiKey({
        name: `Agent: ${dto.name}`,
        creatorId: newUser.id,
        workspaceId: workspace.id,
      });

      // Register in agent_registry
      const agentRecord = await this.agentRegistryRepo.insert(
        {
          name: dto.name,
          slug,
          userId: newUser.id,
          apiKeyId: apiKey.id,
          token,
          workspaceId: workspace.id,
        },
        trx,
      );

      // Optionally add to specified spaces
      if (dto.spaceIds?.length) {
        for (const spaceId of dto.spaceIds) {
          await this.spaceMemberService.addUserToSpace(
            newUser.id,
            spaceId,
            SpaceRole.WRITER,
            workspace.id,
            trx,
          );
        }
      }

      return {
        agent: {
          id: agentRecord.id,
          name: agentRecord.name,
          slug: agentRecord.slug,
          email: newUser.email,
          userId: newUser.id,
        },
        token,
      };
    });

    return result;
  }

  /**
   * List all active agents in the workspace with their last-used timestamps.
   */
  async listAgents(workspaceId: string) {
    return this.agentRegistryRepo.findAll(workspaceId);
  }

  /**
   * Revoke an agent by slug: revokes its API key, deactivates the user,
   * and soft-deletes the registry entry.
   */
  async revokeAgent(slug: string, workspaceId: string) {
    const agent = await this.agentRegistryRepo.findBySlug(slug, workspaceId);
    if (!agent) {
      throw new NotFoundException(`Agent with slug "${slug}" not found`);
    }

    // Revoke the API key (soft-deletes it)
    await this.apiKeyService.revokeApiKey(agent.apiKeyId, workspaceId);

    // Deactivate the agent user
    await this.userRepo.updateUser(
      { deactivatedAt: new Date() },
      agent.userId,
      workspaceId,
    );

    // Soft-delete the registry entry
    await this.agentRegistryRepo.softDelete(slug, workspaceId);
  }

  /**
   * Rotate an agent's API token: revokes the old key, creates a new one,
   * and updates the registry.
   */
  async rotateToken(slug: string, workspaceId: string) {
    const agent = await this.agentRegistryRepo.findBySlug(slug, workspaceId);
    if (!agent) {
      throw new NotFoundException(`Agent with slug "${slug}" not found`);
    }

    // Revoke old API key
    await this.apiKeyService.revokeApiKey(agent.apiKeyId, workspaceId);

    // Create new API key for the agent's user
    const { apiKey: newApiKey, token: newToken } =
      await this.apiKeyService.createApiKey({
        name: `Agent: ${agent.name}`,
        creatorId: agent.userId,
        workspaceId,
      });

    // Update registry with new token and key ID
    await this.agentRegistryRepo.updateToken(
      slug,
      workspaceId,
      newToken,
      newApiKey.id,
    );

    return {
      slug: agent.slug,
      name: agent.name,
      token: newToken,
    };
  }
}
