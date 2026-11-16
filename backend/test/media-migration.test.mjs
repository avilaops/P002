import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { migrateMediaRows } from '../../dist-server/migrate-media-r2.js'

const bytes = Buffer.from('mídia existente')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const row = {
  id: '33333333-3333-4333-8333-333333333333',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  mime_type: 'image/png',
  file_name: 'foto.png',
  storage_key: 'old/foto.png',
  sha256,
}

test('dry-run contabiliza sem ler, enviar ou alterar', async () => {
  let touched = false
  const result = await migrateMediaRows({
    rows: [row],
    apply: false,
    storage: { get: async () => { touched = true }, put: async () => { touched = true } },
    update: async () => { touched = true; return true },
  })
  assert.deepEqual(result, { inspected: 1, migrated: 0, failed: 0, bytes: 0 })
  assert.equal(touched, false)
})

test('só troca o banco depois de conferir tamanho e SHA-256 no R2', async () => {
  const calls = []
  const result = await migrateMediaRows({
    rows: [row],
    apply: true,
    storage: {
      get: async input => { calls.push(['get', input]); return { bytes } },
      put: async input => { calls.push(['put', input]); return { provider: 'r2', key: 'new/foto.png', sha256 } },
      delete: async input => calls.push(['delete', input]),
    },
    update: async (media, stored) => { calls.push(['update', media.id, stored.key]); return true },
  })
  assert.deepEqual(result, { inspected: 1, migrated: 1, failed: 0, bytes: bytes.length })
  assert.deepEqual(calls.map(call => call[0]), ['get', 'put', 'get', 'update'])
})

test('checksum divergente não altera o banco e remove a cópia incompleta', async () => {
  const calls = []
  const result = await migrateMediaRows({
    rows: [row],
    apply: true,
    storage: {
      get: async input => ({ bytes: input.provider === 'local' ? bytes : Buffer.from('corrompido') }),
      put: async () => ({ provider: 'r2', key: 'new/foto.png', sha256 }),
      delete: async input => calls.push(['delete', input]),
    },
    update: async () => { calls.push(['update']); return true },
  })
  assert.deepEqual(result, { inspected: 1, migrated: 0, failed: 1, bytes: 0 })
  assert.deepEqual(calls.map(call => call[0]), ['delete'])
})
