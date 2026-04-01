import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GranularEditService } from './granular-edit.service';
import { GranularEditDto } from './granular-edit.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { hasLicenseOrEE } from '../../common/helpers/utils';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class GranularEditController {
  constructor(
    private readonly granularEditService: GranularEditService,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('granular-update')
  async granularUpdate(
    @Body() dto: GranularEditDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (
      !hasLicenseOrEE({
        licenseKey: workspace.licenseKey,
        plan: workspace.plan,
        isCloud: false,
      })
    ) {
      throw new ForbiddenException(
        'Enterprise licence required for granular editing',
      );
    }

    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.validateCanEdit(page, user);

    return this.granularEditService.execute(dto, user);
  }
}
