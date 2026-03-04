import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { ClsService } from 'nestjs-cls';
import {
  IAuditService,
  AuditLogContext,
} from '../../integrations/audit/audit.service';
import {
  AuditLogPayload,
  ActorType,
  EXCLUDED_AUDIT_EVENTS,
} from '../../common/events/audit-events';
import {
  AuditContext,
  AUDIT_CONTEXT_KEY,
} from '../../common/middlewares/audit-context.middleware';
@Injectable()
export class EeAuditService implements IAuditService {
  private readonly logger = new Logger(EeAuditService.name);
  private actorId: string | null = null;
  private actorType: ActorType = 'user';

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly cls: ClsService,
  ) {}

  log(payload: AuditLogPayload): void {
    if (EXCLUDED_AUDIT_EVENTS.has(payload.event)) return;

    const auditContext = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (!auditContext?.workspaceId) return;

    this.writeLog(payload, {
      workspaceId: auditContext.workspaceId,
      actorId: this.actorId ?? auditContext.actorId ?? undefined,
      actorType: this.actorType ?? auditContext.actorType,
      ipAddress: auditContext.ipAddress ?? undefined,
    }).catch((err) => this.logger.error('Failed to write audit log', err));
  }

  logWithContext(payload: AuditLogPayload, context: AuditLogContext): void {
    if (EXCLUDED_AUDIT_EVENTS.has(payload.event)) return;
    this.writeLog(payload, context).catch((err) =>
      this.logger.error('Failed to write audit log', err),
    );
  }

  logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): void {
    for (const payload of payloads) {
      if (!EXCLUDED_AUDIT_EVENTS.has(payload.event)) {
        this.writeLog(payload, context).catch((err) =>
          this.logger.error('Failed to write audit log', err),
        );
      }
    }
  }

  setActorId(actorId: string): void {
    this.actorId = actorId;
  }

  setActorType(actorType: ActorType): void {
    this.actorType = actorType;
  }

  updateRetention(
    _workspaceId: string,
    _retentionDays: number,
  ): void {
    // Retention cleanup handled separately
  }

  private async writeLog(
    payload: AuditLogPayload,
    context: AuditLogContext,
  ): Promise<void> {
    await this.db
      .insertInto('audit')
      .values({
        event: payload.event,
        resourceType: payload.resourceType ?? '',
        resourceId: payload.resourceId ?? null,
        workspaceId: context.workspaceId,
        actorId: context.actorId ?? null,
        actorType: context.actorType ?? 'user',
        ipAddress: context.ipAddress ?? null,
        changes: payload.changes ?? null,
        metadata: payload.metadata ?? null,
        spaceId: payload.spaceId ?? null,
      })
      .execute();
  }
}
