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

test('botão do contato abre a conversa dentro do CRM', async () => {
  const source = await readFile(new URL('../../src/components/drawers/ContactDetailDrawer.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /wa\.me/)
  assert.match(source, /openContactWhatsApp\(contactId\)/)
  assert.match(source, /router\.push\(`\/communications\/inbox\/\$\{result\.conversation\.id\}\//)
})

test('ficha do contato fecha pelo fundo e pela tecla Escape', async () => {
  const source = await readFile(new URL('../../src/components/drawers/ContactDetailDrawer.tsx', import.meta.url), 'utf8')

  assert.match(source, /event\.target === event\.currentTarget/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /removeEventListener\('keydown', closeOnEscape\)/)
  assert.match(source, /role="dialog" aria-modal="true"/)
})
