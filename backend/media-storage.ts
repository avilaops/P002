import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

type Environment = Record<string, string | undefined>;
type StorageProvider = "local" | "r2";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
};

export type MediaStorageConfig = {
  provider: StorageProvider;
  mediaDir: string;
  r2?: R2Config;
};

export type StoredMedia = {
  provider: StorageProvider;
  key: string;
  sha256: string;
};

type S3Sender = Pick<S3Client, "send">;

function extensionFor(mimeType: string, fallbackName?: string | null) {
  const known = EXTENSION_BY_MIME[mimeType.split(";")[0].trim().toLowerCase()];
  if (known) return known;
  const fromName = fallbackName?.split(".").pop();
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  return "bin";
}

function required(env: Environment, names: string[]) {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Configuração R2 incompleta: ${missing.join(", ")}.`);
}

export function readMediaStorageConfig(env: Environment = process.env): MediaStorageConfig {
  const provider = env.MEDIA_STORAGE_PROVIDER?.trim().toLowerCase() || "local";
  const mediaDir = env.MEDIA_DIR?.trim() || join(rootDir, "storage", "media");
  if (provider !== "local" && provider !== "r2") throw new Error("MEDIA_STORAGE_PROVIDER deve ser local ou r2.");
  const r2Names = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const hasR2Setting = r2Names.some((name) => Boolean(env[name]?.trim()));
  if (provider === "r2" || hasR2Setting) required(env, r2Names);
  if (!hasR2Setting && provider === "local") return { provider, mediaDir };

  const accountId = env.R2_ACCOUNT_ID!.trim();
  return {
    provider,
    mediaDir,
    r2: {
      accountId,
      accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
      bucket: env.R2_BUCKET!.trim(),
      endpoint: env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
    },
  };
}

function assertUuid(value: string, label: string) {
  if (!UUID.test(value)) throw new Error(`${label} inválido para armazenamento de mídia.`);
}

export function buildMediaStorageKey(input: {
  tenantId: string;
  conversationId: string;
  mimeType: string;
  fileName?: string | null;
  objectId?: string;
}) {
  assertUuid(input.tenantId, "Tenant");
  assertUuid(input.conversationId, "Conversa");
  const objectId = input.objectId ?? randomUUID();
  assertUuid(objectId, "Objeto");
  return `tenants/${input.tenantId}/conversations/${input.conversationId}/${objectId}.${extensionFor(input.mimeType, input.fileName)}`;
}

export function isR2KeyForTenant(key: string, tenantId: string) {
  return UUID.test(tenantId) && key.startsWith(`tenants/${tenantId}/conversations/`);
}

function resolveLocal(mediaDir: string, key: string) {
  const base = resolve(mediaDir);
  const absolute = resolve(base, key);
  if (absolute !== base && !absolute.startsWith(base + sep)) throw new Error("Chave local fora do diretório de mídia.");
  return absolute;
}

function createS3(config: R2Config, forcePathStyle: boolean) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle,
  });
}

export function createMediaStorage(options: { env?: Environment; s3?: S3Sender } = {}) {
  const config = readMediaStorageConfig(options.env ?? process.env);
  const s3 = config.r2
    ? options.s3 ?? createS3(config.r2, (options.env ?? process.env).R2_FORCE_PATH_STYLE === "true")
    : null;

  return {
    provider: config.provider,

    async put(input: { tenantId: string; conversationId: string; bytes: Buffer; mimeType: string; fileName?: string | null }): Promise<StoredMedia> {
      const sha256 = createHash("sha256").update(input.bytes).digest("hex");
      if (config.provider === "local") {
        assertUuid(input.tenantId, "Tenant");
        const key = join(input.tenantId, `${randomUUID()}.${extensionFor(input.mimeType, input.fileName)}`);
        const absolute = resolveLocal(config.mediaDir, key);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, input.bytes);
        return { provider: "local", key, sha256 };
      }

      const key = buildMediaStorageKey(input);
      await s3!.send(new PutObjectCommand({
        Bucket: config.r2!.bucket,
        Key: key,
        Body: input.bytes,
        ContentType: input.mimeType,
        Metadata: { sha256 },
      }));
      return { provider: "r2", key, sha256 };
    },

    async get(input: { provider: StorageProvider; key: string }) {
      if (input.provider === "local") {
        return { bytes: await readFile(resolveLocal(config.mediaDir, input.key)) };
      }
      if (!config.r2 || !s3) throw new Error("Leitura R2 solicitada sem configuração R2.");
      const object = await s3.send(new GetObjectCommand({ Bucket: config.r2.bucket, Key: input.key }));
      if (!object.Body) throw new Error("Objeto R2 sem conteúdo.");
      return { bytes: Buffer.from(await object.Body.transformToByteArray()) };
    },

    async delete(input: { provider: StorageProvider; key: string }) {
      if (input.provider === "local") {
        await unlink(resolveLocal(config.mediaDir, input.key)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        return;
      }
      if (!config.r2 || !s3) throw new Error("Exclusão R2 solicitada sem configuração R2.");
      await s3.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: input.key }));
    },
  };
}
