import { Module } from '@nestjs/common';
import { AgentProvisionModule } from './agent-provision/agent-provision.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { EeAuditModule } from './audit/audit.module';
import { GranularEditModule } from './granular-edit/granular-edit.module';
import { LabelModule } from './label/label.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    AgentProvisionModule,
    ApiKeyModule,
    EeAuditModule,
    GranularEditModule,
    LabelModule,
    WebhookModule,
  ],
})
export class EeModule {}
