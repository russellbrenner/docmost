import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { GranularEditDto, ContentFormat } from './granular-edit.dto';
import {
  htmlToJson,
  jsonToNode,
  prosemirrorNodeToYElement,
} from '../../collaboration/collaboration.util';
import { markdownToHtml } from '@docmost/editor-ext';
import {
  findAndReplaceInFragment,
  FindReplaceResult,
} from './yjs/find-replace';
import {
  replaceSectionContent,
  insertAfterNode,
  IdentifierNotFoundError,
  AmbiguousIdentifierError,
} from './yjs/section-ops';

@Injectable()
export class GranularEditService {
  private readonly logger = new Logger(GranularEditService.name);

  constructor(
    private readonly collaborationGateway: CollaborationGateway,
    private readonly pageRepo: PageRepo,
  ) {}

  async execute(dto: GranularEditDto, user: User): Promise<any> {
    const documentName = `page.${dto.pageId}`;

    switch (dto.operation) {
      case 'find_replace':
        return this.executeFindReplace(documentName, dto, user);
      case 'replace_section':
        return this.executeReplaceSection(documentName, dto, user);
      case 'insert_after':
        return this.executeInsertAfter(documentName, dto, user);
      default:
        throw new BadRequestException(`Unknown operation: ${dto.operation}`);
    }
  }

  private async executeFindReplace(
    documentName: string,
    dto: GranularEditDto,
    user: User,
  ) {
    let result: FindReplaceResult | undefined;

    await this.withConnection(documentName, user, (doc) => {
      const fragment = doc.getXmlFragment('default');
      result = findAndReplaceInFragment(
        fragment,
        dto.findText!,
        dto.replaceText ?? '',
        dto.matchCase ?? false,
        dto.occurrence ?? 1,
      );
    });

    if (!result || result.matchCount === 0) {
      throw new NotFoundException({
        message: 'Text not found',
        searchedFor: dto.findText,
      });
    }

    await this.updatePageMetadata(dto.pageId, user);

    return {
      operation: 'find_replace',
      matchCount: result.matchCount,
      replacedCount: result.replacedCount,
    };
  }

  private async executeReplaceSection(
    documentName: string,
    dto: GranularEditDto,
    user: User,
  ) {
    const prosemirrorJson = await this.parseProsemirrorContent(
      dto.content!,
      dto.format ?? 'json',
    );
    const newContent = prosemirrorJson.content || [];
    const yElements = newContent.map(prosemirrorNodeToYElement);

    try {
      await this.withConnection(documentName, user, (doc) => {
        const fragment = doc.getXmlFragment('default');
        replaceSectionContent(
          fragment,
          dto.sectionIdentifier!,
          dto.identifierType ?? 'text',
          yElements,
        );
      });
    } catch (err) {
      this.handleOperationError(err);
    }

    await this.updatePageMetadata(dto.pageId, user);

    return { operation: 'replace_section', success: true };
  }

  private async executeInsertAfter(
    documentName: string,
    dto: GranularEditDto,
    user: User,
  ) {
    const prosemirrorJson = await this.parseProsemirrorContent(
      dto.content!,
      dto.format ?? 'json',
    );
    const newContent = prosemirrorJson.content || [];
    const yElements = newContent.map(prosemirrorNodeToYElement);

    try {
      await this.withConnection(documentName, user, (doc) => {
        const fragment = doc.getXmlFragment('default');
        insertAfterNode(
          fragment,
          dto.sectionIdentifier!,
          dto.identifierType ?? 'text',
          yElements,
        );
      });
    } catch (err) {
      this.handleOperationError(err);
    }

    await this.updatePageMetadata(dto.pageId, user);

    return { operation: 'insert_after', success: true };
  }

  private async withConnection(
    documentName: string,
    user: User,
    fn: (doc: any) => void,
  ): Promise<void> {
    const connection =
      await this.collaborationGateway.openDirectConnection(documentName, {
        user,
      });
    try {
      await connection.transact(fn);
    } finally {
      await connection.disconnect();
    }
  }

  private async updatePageMetadata(
    pageId: string,
    user: User,
  ): Promise<void> {
    const page = await this.pageRepo.findById(pageId);
    if (!page) return;

    const contributors = new Set<string>(page.contributorIds || []);
    contributors.add(user.id);

    await this.pageRepo.updatePage(
      {
        lastUpdatedById: user.id,
        updatedAt: new Date(),
        contributorIds: Array.from(contributors),
      },
      page.id,
    );
  }

  private async parseProsemirrorContent(
    content: string | object,
    format: ContentFormat,
  ): Promise<any> {
    let prosemirrorJson: any;

    switch (format) {
      case 'markdown': {
        const html = await markdownToHtml(content as string);
        prosemirrorJson = htmlToJson(html as string);
        break;
      }
      case 'html': {
        prosemirrorJson = htmlToJson(content as string);
        break;
      }
      case 'json':
      default: {
        prosemirrorJson = content;
        break;
      }
    }

    try {
      jsonToNode(prosemirrorJson);
    } catch {
      throw new BadRequestException('Invalid content format');
    }

    return prosemirrorJson;
  }

  private handleOperationError(err: unknown): never {
    if (err instanceof IdentifierNotFoundError) {
      throw new NotFoundException({
        message: err.message,
        identifier: err.identifier,
        identifierType: err.identifierType,
      });
    }
    if (err instanceof AmbiguousIdentifierError) {
      throw new BadRequestException({
        message: err.message,
        identifier: err.identifier,
        count: err.matchCount,
        suggestion: 'Use identifierType: "id" for precision.',
      });
    }
    throw err;
  }
}
