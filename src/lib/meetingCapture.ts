export type AudioChunk = { id: string; blob: Blob; speaker: 'host' | 'guest'; startMs: number; durationMs: number }

export class AudioUploadQueue {
  private chain: Promise<void> = Promise.resolve()
  private failed = false
  private count = 0
  constructor(private readonly send: (chunk: AudioChunk) => Promise<void>, private readonly onError: () => void,
    private readonly retryMs = 500, private readonly onCount: (count: number) => void = () => {}) {}
  add(chunk: AudioChunk) {
    if (this.count >= 12) { this.failed = true; this.onError(); return }
    this.count++; this.onCount(this.count)
    this.chain = this.chain.then(async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          try { await this.send(chunk); break } catch {
            if (attempt === 2) throw new Error('upload failed')
            await new Promise(resolve => setTimeout(resolve, this.retryMs * (attempt + 1)))
          }
        }
      } catch { this.failed = true; this.onError() }
      finally { this.count--; this.onCount(this.count) }
    })
  }
  async flush() { await this.chain; return !this.failed }
}

/** Tracks publications and underlying devices separately; replacement keeps the old flush. */
export class AudioTrackRegistry {
  private entries = new Map<string, { track: MediaStreamTrack; recorder: { stop: () => Promise<void> } }>()
  private retired = new Set<Promise<void>>()
  private closed = false
  constructor(private readonly create: (track: MediaStreamTrack, speaker: 'host' | 'guest') => { stop: () => Promise<void> }, private readonly onIssue: () => void) {}
  observe(sid: string, track: MediaStreamTrack, speaker: 'host' | 'guest') {
    if (this.closed) return
    const existing = this.entries.get(sid)
    if (existing?.track === track && track.readyState === 'live') return
    if (existing) { this.onIssue(); this.remove(sid) }
    if (track.readyState !== 'live') return
    this.entries.set(sid, { track, recorder: this.create(track, speaker) })
  }
  remove(sid: string) {
    const entry = this.entries.get(sid)
    if (!entry) return
    this.entries.delete(sid)
    const stopped = entry.recorder.stop()
    this.retired.add(stopped)
    void stopped.finally(() => this.retired.delete(stopped))
  }
  async stop() {
    this.closed = true
    for (const sid of this.entries.keys()) this.remove(sid)
    await Promise.all([...this.retired])
  }
}

export class TrackAudioRecorder {
  private recorder: MediaRecorder | null = null
  private active = true
  private timer?: ReturnType<typeof setTimeout>
  private stopping: Promise<void> | null = null
  private finish: (() => void) | null = null
  constructor(private readonly track: MediaStreamTrack, private readonly speaker: 'host' | 'guest',
    private readonly origin: number, private readonly queue: AudioUploadQueue, private readonly onError: () => void) {
    this.start()
  }
  private start() {
    if (!this.active || this.track.readyState !== 'live') { this.finish?.(); return }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
    if (!mimeType) { this.onError(); this.active = false; this.finish?.(); return }
    const started = Date.now(), parts: Blob[] = []
    try {
      const recorder = new MediaRecorder(new MediaStream([this.track]), { mimeType, audioBitsPerSecond: 32000 })
      this.recorder = recorder
      recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data) }
      recorder.onerror = () => { this.onError(); this.active = false; this.finish?.() }
      recorder.onstop = () => {
        if (Date.now() - started > 25000) this.onError()
        const duration = Math.max(1, Math.min(25000, Date.now() - started))
        if (parts.length && duration > 200) this.queue.add({ id: crypto.randomUUID(), blob: new Blob(parts, { type: mimeType.split(';')[0] }),
          speaker: this.speaker, startMs: Math.max(0, started - this.origin), durationMs: duration })
        this.recorder = null
        if (this.active && this.track.readyState === 'live') this.start()
        else this.finish?.()
      }
      recorder.start()
      this.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, 20000)
    } catch { this.recorder = null; this.active = false; this.onError(); this.finish?.() }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.active = false; clearTimeout(this.timer)
    this.stopping = new Promise(resolve => {
      this.finish = resolve
      if (!this.recorder) resolve()
      else if (this.recorder.state === 'recording') this.recorder.stop()
      // An inactive recorder may still owe us dataavailable/onstop from the timer.
    })
    return this.stopping
  }
}
