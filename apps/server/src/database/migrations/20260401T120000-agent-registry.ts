import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('agent_registry')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('api_key_id', 'uuid', (col) =>
      col.notNull().references('api_keys.id').onDelete('cascade'),
    )
    .addColumn('token', 'text', (col) => col.notNull())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_agent_registry_workspace_slug')
    .unique()
    .on('agent_registry')
    .columns(['workspace_id', 'slug'])
    .execute();

  await db.schema
    .createIndex('idx_agent_registry_workspace_active')
    .on('agent_registry')
    .columns(['workspace_id', 'deleted_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('agent_registry').execute();
}
