import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { JwtApiKeyPayload } from '../../core/auth/dto/jwt-payload';
import { TokenService } from '../../core/auth/services/token.service';
import { isUserDisabled } from '../../common/helpers';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
  ) {}

  async validateApiKey(payload: JwtApiKeyPayload) {
    const apiKey = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', payload.apiKeyId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt as any) < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', payload.sub)
      .where('workspaceId', '=', payload.workspaceId)
      .executeTakeFirst();

    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException('User not found or disabled');
    }

    const workspace = await this.db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', payload.workspaceId)
      .executeTakeFirst();

    if (!workspace) {
      throw new UnauthorizedException('Workspace not found');
    }

    // Fire-and-forget: update lastUsedAt
    this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', apiKey.id)
      .execute()
      .catch(() => {});

    return { user, workspace };
  }

  async createApiKey(opts: {
    name: string;
    creatorId: string;
    workspaceId: string;
    expiresAt?: Date;
  }) {
    const result = await this.db
      .insertInto('apiKeys')
      .values({
        name: opts.name,
        creatorId: opts.creatorId,
        workspaceId: opts.workspaceId,
        expiresAt: opts.expiresAt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const id = result.id;
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', opts.creatorId)
      .where('workspaceId', '=', opts.workspaceId)
      .executeTakeFirst();

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const token = await this.tokenService.generateApiToken({
      apiKeyId: id,
      user,
      workspaceId: opts.workspaceId,
      expiresIn: opts.expiresAt
        ? Math.floor(
            (opts.expiresAt.getTime() - Date.now()) / 1000,
          )
        : undefined,
    });

    return { apiKey: result, token };
  }

  async getApiKeys(workspaceId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit ?? 50,
      cursor: pagination.cursor,
      fields: [
        {
          expression: 'apiKeys.createdAt' as any,
          direction: 'desc' as const,
          key: 'createdAt' as any,
        },
      ],
      parseCursor: (cursor: any) => ({
        createdAt: new Date(cursor.createdAt),
      }),
    });
  }

  async updateApiKey(opts: {
    apiKeyId: string;
    workspaceId: string;
    name: string;
  }) {
    const apiKey = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', opts.apiKeyId)
      .where('workspaceId', '=', opts.workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    return this.db
      .updateTable('apiKeys')
      .set({ name: opts.name, updatedAt: new Date() })
      .where('id', '=', opts.apiKeyId)
      .returningAll()
      .executeTakeFirst();
  }

  async revokeApiKey(apiKeyId: string, workspaceId: string) {
    const apiKey = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', apiKeyId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    await this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date() })
      .where('id', '=', apiKeyId)
      .execute();
  }
}
