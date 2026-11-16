import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, query } from "./db.js";
import { createMediaStorage, type StoredMedia } from "./media-storage.js";

export type MigratableMedia = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  mime_type: string;
  file_name: string | null;
  storage_key: string;
  sha256: string | null;
};

type Storage = ReturnType<typeof createMediaStorage>;

export async function migrateMediaRows(input: {
  rows: MigratableMedia[];
  apply: boolean;
  storage: Pick<Storage, "get" | "put"> & Partial<Pick<Storage, "delete">>;
  update: (row: MigratableMedia, stored: StoredMedia) => Promise<boolean>;
}) {
  const result = { inspected: input.rows.length, migrated: 0, failed: 0, bytes: 0 };
  if (!input.apply) return result;

  for (const row of input.rows) {
    let stored: StoredMedia | null = null;
    try {
      const source = (await input.storage.get({ provider: "local", key: row.storage_key })).bytes;
      const digest = createHash("sha256").update(source);
      const sourceSha256 = digest.copy().digest("hex");
      const sourceSha256Base64 = digest.digest("base64");
      if (row.sha256 && sourceSha256 !== row.sha256 && sourceSha256Base64 !== row.sha256) {
        throw new Error("Checksum local divergente.");
      }

      stored = await input.storage.put({
        tenantId: row.tenant_id,
        conversationId: row.conversation_id,
        bytes: source,
        mimeType: row.mime_type,
        fileName: row.file_name,
      });
      if (stored.provider !== "r2") throw new Error("Destino da migração não é R2.");

      const target = (await input.storage.get({ provider: "r2", key: stored.key })).bytes;
      const targetSha256 = createHash("sha256").update(target).digest("hex");
      if (target.length !== source.length || targetSha256 !== sourceSha256) throw new Error("Verificação do objeto R2 falhou.");

      if (!(await input.update(row, stored))) throw new Error("A mídia mudou durante a migração.");
      result.migrated++;
      result.bytes += source.length;
    } catch {
      result.failed++;
      if (stored?.provider === "r2") await input.storage.delete?.({ provider: "r2", key: stored.key }).catch(() => {});
    }
  }
  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
  const limit = Math.min(1_000, Math.max(1, Number(limitArgument?.split("=")[1] ?? 100)));
  const storage = createMediaStorage();
  if (storage.provider !== "r2") throw new Error("Defina MEDIA_STORAGE_PROVIDER=r2 para executar a migração.");

  const rows = await query<MigratableMedia>(
    `select id, tenant_id, conversation_id, mime_type, file_name,
            coalesce(storage_key, storage_path) as storage_key, sha256
       from message_media
      where status = 'ready'
        and storage_provider = 'local'
        and conversation_id is not null
        and coalesce(storage_key, storage_path) is not null
      order by created_at
      limit $1`,
    [limit],
  );

  const result = await migrateMediaRows({
    rows: rows.rows,
    apply,
    storage,
    update: async (row, stored) => {
      const updated = await query(
        `update message_media
            set storage_provider = 'r2', storage_key = $3, storage_path = null, sha256 = $4, updated_at = now()
          where tenant_id = $1 and id = $2 and storage_provider = 'local'
            and coalesce(storage_key, storage_path) = $5`,
        [row.tenant_id, row.id, stored.key, stored.sha256, row.storage_key],
      );
      return updated.rowCount === 1;
    },
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", limit, ...result }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Migração de mídia falhou.");
      process.exitCode = 1;
    })
    .finally(closeDb);
}
