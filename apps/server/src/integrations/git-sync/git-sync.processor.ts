import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../queue/constants';
import { GitSyncService } from './git-sync.service';

interface GitSyncJob {
  pageId: string;
  workspaceId: string;
}

@Processor(QueueName.GIT_SYNC_QUEUE)
export class GitSyncProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(GitSyncProcessor.name);

  constructor(private readonly gitSyncService: GitSyncService) {
    super();
  }

  async process(job: Job<GitSyncJob, void>): Promise<void> {
    if (!this.gitSyncService.isEnabled()) return;

    const { pageId } = job.data;

    switch (job.name) {
      case QueueJob.GIT_SYNC_PAGE:
        await this.gitSyncService.syncPage(pageId);
        break;
      case QueueJob.GIT_SYNC_DELETE:
        await this.gitSyncService.deletePage(pageId);
        break;
      default:
        this.logger.warn(`Unknown git-sync job: ${job.name}`);
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} for page: ${job.data.pageId}`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error(
      `Failed ${job.name} for page: ${job.data.pageId}. Reason: ${job.failedReason}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
