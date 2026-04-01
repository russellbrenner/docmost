import { ColumnType } from 'kysely';
import { DB, Generated, Timestamp } from '@docmost/db/types/db';
import { PageEmbeddings } from '@docmost/db/types/embeddings.types';

export interface AgentRegistryTable {
  id: Generated<string>;
  name: string;
  slug: string;
  userId: string;
  apiKeyId: string;
  token: string;
  workspaceId: string;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
  deletedAt: Timestamp | null;
}

export interface DbInterface extends DB {
  pageEmbeddings: PageEmbeddings;
  agentRegistry: AgentRegistryTable;
}
