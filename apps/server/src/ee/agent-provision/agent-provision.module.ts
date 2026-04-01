import { Module } from '@nestjs/common';
import { AgentProvisionService } from './agent-provision.service';
import { AgentProvisionController } from './agent-provision.controller';
import { AgentRegistryRepo } from './agent-registry.repo';
import { ApiKeyModule } from '../api-key/api-key.module';
import { TokenModule } from '../../core/auth/token.module';
import { SpaceModule } from '../../core/space/space.module';
import { WorkspaceModule } from '../../core/workspace/workspace.module';

@Module({
  imports: [TokenModule, ApiKeyModule, SpaceModule, WorkspaceModule],
  controllers: [AgentProvisionController],
  providers: [AgentProvisionService, AgentRegistryRepo],
  exports: [AgentProvisionService],
})
export class AgentProvisionModule {}
