import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  CreateWebhookDto,
  DeleteWebhookDto,
  UpdateWebhookDto,
} from './dto/webhook.dto';

@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createWebhook(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhookService.createWebhook({
      name: dto.name,
      url: dto.url,
      secret: dto.secret,
      events: dto.events,
      workspaceId: workspace.id,
      creatorId: user.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async listWebhooks(@AuthWorkspace() workspace: Workspace) {
    return this.webhookService.listWebhooks(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateWebhook(
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhookService.updateWebhook({
      webhookId: dto.webhookId,
      workspaceId: workspace.id,
      name: dto.name,
      url: dto.url,
      events: dto.events,
      isActive: dto.isActive,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteWebhook(
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: DeleteWebhookDto,
  ) {
    await this.webhookService.deleteWebhook(dto.webhookId, workspace.id);
  }
}
