import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsArray,
  IsIn,
} from 'class-validator';

export class ProvisionAgentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @IsIn(['member', 'admin'])
  role?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  spaceIds?: string[];
}

export class AgentSlugDto {
  @IsString()
  @IsNotEmpty()
  slug: string;
}
