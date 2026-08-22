[CmdletBinding()]
param(
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
Set-Location $RepoRoot

function Get-EnvValue([string]$Name) {
  $line = Get-Content -LiteralPath (Join-Path $RepoRoot '.env') |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -split '=', 2)[1].Trim().Trim('"').Trim("'"))
}

function Get-SupabaseUrl {
  $databaseUrl = Get-EnvValue 'DATABASE_URL'
  if (-not $databaseUrl) { throw 'DATABASE_URL is missing from the local .env file.' }
  $uri = [uri]$databaseUrl
  $direct = [regex]::Match($uri.Host, '(?:^|\.)db\.([a-z0-9-]+)\.supabase\.co$', 'IgnoreCase')
  $pooler = [regex]::Match(($uri.UserInfo -split ':', 2)[0], '^postgres\.([a-z0-9-]+)$', 'IgnoreCase')
  $projectRef = if ($direct.Success) { $direct.Groups[1].Value } elseif ($pooler.Success) { $pooler.Groups[1].Value } else { throw 'Could not derive the Supabase project URL from DATABASE_URL.' }
  return "https://$projectRef.supabase.co"
}

if (git status --porcelain) {
  Write-Host 'SOLFV engine sync skipped: the local checkout has uncommitted changes.'
  exit 0
}

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse origin/main).Trim()
if ($localHead -ne $remoteHead) {
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw 'git pull failed.' }
}

$targetEngineTree = (git rev-parse HEAD:engine).Trim()
$deployedEngineTree = (docker inspect --format '{{ index .Config.Labels "solfv.engine.tree" }}' solfv-engine 2>$null).Trim()
if ($targetEngineTree -eq $deployedEngineTree) {
  Write-Host 'SOLFV engine is already current.'
  exit 0
}

$envFile = Join-Path $RepoRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing runtime configuration: $envFile" }

docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not available.' }

docker image inspect solfv-engine-local:current *> $null
if ($LASTEXITCODE -eq 0) {
  docker tag solfv-engine-local:current solfv-engine-local:previous
} else {
  docker image inspect solfv-engine-local *> $null
  if ($LASTEXITCODE -eq 0) {
    docker tag solfv-engine-local solfv-engine-local:previous
  }
}
docker build --tag solfv-engine-local:current --file engine\Dockerfile engine
if ($LASTEXITCODE -ne 0) { throw 'Engine image build failed.' }

docker network inspect solfv-network *> $null
if ($LASTEXITCODE -ne 0) { docker network create solfv-network | Out-Null }

$supabaseUrl = Get-SupabaseUrl
docker rm --force solfv-engine 2>$null | Out-Null
docker run --detach --name solfv-engine --restart unless-stopped --network solfv-network --publish 127.0.0.1:8000:8000 --label "solfv.engine.tree=$targetEngineTree" --env-file $envFile --env "SUPABASE_URL=$supabaseUrl" --env SOLFV_AUTH_MODE=guest --env SOLFV_ENVIRONMENT=production --env SOLFV_CORS_ORIGINS=https://solfv.veriq.my solfv-engine-local:current | Out-Null

Start-Sleep -Seconds 3
try {
  $health = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health | ConvertFrom-Json
  if (-not $health.ok) { throw 'The replacement engine did not report healthy.' }
} catch {
  docker rm --force solfv-engine 2>$null | Out-Null
  docker image inspect solfv-engine-local:previous *> $null
  if ($LASTEXITCODE -eq 0) {
    docker run --detach --name solfv-engine --restart unless-stopped --network solfv-network --publish 127.0.0.1:8000:8000 --label "solfv.engine.tree=$deployedEngineTree" --env-file $envFile --env "SUPABASE_URL=$supabaseUrl" --env SOLFV_AUTH_MODE=guest --env SOLFV_ENVIRONMENT=production --env SOLFV_CORS_ORIGINS=https://solfv.veriq.my solfv-engine-local:previous | Out-Null
  }
  throw
}

Write-Host 'SOLFV engine updated and healthy.'
