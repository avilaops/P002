param([string]$Python = "$env:APPDATA/uv/python/cpython-3.10.22-windows-x86_64-none/python.exe", [string]$MediaIp = '')
$ErrorActionPreference = 'Stop'
$meetingRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$meetingRuntime = Join-Path $env:LOCALAPPDATA 'avilaops/crm-meetings'
if (!$MediaIp) {
  $MediaIp = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like 'vEthernet*WSL*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress
}
if (!$MediaIp -or !(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $MediaIp)) { throw 'Informe -MediaIp com o IPv4 de um adaptador privado local. O adaptador virtual WSL é usado por padrão.' }
$meetingAddressBytes = ([Net.IPAddress]::Parse($MediaIp)).GetAddressBytes()
if (!($meetingAddressBytes[0] -eq 10 -or ($meetingAddressBytes[0] -eq 172 -and $meetingAddressBytes[1] -ge 16 -and $meetingAddressBytes[1] -le 31) -or ($meetingAddressBytes[0] -eq 192 -and $meetingAddressBytes[1] -eq 168))) { throw 'O endereço de mídia precisa ser IPv4 privado.' }
New-Item -ItemType Directory -Path $meetingRuntime -Force | Out-Null
$meetingVersion = '1.13.11'
$meetingArchive = Join-Path $meetingRuntime "livekit_$($meetingVersion)_windows_amd64.zip"
$meetingBinary = Join-Path $meetingRuntime 'livekit-server.exe'
if (!(Test-Path -LiteralPath $meetingBinary)) {
  $meetingReleaseUrl = "https://github.com/livekit/livekit/releases/download/v$meetingVersion"
  Invoke-WebRequest "$meetingReleaseUrl/livekit_$($meetingVersion)_windows_amd64.zip" -OutFile $meetingArchive
  $meetingChecksumsPath = Join-Path $meetingRuntime 'checksums.txt'
  Invoke-WebRequest "$meetingReleaseUrl/checksums.txt" -OutFile $meetingChecksumsPath
  $meetingChecksums = Get-Content -LiteralPath $meetingChecksumsPath -Raw
  $meetingExpected = [regex]::Match($meetingChecksums, "(?m)^([a-f0-9]{64})\s+livekit_$($meetingVersion)_windows_amd64.zip\s*$").Groups[1].Value
  if (!$meetingExpected -or (Get-FileHash -LiteralPath $meetingArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $meetingExpected) { throw 'LiveKit checksum mismatch' }
  Expand-Archive -LiteralPath $meetingArchive -DestinationPath $meetingRuntime -Force
}
$meetingSecretsPath = Join-Path $meetingRuntime 'local-config.json'
if (Test-Path -LiteralPath $meetingSecretsPath) { $meetingSecrets = Get-Content -LiteralPath $meetingSecretsPath -Raw | ConvertFrom-Json }
else {
  $meetingSecrets = @{ apiKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLowerInvariant(); apiSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant(); sttKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
  $meetingSecrets | ConvertTo-Json | Set-Content -LiteralPath $meetingSecretsPath -Encoding utf8
}
@"
port: 7880
bind_addresses:
  - 127.0.0.1
rtc:
  tcp_port: 0
  udp_port: 7882
  node_ip: $MediaIp
  use_external_ip: false
  enable_loopback_candidate: false
  ips:
    includes:
      - $MediaIp/32
room:
  auto_create: false
  max_participants: 2
keys:
  $($meetingSecrets.apiKey): $($meetingSecrets.apiSecret)
logging:
  level: warn
"@ | Set-Content -LiteralPath (Join-Path $meetingRuntime 'livekit.yaml') -Encoding utf8
$meetingEnvPath = Join-Path $meetingRoot '.env.local'
if (Test-Path -LiteralPath $meetingEnvPath) {
  Copy-Item -LiteralPath $meetingEnvPath -Destination (Join-Path $meetingRuntime "crm-env-backup-$(Get-Date -Format yyyyMMdd-HHmmss).local")
  $meetingEnv = [IO.File]::ReadAllText($meetingEnvPath)
} else { $meetingEnv = '' }
$meetingValues = @{ LIVEKIT_URL = 'ws://127.0.0.1:7880'; LIVEKIT_API_KEY = $meetingSecrets.apiKey; LIVEKIT_API_SECRET = $meetingSecrets.apiSecret; MEETING_STT_URL = 'http://127.0.0.1:15435'; MEETING_STT_KEY = $meetingSecrets.sttKey; MEETING_AI_MODEL = 'qwen3:1.7b' }
foreach ($meetingEntry in $meetingValues.GetEnumerator()) {
  $meetingPattern = '(?m)^' + [regex]::Escape($meetingEntry.Key) + '=.*$'
  $meetingLine = $meetingEntry.Key + '=' + $meetingEntry.Value
  if ([regex]::IsMatch($meetingEnv, $meetingPattern)) { $meetingEnv = [regex]::Replace($meetingEnv, $meetingPattern, $meetingLine) }
  else { $meetingEnv = $meetingEnv.TrimEnd() + "`n" + $meetingLine + "`n" }
}
[IO.File]::WriteAllText($meetingEnvPath, $meetingEnv)
$meetingVenv = Join-Path $meetingRuntime 'venv'
if (!(Test-Path -LiteralPath (Join-Path $meetingVenv 'Scripts/python.exe'))) {
  & $Python -m venv $meetingVenv
  if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
}
& (Join-Path $meetingVenv 'Scripts/python.exe') -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Whisper installation failed' }
$meetingOllama = Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe'
if (Test-Path -LiteralPath $meetingOllama) {
  & $meetingOllama pull qwen3:1.7b *> (Join-Path $meetingRuntime 'model-pull.log')
  if ($LASTEXITCODE -ne 0) { throw 'Start Ollama and run setup again to install the meeting model.' }
}
Write-Output 'LiveKit and Whisper installed. Run scripts/meetings/start-local.ps1.'
