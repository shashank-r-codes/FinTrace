import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://fintrace:fintrace_dev_pass@localhost:5432/fintrace_db';

const migrationsDir = path.resolve(__dirname, 'migrations');

async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedRes = await pool.query<{ version: string; applied_at: Date }>(
      'SELECT version, applied_at FROM schema_migrations ORDER BY version ASC'
    );
    const appliedSet = new Set(appliedRes.rows.map((r) => r.version));

    if (statusOnly) {
      console.log('Migration Status:');
      for (const file of files) {
        const applied = appliedSet.has(file);
        console.log(`  ${applied ? '[APPLIED]' : '[PENDING]'} ${file}`);
      }
      return;
    }

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`Skipping already applied migration: ${file}`);
        continue;
      }

      const sqlPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(sqlPath, 'utf-8');

      console.log(`Applying migration: ${file}...`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Applied ${file} successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
