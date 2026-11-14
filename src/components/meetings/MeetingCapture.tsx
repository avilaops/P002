'use client'

import { useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track, TrackEvent, type TrackPublication } from 'livekit-client'
import { AudioUploadQueue, AudioTrackRegistry, TrackAudioRecorder } from '../../lib/meetingCapture'
import { meetingRequest } from '../../lib/meetings'

export default function MeetingCapture({ id, startedAt, onReady, onIssue }: {
  id: string; startedAt: string; onReady: (stop: () => Promise<boolean>) => void; onIssue: () => void
}) {
  const room = useRoomContext()
  const [queued, setQueued] = useState(0)
  useEffect(() => {
    let stopped = false, mounted = true, broken = false
    const fail = () => { broken = true; onIssue() }
    const queue = new AudioUploadQueue(async chunk => {
      const params = new URLSearchParams({ chunkId: chunk.id, speaker: chunk.speaker, startMs: String(chunk.startMs), durationMs: String(chunk.durationMs) })
      await meetingRequest(`/api/meetings/${id}/audio?${params}`, { method: 'POST', headers: { 'Content-Type': chunk.blob.type }, body: chunk.blob })
    }, fail, 500, n => { if (mounted) setQueued(n) })
    const registry = new AudioTrackRegistry((track, speaker) => new TrackAudioRecorder(track, speaker, new Date(startedAt).getTime(), queue, fail), fail)
    const watched = new Set<Track>()
    const add = (publication: TrackPublication, local: boolean) => {
      const track = publication.track?.mediaStreamTrack
      if (stopped || !track || track.kind !== 'audio' || publication.source !== Track.Source.Microphone) return
      if (publication.track && !watched.has(publication.track)) { watched.add(publication.track); publication.track.on(TrackEvent.Restarted, scan) }
      try { registry.observe(publication.trackSid, track, local ? 'host' : 'guest') }
      catch { fail() }
    }
    const scan = () => {
      room.localParticipant.audioTrackPublications.forEach(publication => add(publication, true))
      room.remoteParticipants.forEach(participant => participant.audioTrackPublications.forEach(publication => add(publication, false)))
    }
    const remove = (_track: unknown, publication: TrackPublication) => {
      registry.remove(publication.trackSid)
    }
    const removeLocal = (publication: TrackPublication) => remove(null, publication)
    let stopping: Promise<boolean> | null = null
    const stop = () => stopping ??= (async () => {
      stopped = true
      await registry.stop()
      return await queue.flush() && !broken
    })()
    onReady(stop)
    scan()
    const scanTimer = setInterval(scan, 1000)
    room.on(RoomEvent.TrackSubscribed, scan).on(RoomEvent.LocalTrackPublished, scan)
      .on(RoomEvent.TrackUnsubscribed, remove).on(RoomEvent.LocalTrackUnpublished, removeLocal)
      .on(RoomEvent.Reconnecting, fail)
    return () => {
      mounted = false
      clearInterval(scanTimer)
      watched.forEach(track => track.off(TrackEvent.Restarted, scan))
      room.off(RoomEvent.TrackSubscribed, scan).off(RoomEvent.LocalTrackPublished, scan)
        .off(RoomEvent.TrackUnsubscribed, remove).off(RoomEvent.LocalTrackUnpublished, removeLocal).off(RoomEvent.Reconnecting, fail)
      void stop()
    }
  }, [id, onIssue, onReady, room, startedAt])
  return <p role="status" className="bg-slate-800 px-4 py-3 text-sm text-slate-100">Transcrição ativa enquanto você permanece nesta sala.{queued > 0 ? ` ${queued} trecho(s) aguardando envio.` : ' O texto aparecerá no histórico do lead.'}</p>
}
