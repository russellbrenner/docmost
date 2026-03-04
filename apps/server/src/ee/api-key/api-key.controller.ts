import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { hasLicenseOrEE } from '../../common/helpers/utils';
import {
  CreateApiKeyDto,
  RevokeApiKeyDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  private checkLicense(workspace: Workspace) {
    if (
      !hasLicenseOrEE({
        licenseKey: workspace.licenseKey,
        plan: workspace.plan,
        isCloud: false,
      })
    ) {
      throw new ForbiddenException('Enterprise license required for API keys');
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post()
  async listApiKeys(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() pagination: PaginationOptions,
  ) {
    this.checkLicense(workspace);
    return this.apiKeyService.getApiKeys(workspace.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createApiKey(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: CreateApiKeyDto,
  ) {
    this.checkLicense(workspace);
    return this.apiKeyService.createApiKey({
      name: dto.name,
      creatorId: user.id,
      workspaceId: workspace.id,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateApiKey(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: UpdateApiKeyDto,
  ) {
    this.checkLicense(workspace);
    return this.apiKeyService.updateApiKey({
      apiKeyId: dto.apiKeyId,
      workspaceId: workspace.id,
      name: dto.name,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('revoke')
  async revokeApiKey(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: RevokeApiKeyDto,
  ) {
    this.checkLicense(workspace);
    await this.apiKeyService.revokeApiKey(dto.apiKeyId, workspace.id);
  }
}
