'use client'

import { DisconnectButton, GridLayout, MediaDeviceSelect, ParticipantTile, RoomAudioRenderer, TrackToggle, useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'

export default function MeetingConference({ guest }: { guest: boolean }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false })
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1"><GridLayout tracks={tracks} style={{ height: '100%' }}><ParticipantTile /></GridLayout></div>
    <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-700 bg-slate-900 p-3">
      <TrackToggle source={Track.Source.Microphone} className="lk-button min-h-11">Microfone</TrackToggle>
      <TrackToggle source={Track.Source.Camera} className="lk-button min-h-11">Câmera</TrackToggle>
      <TrackToggle source={Track.Source.ScreenShare} className="lk-button min-h-11">Compartilhar tela</TrackToggle>
      <details className="relative text-sm"><summary className="min-h-11 cursor-pointer rounded-lg border border-slate-600 px-3 py-3">Escolher microfone</summary><div className="absolute bottom-full right-0 z-20 mb-2 max-h-64 min-w-60 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-3"><MediaDeviceSelect kind="audioinput" /></div></details>
      {guest && <DisconnectButton className="lk-button min-h-11">Sair da reunião</DisconnectButton>}
    </div>
    <RoomAudioRenderer />
  </div>
}
