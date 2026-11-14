$ErrorActionPreference = 'Stop'
$meetingRuntime = Join-Path $env:LOCALAPPDATA 'avilaops/crm-meetings'
$meetingSecrets = Get-Content -LiteralPath (Join-Path $meetingRuntime 'local-config.json') -Raw | ConvertFrom-Json
if (!(Get-NetTCPConnection -LocalPort 7880 -State Listen -ErrorAction SilentlyContinue)) {
  $meetingLivekit = Start-Process -FilePath (Join-Path $meetingRuntime 'livekit-server.exe') -ArgumentList '--config', (Join-Path $meetingRuntime 'livekit.yaml') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $meetingRuntime 'livekit.out.log') -RedirectStandardError (Join-Path $meetingRuntime 'livekit.err.log') -PassThru
  Write-Output "LIVEKIT_PID=$($meetingLivekit.Id)"
}
if (!(Get-NetTCPConnection -LocalPort 15435 -State Listen -ErrorAction SilentlyContinue)) {
  $env:MEETING_STT_KEY = $meetingSecrets.sttKey
  $env:MEETING_WHISPER_MODEL = 'base'
  $env:HF_HUB_DISABLE_TELEMETRY = '1'
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
  $meetingWhisper = Start-Process -FilePath (Join-Path $meetingRuntime 'venv/Scripts/python.exe') -ArgumentList (Join-Path $PSScriptRoot 'transcribe.py') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $meetingRuntime 'whisper.out.log') -RedirectStandardError (Join-Path $meetingRuntime 'whisper.err.log') -PassThru
  Write-Output "WHISPER_PID=$($meetingWhisper.Id)"
}
