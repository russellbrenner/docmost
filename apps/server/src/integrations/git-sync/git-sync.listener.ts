import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventName } from '../../common/events/event.contants';
import { QueueJob, QueueName } from '../queue/constants';

export class GitSyncPageEvent {
  pageIds: string[];
  workspaceId: string;
}

const GIT_SYNC_DELAY = 30_000; // 30s debounce

@Injectable()
export class GitSyncListener {
  private readonly logger = new Logger(GitSyncListener.name);

  constructor(
    @InjectQueue(QueueName.GIT_SYNC_QUEUE) private gitSyncQueue: Queue,
  ) {}

  private isEnabled(): boolean {
    return !!process.env.GIT_SYNC_REPO_PATH;
  }

  @OnEvent(EventName.PAGE_CREATED)
  async handlePageCreated(event: GitSyncPageEvent) {
    if (!this.isEnabled()) return;
    for (const pageId of event.pageIds) {
      await this.gitSyncQueue.add(
        QueueJob.GIT_SYNC_PAGE,
        { pageId, workspaceId: event.workspaceId },
        { jobId: `git-sync-${pageId}`, delay: GIT_SYNC_DELAY },
      );
    }
  }

  @OnEvent(EventName.PAGE_UPDATED)
  async handlePageUpdated(event: GitSyncPageEvent) {
    if (!this.isEnabled()) return;
    for (const pageId of event.pageIds) {
      await this.gitSyncQueue.add(
        QueueJob.GIT_SYNC_PAGE,
        { pageId, workspaceId: event.workspaceId },
        { jobId: `git-sync-${pageId}`, delay: GIT_SYNC_DELAY },
      );
    }
  }

  @OnEvent(EventName.PAGE_SOFT_DELETED)
  async handlePageSoftDeleted(event: GitSyncPageEvent) {
    if (!this.isEnabled()) return;
    for (const pageId of event.pageIds) {
      await this.gitSyncQueue.add(
        QueueJob.GIT_SYNC_DELETE,
        { pageId, workspaceId: event.workspaceId },
        { jobId: `git-sync-del-${pageId}` },
      );
    }
  }

  @OnEvent(EventName.PAGE_DELETED)
  async handlePageDeleted(event: GitSyncPageEvent) {
    if (!this.isEnabled()) return;
    for (const pageId of event.pageIds) {
      await this.gitSyncQueue.add(
        QueueJob.GIT_SYNC_DELETE,
        { pageId, workspaceId: event.workspaceId },
        { jobId: `git-sync-del-${pageId}` },
      );
    }
  }

  @OnEvent(EventName.PAGE_RESTORED)
  async handlePageRestored(event: GitSyncPageEvent) {
    if (!this.isEnabled()) return;
    for (const pageId of event.pageIds) {
      await this.gitSyncQueue.add(
        QueueJob.GIT_SYNC_PAGE,
        { pageId, workspaceId: event.workspaceId },
        { jobId: `git-sync-${pageId}`, delay: GIT_SYNC_DELAY },
      );
    }
  }
}
