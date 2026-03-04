import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LabelService } from './label.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { Workspace } from '@docmost/db/types/entity.types';
import {
  CreateLabelDto,
  DeleteLabelDto,
  PageLabelByNameDto,
  PageLabelDto,
  UpdateLabelDto,
} from './dto/label.dto';

@UseGuards(JwtAuthGuard)
@Controller('labels')
export class LabelController {
  constructor(private readonly labelService: LabelService) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createLabel(
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: CreateLabelDto,
  ) {
    return this.labelService.createLabel({
      name: dto.name,
      color: dto.color,
      workspaceId: workspace.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async listLabels(@AuthWorkspace() workspace: Workspace) {
    return this.labelService.listLabels(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateLabel(
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labelService.updateLabel({
      labelId: dto.labelId,
      workspaceId: workspace.id,
      name: dto.name,
      color: dto.color,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteLabel(
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: DeleteLabelDto,
  ) {
    await this.labelService.deleteLabel(dto.labelId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('add-to-page')
  async addLabelToPage(@Body() dto: PageLabelDto) {
    return this.labelService.addLabelToPage({
      pageId: dto.pageId,
      labelId: dto.labelId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('add-to-page-by-name')
  async addLabelToPageByName(
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: PageLabelByNameDto,
  ) {
    return this.labelService.addLabelToPageByName({
      pageId: dto.pageId,
      labelName: dto.labelName,
      workspaceId: workspace.id,
      color: dto.color,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove-from-page')
  async removeLabelFromPage(@Body() dto: PageLabelDto) {
    return this.labelService.removeLabelFromPage({
      pageId: dto.pageId,
      labelId: dto.labelId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('page-labels')
  async getPageLabels(@Body() body: { pageId: string }) {
    return this.labelService.getPageLabels(body.pageId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('pages-by-label')
  async getPagesByLabel(
    @AuthWorkspace() workspace: Workspace,
    @Body() body: { labelId: string },
  ) {
    return this.labelService.getPagesByLabel(body.labelId, workspace.id);
  }
}
