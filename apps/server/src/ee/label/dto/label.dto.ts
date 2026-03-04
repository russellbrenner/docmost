import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLabelDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  color?: string;
}

export class UpdateLabelDto {
  @IsString()
  @IsNotEmpty()
  labelId: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  color?: string;
}

export class DeleteLabelDto {
  @IsString()
  @IsNotEmpty()
  labelId: string;
}

export class PageLabelDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsString()
  @IsNotEmpty()
  labelId: string;
}

export class PageLabelByNameDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsString()
  @IsNotEmpty()
  labelName: string;

  @IsString()
  @IsOptional()
  color?: string;
}
