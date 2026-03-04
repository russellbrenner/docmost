import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
@Injectable()
export class LabelService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async createLabel(opts: {
    name: string;
    color?: string;
    workspaceId: string;
  }) {
    const existing = await this.db
      .selectFrom('labels')
      .selectAll()
      .where('name', '=', opts.name)
      .where('workspaceId', '=', opts.workspaceId)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException('Label already exists');
    }

    return this.db
      .insertInto('labels')
      .values({

        name: opts.name,
        color: opts.color ?? null,
        workspaceId: opts.workspaceId,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async listLabels(workspaceId: string) {
    return this.db
      .selectFrom('labels')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .orderBy('name', 'asc')
      .execute();
  }

  async updateLabel(opts: {
    labelId: string;
    workspaceId: string;
    name?: string;
    color?: string;
  }) {
    const label = await this.db
      .selectFrom('labels')
      .selectAll()
      .where('id', '=', opts.labelId)
      .where('workspaceId', '=', opts.workspaceId)
      .executeTakeFirst();

    if (!label) {
      throw new NotFoundException('Label not found');
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (opts.name !== undefined) updates.name = opts.name;
    if (opts.color !== undefined) updates.color = opts.color;

    return this.db
      .updateTable('labels')
      .set(updates)
      .where('id', '=', opts.labelId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteLabel(labelId: string, workspaceId: string) {
    const label = await this.db
      .selectFrom('labels')
      .selectAll()
      .where('id', '=', labelId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!label) {
      throw new NotFoundException('Label not found');
    }

    await this.db
      .deleteFrom('pageLabels')
      .where('labelId', '=', labelId)
      .execute();

    await this.db
      .deleteFrom('labels')
      .where('id', '=', labelId)
      .execute();
  }

  async addLabelToPage(opts: {
    pageId: string;
    labelId: string;
  }) {
    const existing = await this.db
      .selectFrom('pageLabels')
      .selectAll()
      .where('pageId', '=', opts.pageId)
      .where('labelId', '=', opts.labelId)
      .executeTakeFirst();

    if (existing) return existing;

    return this.db
      .insertInto('pageLabels')
      .values({

        pageId: opts.pageId,
        labelId: opts.labelId,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async addLabelToPageByName(opts: {
    pageId: string;
    labelName: string;
    workspaceId: string;
    color?: string;
  }) {
    let label = await this.db
      .selectFrom('labels')
      .selectAll()
      .where('name', '=', opts.labelName)
      .where('workspaceId', '=', opts.workspaceId)
      .executeTakeFirst();

    if (!label) {
      label = await this.db
        .insertInto('labels')
        .values({
  
          name: opts.labelName,
          color: opts.color ?? null,
          workspaceId: opts.workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return this.addLabelToPage({
      pageId: opts.pageId,
      labelId: label.id,
    });
  }

  async removeLabelFromPage(opts: {
    pageId: string;
    labelId: string;
  }) {
    await this.db
      .deleteFrom('pageLabels')
      .where('pageId', '=', opts.pageId)
      .where('labelId', '=', opts.labelId)
      .execute();
  }

  async getPageLabels(pageId: string) {
    return this.db
      .selectFrom('pageLabels')
      .innerJoin('labels', 'labels.id', 'pageLabels.labelId')
      .selectAll('labels')
      .where('pageLabels.pageId', '=', pageId)
      .execute();
  }

  async getPagesByLabel(labelId: string, workspaceId: string) {
    return this.db
      .selectFrom('pageLabels')
      .innerJoin('pages', 'pages.id', 'pageLabels.pageId')
      .select([
        'pages.id',
        'pages.title',
        'pages.slugId',
        'pages.spaceId',
        'pages.parentPageId',
        'pages.createdAt',
        'pages.updatedAt',
      ])
      .innerJoin('labels', 'labels.id', 'pageLabels.labelId')
      .where('pageLabels.labelId', '=', labelId)
      .where('labels.workspaceId', '=', workspaceId)
      .where('pages.deletedAt', 'is', null)
      .execute();
  }
}
