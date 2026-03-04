import { Module } from '@nestjs/common';
import { ApiKeyModule } from './api-key/api-key.module';
import { EeAuditModule } from './audit/audit.module';
import { LabelModule } from './label/label.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [ApiKeyModule, EeAuditModule, LabelModule, WebhookModule],
})
export class EeModule {}
