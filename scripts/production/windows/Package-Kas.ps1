<#
.SYNOPSIS
    Builds a self-contained Kas release folder for single-machine deployment.

.DESCRIPTION
    Produces release/Kas-<version>/ containing everything a target machine
    needs: the built server and SPA, the Prisma schema and migrations,
    production-only node_modules (including the native Prisma engines), the
    Phase 6.2 launcher, and the installer.

    WHAT IS NOT IN THE PAYLOAD, deliberately:
      .env                 configuration is per-machine and holds the database
                           password; it is never packaged, never copied and
                           never overwritten. The installer seeds a template
                           only when none exists.
      server/uploads       guest documents belong to the hotel.
      dev dependencies     the target never builds anything.

    NODE RUNTIME. By default the release expects Node on the target machine and
    the installer detects it. Pass -BundleNode with the path to an extracted
    node-v22+-win-x64 folder to make the release fully self-contained; the
    launcher prefers a bundled runtime when one is present.

.EXAMPLE
    .\scripts\production\windows\Package-Kas.ps1
    .\scripts\production\windows\Package-Kas.ps1 -BundleNode 'C:\tmp\node-v22.11.0-win-x64'
#>
[CmdletBinding()]
param(
    [string]$OutputRoot,
    [string]$BundleNode,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $OutputRoot) { $OutputRoot = Join-Path $RepoRoot 'release' }

$version = (Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path $OutputRoot "Kas-$version"

Write-Host "Kas $version -> $stage" -ForegroundColor Cyan

# --- 1. Build ---------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host 'Dang build...' -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build that bai.' }
    } finally { Pop-Location }
}

foreach ($required in 'server\dist\index.js', 'server\dist\launcher\cli.js', 'client\dist\index.html') {
    if (-not (Test-Path (Join-Path $RepoRoot $required))) {
        throw "Thieu $required. Chay 'npm run build' truoc."
    }
}

# --- 2. Clean stage ---------------------------------------------------------
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# --- 3. Copy the release payload -------------------------------------------
Write-Host 'Dang sao chep ung dung...' -ForegroundColor Cyan

function Copy-Payload {
    param([string]$Relative)
    $source = Join-Path $RepoRoot $Relative
    if (-not (Test-Path $source)) { throw "Khong tim thay $Relative" }
    $destination = Join-Path $stage $Relative
    $parent = Split-Path $destination -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item $source $destination -Recurse -Force
}

Copy-Payload 'server\dist'
Copy-Payload 'client\dist'
Copy-Payload 'prisma'

# The three entry points. KasService.cmd and KasBackup.cmd were MISSING here
# while the installer already registered Scheduled Tasks pointing at them —
# so on an elevated install both tasks referenced files that had never been
# copied, and neither the boot start nor the nightly backup would have run.
# Caught by installing into a throwaway directory and listing what arrived.
#
# These must stay in step with RELEASE_PAYLOAD in server/src/installer/plan.ts,
# which is what the uninstaller removes and what the tests assert.
Copy-Payload 'Kas.cmd'
Copy-Payload 'KasService.cmd'
Copy-Payload 'KasBackup.cmd'

# package.json files: needed by Node's module resolution and by the installer,
# which reads the version from the root one.
Copy-Payload 'package.json'
New-Item -ItemType Directory -Path (Join-Path $stage 'server') -Force | Out-Null
Copy-Item (Join-Path $RepoRoot 'server\package.json') (Join-Path $stage 'server\package.json') -Force

# Configuration TEMPLATE only — never the real .env.
Copy-Item (Join-Path $RepoRoot '.env.production.example') (Join-Path $stage '.env.example') -Force

# --- 4. Production dependencies --------------------------------------------
# Installed into the stage rather than copied from the repo: the repo tree
# carries dev dependencies and build tooling the target must never receive.
Write-Host 'Dang cai dependencies (production only)...' -ForegroundColor Cyan
Copy-Item (Join-Path $RepoRoot 'package-lock.json') (Join-Path $stage 'package-lock.json') -Force
Push-Location $stage
try {
    & npm.cmd ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'npm ci that bai.' }
    # --ignore-scripts skipped Prisma's generate, so the client is produced
    # explicitly. Without it @prisma/client throws at first query.
    & npx.cmd prisma generate --schema prisma/schema.prisma
    if ($LASTEXITCODE -ne 0) { throw 'prisma generate that bai.' }
} finally { Pop-Location }
Remove-Item (Join-Path $stage 'package-lock.json') -Force

# --- 5. Optional portable Node ---------------------------------------------
if ($BundleNode) {
    if (-not (Test-Path (Join-Path $BundleNode 'node.exe'))) {
        throw "Khong tim thay node.exe trong '$BundleNode'."
    }
    Write-Host 'Dang dong goi Node portable...' -ForegroundColor Cyan
    Copy-Item $BundleNode (Join-Path $stage 'runtime\node') -Recurse -Force
}

# --- 6. Installer ----------------------------------------------------------
$installerDir = Join-Path $stage 'installer'
New-Item -ItemType Directory -Path $installerDir -Force | Out-Null
foreach ($script in 'Install-Kas.ps1', 'Uninstall-Kas.ps1') {
    Copy-Item (Join-Path $PSScriptRoot $script) (Join-Path $installerDir $script) -Force
}
Copy-Item (Join-Path $PSScriptRoot 'Install-Kas.cmd') (Join-Path $stage 'Install-Kas.cmd') -Force

# Records the version so an upgrade can tell what it is replacing.
@{ version = $version; packagedAt = (Get-Date).ToString('o') } |
    ConvertTo-Json | Set-Content (Join-Path $stage 'kas-release.json') -Encoding utf8

$size = [math]::Round(((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ''
Write-Host "Hoan tat: $stage ($size MB)" -ForegroundColor Green
Write-Host 'Nen thu muc nay va gui cho may can cai. Nhan dup Install-Kas.cmd de cai.'
