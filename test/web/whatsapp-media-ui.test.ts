import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('caixa WhatsApp usa avatar, prévia privada e transcrição sem expor URL do provedor', async () => {
  const source = await readFile(new URL('../../src/features/workspace/WorkspacePages.tsx', import.meta.url), 'utf8')
  assert.match(source, /ContactAvatar/)
  assert.match(source, /mediaPreviewUrl/)
  assert.match(source, /media_transcription/)
  assert.match(source, /Transcrevendo…/)
  assert.match(source, /bg-\[#d9fdd3\]/)
  assert.doesNotMatch(source, /profilePictureUrl/)
})
