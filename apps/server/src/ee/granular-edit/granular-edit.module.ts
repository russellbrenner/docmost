import { Module } from '@nestjs/common';
import { GranularEditController } from './granular-edit.controller';
import { GranularEditService } from './granular-edit.service';
import { CollaborationModule } from '../../collaboration/collaboration.module';

@Module({
  imports: [CollaborationModule],
  controllers: [GranularEditController],
  providers: [GranularEditService],
  exports: [GranularEditService],
})
export class GranularEditModule {}
