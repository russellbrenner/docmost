import { Module } from '@nestjs/common';
import { GitSyncListener } from './git-sync.listener';
import { GitSyncProcessor } from './git-sync.processor';
import { GitSyncService } from './git-sync.service';

@Module({
  providers: [GitSyncListener, GitSyncProcessor, GitSyncService],
  exports: [GitSyncService],
})
export class GitSyncModule {}
