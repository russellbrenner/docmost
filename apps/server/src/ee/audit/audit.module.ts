import { Global, Module } from '@nestjs/common';
import { EeAuditService } from './audit.service';
import { AUDIT_SERVICE } from '../../integrations/audit/audit.service';

@Global()
@Module({
  providers: [
    {
      provide: AUDIT_SERVICE,
      useClass: EeAuditService,
    },
  ],
  exports: [AUDIT_SERVICE],
})
export class EeAuditModule {}
