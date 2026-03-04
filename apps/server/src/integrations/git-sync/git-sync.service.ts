import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { jsonToMarkdown } from '../../collaboration/collaboration.util';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

@Injectable()
export class GitSyncService implements OnModuleInit {
  private readonly logger = new Logger(GitSyncService.name);
  private repoPath: string | null = null;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async onModuleInit() {
    this.repoPath = process.env.GIT_SYNC_REPO_PATH || null;
    if (!this.repoPath) {
      this.logger.log('Git sync disabled (GIT_SYNC_REPO_PATH not set)');
      return;
    }

    // Ensure the repo directory exists and is a git repo
    try {
      await fs.access(this.repoPath);
      await this.git('rev-parse', '--git-dir');
      this.logger.log(`Git sync enabled at ${this.repoPath}`);
    } catch {
      this.logger.log(`Initialising git repo at ${this.repoPath}`);
      await fs.mkdir(this.repoPath, { recursive: true });
      await this.git('init');
      await this.git('commit', '--allow-empty', '-m', 'Initial commit');
    }
  }

  isEnabled(): boolean {
    return !!this.repoPath;
  }

  async syncPage(pageId: string): Promise<void> {
    if (!this.repoPath) return;

    const page = await this.db
      .selectFrom('pages')
      .selectAll()
      .where('id', '=', pageId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!page) {
      this.logger.debug(`Page ${pageId} not found or deleted, skipping sync`);
      return;
    }

    const space = await this.db
      .selectFrom('spaces')
      .select(['slug', 'name'])
      .where('id', '=', page.spaceId)
      .executeTakeFirst();

    if (!space) return;

    const filePath = await this.buildFilePath(page, space.slug);
    const markdown = this.pageToMarkdown(page);

    // Check if content has changed
    const fullPath = path.join(this.repoPath, filePath);
    try {
      const existing = await fs.readFile(fullPath, 'utf-8');
      if (existing === markdown) {
        this.logger.debug(`Page ${pageId} unchanged, skipping commit`);
        return;
      }
    } catch {
      // File doesn't exist yet, proceed
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, markdown, 'utf-8');

    await this.git('add', filePath);

    const title = page.title || 'Untitled';
    const commitMsg = `docs: update "${title}"`;
    try {
      await this.git('commit', '-m', commitMsg);
      this.logger.debug(`Committed ${filePath}`);
    } catch (err: any) {
      // "nothing to commit" is not an error
      if (!err.stderr?.includes('nothing to commit')) {
        throw err;
      }
    }
  }

  async deletePage(pageId: string): Promise<void> {
    if (!this.repoPath) return;

    // Find any file matching this page's slugId
    const page = await this.db
      .selectFrom('pages')
      .select(['slugId', 'title', 'spaceId'])
      .where('id', '=', pageId)
      .executeTakeFirst();

    if (!page) return;

    const space = await this.db
      .selectFrom('spaces')
      .select(['slug'])
      .where('id', '=', page.spaceId)
      .executeTakeFirst();

    if (!space) return;

    // Try to find and remove the file
    const slugId = page.slugId;
    try {
      const { stdout } = await execFileAsync(
        'find',
        [this.repoPath, '-name', `${slugId}.md`, '-type', 'f'],
      );
      const files = stdout.trim().split('\n').filter(Boolean);
      for (const file of files) {
        const relPath = path.relative(this.repoPath, file);
        await this.git('rm', relPath);
      }
      if (files.length > 0) {
        const title = page.title || 'Untitled';
        await this.git('commit', '-m', `docs: delete "${title}"`);
        this.logger.debug(`Deleted ${files.length} file(s) for page ${pageId}`);
      }
    } catch {
      // File may not exist in repo yet
    }
  }

  private pageToMarkdown(page: any): string {
    const frontmatter = [
      '---',
      `title: "${(page.title || 'Untitled').replace(/"/g, '\\"')}"`,
      `id: ${page.slugId}`,
      `created: ${new Date(page.createdAt).toISOString()}`,
      `updated: ${new Date(page.updatedAt).toISOString()}`,
      '---',
      '',
    ].join('\n');

    let content = '';
    if (page.content) {
      try {
        content = jsonToMarkdown(page.content);
      } catch (err) {
        this.logger.warn(`Failed to convert page ${page.id} to markdown: ${err}`);
        content = page.textContent || '';
      }
    }

    return frontmatter + content + '\n';
  }

  private async buildFilePath(page: any, spaceSlug: string): Promise<string> {
    const parts: string[] = [];

    // Walk up the parent chain
    let current = page;
    while (current.parentPageId) {
      const parent = await this.db
        .selectFrom('pages')
        .select(['slugId', 'title', 'parentPageId'])
        .where('id', '=', current.parentPageId)
        .executeTakeFirst();

      if (!parent) break;
      parts.unshift(this.slugify(parent.title || parent.slugId));
      current = parent;
    }

    const fileName = `${page.slugId}.md`;
    return path.join(spaceSlug, ...parts, fileName);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'untitled';
  }

  private async git(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, { cwd: this.repoPath! });
  }
}
