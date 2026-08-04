<#
.SYNOPSIS
    Removes Kas from a Windows machine.

.DESCRIPTION
    Removes the application files, the shortcuts and the Apps & features entry.

    OPERATOR DATA IS KEPT BY DEFAULT. Configuration (.env), uploaded proof
    images, issue photos and logs stay where they are. Those are the hotel's
    records — an uninstall that deleted the proof a branch created a
    reservation correctly would destroy the only evidence of it.

    -PurgeData removes them too, and says exactly what it will delete first.

    THE DATABASE IS NEVER TOUCHED, with or without -PurgeData. It lives in
    PostgreSQL outside this directory; removing it is a deliberate database
    operation, not a side effect of uninstalling an application.

.EXAMPLE
    .\Uninstall-Kas.ps1
    .\Uninstall-Kas.ps1 -PurgeData
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$PurgeData,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host '  Kas - Go cai dat' -ForegroundColor Cyan
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "Thu muc: $InstallDir"

if (-not (Test-Path (Join-Path $InstallDir 'kas-release.json'))) {
    Write-Host 'Khong tim thay ban cai Kas o thu muc nay. Dung lai.' -ForegroundColor Red
    exit 1
}

# Application files only. Everything absent from this list survives, which is
# how operator data is protected — by never being named.
$applicationItems = @('server\dist', 'client\dist', 'prisma', 'node_modules', 'runtime',
                      'package.json', 'server\package.json', 'Kas.cmd', 'kas-release.json')
$operatorItems = @('.env', 'server\uploads', 'logs')

Write-Host ''
Write-Host 'Se xoa:' -ForegroundColor Yellow
foreach ($item in $applicationItems) { Write-Host "  - $item" }
if ($PurgeData) {
    Write-Host ''
    Write-Host 'VA XOA CA DU LIEU (-PurgeData):' -ForegroundColor Red
    foreach ($item in $operatorItems) { Write-Host "  - $item" -ForegroundColor Red }
} else {
    Write-Host ''
    Write-Host 'Giu lai (du lieu cua ban):' -ForegroundColor Green
    foreach ($item in $operatorItems) { Write-Host "  - $item" -ForegroundColor Green }
}
Write-Host ''
Write-Host 'Co so du lieu PostgreSQL KHONG bi dong den.' -ForegroundColor Green
Write-Host ''

if (-not $Force) {
    $answer = Read-Host 'Tiep tuc go cai dat? (y/N)'
    if ($answer -ne 'y' -and $answer -ne 'Y') {
        Write-Host 'Da huy. Khong co tep nao bi xoa.' -ForegroundColor Yellow
        exit 0
    }
}

$targets = if ($PurgeData) { $applicationItems + $operatorItems } else { $applicationItems }
foreach ($item in $targets) {
    $path = Join-Path $InstallDir $item
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  da xoa $item"
    }
}

# Shortcuts
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kas.lnk'
$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kas'
foreach ($link in @($desktopLink, $startMenuDir)) {
    if (Test-Path $link) {
        Remove-Item $link -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  da xoa loi tat $(Split-Path $link -Leaf)"
    }
}

# Apps & features
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KasBookingDispatch'
if (Test-Path $uninstallKey) {
    Remove-Item $uninstallKey -Recurse -Force
    Write-Host '  da go khoi Apps & features'
}

Write-Host ''
if ($PurgeData) {
    Write-Host 'Da go cai dat hoan toan.' -ForegroundColor Green
} else {
    Write-Host 'Da go cai dat. Du lieu cua ban van con tai:' -ForegroundColor Green
    Write-Host "  $InstallDir" -ForegroundColor Green
}
exit 0
