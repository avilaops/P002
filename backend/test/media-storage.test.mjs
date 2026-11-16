import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMediaStorageKey,
  createMediaStorage,
  isR2KeyForTenant,
  readMediaStorageConfig,
} from '../../dist-server/media-storage.js'

const tenantId = '11111111-1111-4111-8111-111111111111'
const conversationId = '22222222-2222-4222-8222-222222222222'

test('configuração R2 incompleta falha sem voltar silenciosamente ao disco', () => {
  assert.throws(
    () => readMediaStorageConfig({ MEDIA_STORAGE_PROVIDER: 'r2', R2_BUCKET: 'crm-media' }),
    /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
  )
})

test('chave é gerada pela aplicação e isolada por empresa e conversa', () => {
  const key = buildMediaStorageKey({ tenantId, conversationId, mimeType: 'image/jpeg', fileName: '../../segredo.exe', objectId: '33333333-3333-4333-8333-333333333333' })
  assert.equal(key, `tenants/${tenantId}/conversations/${conversationId}/33333333-3333-4333-8333-333333333333.jpg`)
  assert.doesNotMatch(key, /segredo|\.\./)
  assert.equal(isR2KeyForTenant(key, tenantId), true)
  assert.equal(isR2KeyForTenant(key, '44444444-4444-4444-8444-444444444444'), false)
})

test('adaptador local preserva compatibilidade e checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crm-media-store-'))
  const storage = createMediaStorage({ env: { MEDIA_DIR: directory, MEDIA_STORAGE_PROVIDER: 'local' } })
  try {
    const stored = await storage.put({ tenantId, conversationId, bytes: Buffer.from('conteúdo'), mimeType: 'text/plain', fileName: 'nota.txt' })
    assert.equal(stored.provider, 'local')
    assert.match(stored.key, new RegExp(`^${tenantId.replaceAll('-', '\\-')}[\\\\/]`))
    assert.equal(await readFile(join(directory, stored.key), 'utf8'), 'conteúdo')
    assert.equal((await storage.get({ provider: 'local', key: stored.key })).bytes.toString(), 'conteúdo')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('adaptador R2 envia e lê no bucket privado pelo cliente S3', async () => {
  const calls = []
  const s3 = {
    async send(command) {
      calls.push({ name: command.constructor.name, input: command.input })
      if (command.constructor.name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('do-r2')) } }
      return {}
    },
  }
  const env = {
    MEDIA_STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: 'account',
    R2_ACCESS_KEY_ID: 'access',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'crm-avilaops-com-media',
  }
  const storage = createMediaStorage({ env, s3 })
  const stored = await storage.put({ tenantId, conversationId, bytes: Buffer.from('do-r2'), mimeType: 'image/png', fileName: 'foto.png' })
  assert.equal(stored.provider, 'r2')
  assert.match(stored.key, new RegExp(`^tenants/${tenantId}/conversations/${conversationId}/`))
  assert.deepEqual(calls[0], {
    name: 'PutObjectCommand',
    input: {
      Bucket: 'crm-avilaops-com-media',
      Key: stored.key,
      Body: Buffer.from('do-r2'),
      ContentType: 'image/png',
      Metadata: { sha256: stored.sha256 },
    },
  })
  assert.equal((await storage.get({ provider: 'r2', key: stored.key })).bytes.toString(), 'do-r2')
})

test('reversão de novas gravações para local ainda lê objetos já migrados', async () => {
  const s3 = { send: async () => ({ Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('legado-r2')) } }) }
  const storage = createMediaStorage({
    env: {
      MEDIA_STORAGE_PROVIDER: 'local',
      R2_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'crm-avilaops-com-media',
    },
    s3,
  })
  assert.equal(storage.provider, 'local')
  assert.equal((await storage.get({ provider: 'r2', key: 'tenants/x/object.png' })).bytes.toString(), 'legado-r2')
})
