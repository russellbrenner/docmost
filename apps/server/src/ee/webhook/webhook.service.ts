import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { OnEvent } from '@nestjs/event-emitter';
import { createHmac } from 'crypto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async createWebhook(opts: {
    name?: string;
    url: string;
    secret?: string;
    events: string[];
    workspaceId: string;
    creatorId: string;
  }) {
    return this.db
      .insertInto('webhooks')
      .values({
        name: opts.name ?? null,
        url: opts.url,
        secret: opts.secret ?? null,
        events: opts.events,
        workspaceId: opts.workspaceId,
        creatorId: opts.creatorId,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async listWebhooks(workspaceId: string) {
    return this.db
      .selectFrom('webhooks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async updateWebhook(opts: {
    webhookId: string;
    workspaceId: string;
    name?: string;
    url?: string;
    events?: string[];
    isActive?: boolean;
  }) {
    const webhook = await this.db
      .selectFrom('webhooks')
      .selectAll()
      .where('id', '=', opts.webhookId)
      .where('workspaceId', '=', opts.workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (opts.name !== undefined) updates.name = opts.name;
    if (opts.url !== undefined) updates.url = opts.url;
    if (opts.events !== undefined) updates.events = opts.events;
    if (opts.isActive !== undefined) updates.isActive = opts.isActive;

    return this.db
      .updateTable('webhooks')
      .set(updates)
      .where('id', '=', opts.webhookId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteWebhook(webhookId: string, workspaceId: string) {
    const webhook = await this.db
      .selectFrom('webhooks')
      .selectAll()
      .where('id', '=', webhookId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    await this.db
      .updateTable('webhooks')
      .set({ deletedAt: new Date() })
      .where('id', '=', webhookId)
      .execute();
  }

  @OnEvent('page.*')
  async handlePageEvent(payload: any) {
    await this.dispatchEvent(payload);
  }

  @OnEvent('comment.*')
  async handleCommentEvent(payload: any) {
    await this.dispatchEvent(payload);
  }

  private async dispatchEvent(payload: any) {
    const eventName = payload?.event;
    const workspaceId = payload?.workspaceId;
    if (!eventName || !workspaceId) return;

    const webhooks = await this.db
      .selectFrom('webhooks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('isActive', '=', true)
      .where('deletedAt', 'is', null)
      .execute();

    for (const webhook of webhooks) {
      if (!webhook.events.includes(eventName) && !webhook.events.includes('*')) {
        continue;
      }

      this.deliverWebhook(webhook, eventName, payload).catch((err) =>
        this.logger.error(
          `Webhook delivery failed for ${webhook.id}: ${err.message}`,
        ),
      );
    }
  }

  private async deliverWebhook(
    webhook: any,
    event: string,
    payload: any,
  ) {
    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Docmost-Event': event,
    };

    if (webhook.secret) {
      const signature = createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex');
      headers['X-Docmost-Signature'] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      await this.db
        .updateTable('webhooks')
        .set({ lastTriggeredAt: new Date() })
        .where('id', '=', webhook.id)
        .execute();
    } finally {
      clearTimeout(timeout);
    }
  }
}
