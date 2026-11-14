import assert from 'node:assert/strict'
import test from 'node:test'
import { AudioUploadQueue, AudioTrackRegistry, TrackAudioRecorder } from '../../src/lib/meetingCapture'

test('fila mantém a ordem, repete o mesmo bloco e aguarda todos os envios antes de encerrar', async () => {
  const calls: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const queue = new AudioUploadQueue(async chunk => {
    calls.push(chunk.id)
    if (calls.length === 1) { await gate; throw new Error('interrupção') }
  }, () => {}, 0)
  queue.add({ id: 'a', blob: new Blob(['audio']), speaker: 'host', startMs: 0, durationMs: 1000 })
  queue.add({ id: 'b', blob: new Blob(['audio']), speaker: 'guest', startMs: 1000, durationMs: 1000 })
  let complete = false
  const done = queue.flush().then(ok => { complete = true; assert.equal(ok, true) })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(complete, false)
  release(); await done
  assert.deepEqual(calls, ['a', 'a', 'b'])
})
test('falha definitiva é visível e impede afirmar captura completa', async () => {
  let errors = 0
  const queue = new AudioUploadQueue(async () => { throw new Error('offline') }, () => { errors++ }, 0)
  queue.add({ id: 'a', blob: new Blob(['audio']), speaker: 'host', startMs: 0, durationMs: 1000 })
  assert.equal(await queue.flush(), false)
  assert.equal(errors, 1)
})

test('encerrar durante o corte aguarda onstop e o último bloco antes de finalizar', async t => {
  const globals = globalThis as unknown as { MediaRecorder: unknown; MediaStream: unknown }
  const previous = { recorder: globals.MediaRecorder, stream: globals.MediaStream }
  const instances: FakeRecorder[] = []
  class FakeRecorder {
    static isTypeSupported() { return true }
    state = 'inactive'
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    onerror?: () => void
    constructor() { instances.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
    finish() { this.ondataavailable?.({ data: new Blob(['final audio']) }); this.onstop?.() }
  }
  globals.MediaRecorder = FakeRecorder; globals.MediaStream = class {}
  t.after(() => { globals.MediaRecorder = previous.recorder; globals.MediaStream = previous.stream })
  const sent: string[] = []
  const queue = new AudioUploadQueue(async chunk => { sent.push(chunk.id) }, () => {}, 0)
  const track = { readyState: 'live', addEventListener() {}, removeEventListener() {} } as unknown as MediaStreamTrack
  const recorder = new TrackAudioRecorder(track, 'guest', Date.now(), queue, () => {})
  const current = instances[0]
  // Recording lasted enough to contain speech; stop already happened but its event is pending.
  await new Promise(resolve => setTimeout(resolve, 210))
  current.stop()
  let complete = false
  const final = recorder.stop().then(() => queue.flush()).then(() => { complete = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(complete, false)
  current.finish(); await final
  assert.equal(sent.length, 1)
})
test('trocar faixa sem mudar publicação inicia outra captura e aguarda a antiga ao encerrar', async () => {
  const created: MediaStreamTrack[] = []
  let issues = 0, release!: () => void
  const oldStopped = new Promise<void>(resolve => { release = resolve })
  const registry = new AudioTrackRegistry(track => { created.push(track); return { stop: async () => { if (created[0] === track) await oldStopped } } }, () => { issues++ })
  const first = { readyState: 'live' } as MediaStreamTrack, second = { readyState: 'live' } as MediaStreamTrack
  registry.observe('same-sid', first, 'host')
  registry.observe('same-sid', first, 'host')
  registry.observe('same-sid', second, 'host')
  assert.equal(created.length, 2)
  assert.equal(issues, 1)
  let complete = false
  const stopped = registry.stop().then(() => { complete = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(complete, false)
  release(); await stopped
})
