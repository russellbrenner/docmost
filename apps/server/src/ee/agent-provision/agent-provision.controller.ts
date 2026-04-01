import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgentProvisionService } from './agent-provision.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { hasLicenseOrEE } from '../../common/helpers/utils';
import { UserRole } from '../../common/helpers/types/permission';
import { ProvisionAgentDto, AgentSlugDto } from './agent-provision.dto';

@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentProvisionController {
  constructor(
    private readonly agentProvisionService: AgentProvisionService,
  ) {}

  private checkLicense(workspace: Workspace) {
    if (
      !hasLicenseOrEE({
        licenseKey: workspace.licenseKey,
        plan: workspace.plan,
        isCloud: false,
      })
    ) {
      throw new ForbiddenException(
        'Enterprise licence required for agent provisioning',
      );
    }
  }

  private checkAdminRole(user: User) {
    if (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only workspace owners and admins can manage agents',
      );
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('provision')
  async provisionAgent(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: ProvisionAgentDto,
  ) {
    this.checkLicense(workspace);
    this.checkAdminRole(user);
    return this.agentProvisionService.provisionAgent(dto, workspace, user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('registry')
  async listAgents(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.checkLicense(workspace);
    this.checkAdminRole(user);
    const agents = await this.agentProvisionService.listAgents(workspace.id);
    return { data: agents };
  }

  @HttpCode(HttpStatus.OK)
  @Post('revoke')
  async revokeAgent(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: AgentSlugDto,
  ) {
    this.checkLicense(workspace);
    this.checkAdminRole(user);
    await this.agentProvisionService.revokeAgent(dto.slug, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rotate-token')
  async rotateToken(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: AgentSlugDto,
  ) {
    this.checkLicense(workspace);
    this.checkAdminRole(user);
    return this.agentProvisionService.rotateToken(dto.slug, workspace.id);
  }
}
