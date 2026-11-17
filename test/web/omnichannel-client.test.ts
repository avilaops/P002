import assert from 'node:assert/strict'
import test from 'node:test'

import { getMetaMessagingStatus, getWebChatChannel } from '../../src/lib/omnichannel.ts'

test('clientes omnichannel tratam respostas antigas ou incompletas como desconectadas', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })

  assert.deepEqual(await getMetaMessagingStatus(), { connected: false, account: null, channels: [] })
  assert.deepEqual(await getWebChatChannel(), { channel: null, embedCode: null })
})
