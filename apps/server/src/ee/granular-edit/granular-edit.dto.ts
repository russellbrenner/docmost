import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsBoolean,
  IsNumber,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export type GranularOperation =
  | 'find_replace'
  | 'replace_section'
  | 'insert_after';

export type ContentFormat = 'json' | 'markdown' | 'html';

export class GranularEditDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsIn(['find_replace', 'replace_section', 'insert_after'])
  operation: GranularOperation;

  // --- find_replace fields ---

  @ValidateIf((o) => o.operation === 'find_replace')
  @IsString()
  @IsNotEmpty()
  findText?: string;

  @ValidateIf((o) => o.operation === 'find_replace')
  @IsString()
  replaceText?: string;

  @IsOptional()
  @IsBoolean()
  matchCase?: boolean;

  @IsOptional()
  @IsNumber()
  occurrence?: number;

  // --- section operation fields ---

  @ValidateIf(
    (o) =>
      o.operation === 'replace_section' || o.operation === 'insert_after',
  )
  @IsString()
  @IsNotEmpty()
  sectionIdentifier?: string;

  @IsOptional()
  @IsIn(['text', 'id'])
  identifierType?: 'text' | 'id';

  // --- content for replace_section and insert_after ---

  @ValidateIf(
    (o) =>
      o.operation === 'replace_section' || o.operation === 'insert_after',
  )
  content?: string | object;

  @ValidateIf((o) => o.content !== undefined)
  @Transform(({ value }) => value?.toLowerCase() ?? 'json')
  @IsIn(['json', 'markdown', 'html'])
  format?: ContentFormat;
}
