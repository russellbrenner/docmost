import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { InsertableAgentRegistry } from '@docmost/db/types/entity.types';
import { dbOrTx } from '@docmost/db/utils';

@Injectable()
export class AgentRegistryRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findBySlug(slug: string, workspaceId: string) {
    return this.db
      .selectFrom('agentRegistry')
      .selectAll()
      .where('slug', '=', slug)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findAll(workspaceId: string) {
    return this.db
      .selectFrom('agentRegistry')
      .leftJoin('apiKeys', 'apiKeys.id', 'agentRegistry.apiKeyId')
      .select([
        'agentRegistry.id',
        'agentRegistry.name',
        'agentRegistry.slug',
        'agentRegistry.userId',
        'agentRegistry.apiKeyId',
        'agentRegistry.token',
        'agentRegistry.workspaceId',
        'agentRegistry.createdAt',
        'agentRegistry.updatedAt',
        'apiKeys.lastUsedAt',
      ])
      .where('agentRegistry.workspaceId', '=', workspaceId)
      .where('agentRegistry.deletedAt', 'is', null)
      .orderBy('agentRegistry.createdAt', 'desc')
      .execute();
  }

  async insert(
    data: InsertableAgentRegistry,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('agentRegistry')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(slug: string, workspaceId: string) {
    return this.db
      .updateTable('agentRegistry')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('slug', '=', slug)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async updateToken(
    slug: string,
    workspaceId: string,
    newToken: string,
    newApiKeyId: string,
  ) {
    return this.db
      .updateTable('agentRegistry')
      .set({
        token: newToken,
        apiKeyId: newApiKeyId,
        updatedAt: new Date(),
      })
      .where('slug', '=', slug)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }
}
