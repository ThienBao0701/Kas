<#
.SYNOPSIS
    Installs Kas onto a Windows machine.

.DESCRIPTION
    Copies the release payload to the install directory, creates Desktop and
    Start Menu shortcuts, registers the application in Windows "Apps &
    features", and launches Kas on first install.

    THE GUARANTEE: an upgrade never touches operator data. Configuration
    (.env), uploaded proof images and logs are left exactly where they are. The
    PostgreSQL database is outside the install directory and is never reached
    by anything here — no migration is run, no data is deleted.

    All decisions (fresh / upgrade / repair, what to preserve) come from
    server/dist/installer/plan.js, which is unit tested. This script carries
    them out.

.EXAMPLE
    .\Install-Kas.ps1
    .\Install-Kas.ps1 -InstallDir 'D:\Kas' -NoLaunch
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Kas'),
    [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The release root is the parent of installer\, so the script works from
# wherever the operator extracted the archive.
$ReleaseRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $InstallDir 'logs'
$LogFile = Join-Path $LogDir 'installer.log'

function Write-Log {
    param([string]$Message, [string]$Colour = 'Gray')
    Write-Host $Message -ForegroundColor $Colour
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date).ToString('o'), $Message) -Encoding utf8
    } catch {
        # A log that cannot be written must not stop an install.
    }
}

Write-Host ''
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host '  Kas - Trinh cai dat' -ForegroundColor Cyan
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host ''

# --- Gather the environment the decision needs ------------------------------
$nodeMajor = $null
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $raw = (& node --version) 2>$null
    if ($raw -match 'v(\d+)') { $nodeMajor = [int]$Matches[1] }
}

$incomingVersion = 'unknown'
$releaseFile = Join-Path $ReleaseRoot 'kas-release.json'
if (Test-Path $releaseFile) {
    $incomingVersion = (Get-Content $releaseFile -Raw | ConvertFrom-Json).version
}

$existingVersion = $null
$installedRelease = Join-Path $InstallDir 'kas-release.json'
if (Test-Path $installedRelease) {
    $existingVersion = (Get-Content $installedRelease -Raw | ConvertFrom-Json).version
}
$existingInstall = [bool]$existingVersion

# A folder with contents but no Kas marker belongs to something else.
$targetOccupiedByOther = $false
if ((Test-Path $InstallDir) -and -not $existingInstall) {
    $targetOccupiedByOther = (Get-ChildItem $InstallDir -Force | Measure-Object).Count -gt 0
}

$targetWritable = $false
try {
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
    $probe = Join-Path $InstallDir '.write-probe'
    Set-Content -Path $probe -Value 'x' -Encoding ascii
    Remove-Item $probe -Force
    $targetWritable = $true
} catch {
    $targetWritable = $false
}

$payloadComplete = $true
foreach ($item in 'server\dist', 'client\dist', 'prisma', 'node_modules', 'package.json', 'Kas.cmd') {
    if (-not (Test-Path (Join-Path $ReleaseRoot $item))) { $payloadComplete = $false }
}

# --- Ask the tested plan what to do -----------------------------------------
$planModule = Join-Path $ReleaseRoot 'server\dist\installer\plan.js'
if (-not (Test-Path $planModule)) { throw "Goi cai dat hong: khong tim thay $planModule" }

$environmentJson = @{
    nodeMajor             = $nodeMajor
    targetDir             = $InstallDir
    targetWritable        = $targetWritable
    existingInstall       = $existingInstall
    existingVersion       = $existingVersion
    incomingVersion       = $incomingVersion
    payloadComplete       = $payloadComplete
    targetOccupiedByOther = $targetOccupiedByOther
} | ConvertTo-Json -Compress

# node reads the environment and prints the decision as JSON, so the PowerShell
# here never re-implements a rule that is tested in TypeScript.
#
# Both values travel through FILES rather than arguments: Windows argument
# parsing mangles the embedded quotes of a JSON string handed to a native
# executable, which fails in a way that looks like a syntax error in the script.
$environmentFile = Join-Path ([System.IO.Path]::GetTempPath()) ("kas-install-env-{0}.json" -f [guid]::NewGuid())
$decisionScriptFile = [System.IO.Path]::ChangeExtension($environmentFile, 'js')

# Written WITHOUT a byte-order mark. PowerShell 5.1's Set-Content -Encoding utf8
# emits a BOM, and JSON.parse rejects it outright — the failure surfaces as an
# unrelated-looking syntax error.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$decisionScript = @'
const fs = require('fs');
const plan = require(process.argv[2]);
// Strips a BOM if one ever reaches this file from elsewhere.
const env = JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^﻿/, ''));
const action = plan.decideInstall(env);
console.log(JSON.stringify({ action, lines: plan.describeInstall(action, env) }));
'@

[System.IO.File]::WriteAllText($environmentFile, $environmentJson, $utf8NoBom)
[System.IO.File]::WriteAllText($decisionScriptFile, $decisionScript, $utf8NoBom)

try {
    $decisionRaw = & node $decisionScriptFile $planModule $environmentFile
    if ($LASTEXITCODE -ne 0) { throw 'Khong doc duoc ke hoach cai dat.' }
    $decision = $decisionRaw | ConvertFrom-Json
} finally {
    Remove-Item $environmentFile, $decisionScriptFile -Force -ErrorAction SilentlyContinue
}

foreach ($line in $decision.lines) { Write-Log "  $line" }
Write-Host ''

if ($decision.action.kind -eq 'ABORT') {
    Write-Log 'Cai dat da dung lai. Khong co tep nao bi thay doi.' 'Red'
    exit 1
}

# --- Copy the payload -------------------------------------------------------
Write-Log "Dang cai dat ($($decision.action.kind))..." 'Cyan'

# Replaced wholesale; anything in OPERATOR_DATA is simply never named here, so
# it cannot be removed by accident.
foreach ($item in 'server\dist', 'client\dist', 'prisma', 'node_modules') {
    $destination = Join-Path $InstallDir $item
    if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
    $parent = Split-Path $destination -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item (Join-Path $ReleaseRoot $item) $destination -Recurse -Force
    Write-Log "  cap nhat $item"
}
foreach ($item in 'package.json', 'Kas.cmd', 'kas-release.json', 'server\package.json') {
    $source = Join-Path $ReleaseRoot $item
    if (Test-Path $source) { Copy-Item $source (Join-Path $InstallDir $item) -Force }
}
if (Test-Path (Join-Path $ReleaseRoot 'runtime')) {
    $runtimeDestination = Join-Path $InstallDir 'runtime'
    if (Test-Path $runtimeDestination) { Remove-Item $runtimeDestination -Recurse -Force }
    Copy-Item (Join-Path $ReleaseRoot 'runtime') $runtimeDestination -Recurse -Force
    Write-Log '  cap nhat runtime (Node portable)'
}

# --- Configuration ----------------------------------------------------------
# Seeded ONLY when absent. An existing .env holds the database password and the
# operator's own settings; overwriting it would break a working install.
$envPath = Join-Path $InstallDir '.env'
if (Test-Path $envPath) {
    Write-Log '  giu nguyen .env hien co (khong ghi de)'
} else {
    Copy-Item (Join-Path $ReleaseRoot '.env.example') $envPath -Force
    Write-Log '  da tao .env tu mau - CAN CHINH SUA truoc khi chay' 'Yellow'
}

# --- Shortcuts --------------------------------------------------------------
$iconPath = Join-Path $InstallDir 'client\dist\favicon.ico'
$targetCmd = Join-Path $InstallDir 'Kas.cmd'

function New-KasShortcut {
    param([string]$Path)
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $targetCmd
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.Description = 'Kas - Trung tam dieu phoi dat phong'
    if (Test-Path $iconPath) { $shortcut.IconLocation = $iconPath }
    $shortcut.Save()
}

$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kas.lnk'
$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kas'
if (-not (Test-Path $startMenuDir)) { New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null }
$startLink = Join-Path $startMenuDir 'Kas.lnk'

New-KasShortcut -Path $desktopLink
New-KasShortcut -Path $startLink
Write-Log '  da tao loi tat Desktop va Start Menu'

# --- Start with Windows -----------------------------------------------------
#
# An at-startup Scheduled Task, not a Windows Service. A service must speak the
# Service Control Protocol; node.exe does not, so `sc create` would register a
# service that fails at start with error 1053. Making Kas a real service needs a
# third-party wrapper binary shipped unsigned to the hotel. This needs nothing
# that is not already in Windows and does the same job.
#
# Registration needs Administrator (it runs as SYSTEM). A per-user install
# without elevation is still fully usable - the desktop shortcut starts Kas -
# so a failure here is reported and the install continues.
$serviceCmd = Join-Path $InstallDir 'KasService.cmd'
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Log '  bo qua tu dong khoi dong cung Windows (can quyen Administrator)' 'Yellow'
    Write-Log '    de bat sau: mo PowerShell (Administrator) va chay lai trinh cai dat' 'Yellow'
} else {
    try {
        # /F replaces an existing task, which is what makes an upgrade repoint
        # the task at the new payload instead of failing on "already exists".
        $null = schtasks.exe /Create /TN 'Kas' /TR "`"$serviceCmd`"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
        if ($LASTEXITCODE -ne 0) { throw "schtasks tra ve ma $LASTEXITCODE" }

        # The default 72-hour execution limit would stop a healthy server every
        # three days at whatever hour it happened to start.
        $null = schtasks.exe /Change /TN 'Kas' /ET 00:00 2>$null
        Write-Log '  da dang ky khoi dong cung Windows (Scheduled Task "Kas")'
        Write-Log '    tat an toan:  KasService.cmd stop'
    } catch {
        Write-Log "  KHONG dang ky duoc tu dong khoi dong: $($_.Exception.Message)" 'Yellow'
        Write-Log '    Kas van chay binh thuong khi bam loi tat tren Desktop.' 'Yellow'
    }
}

# --- Apps & features --------------------------------------------------------
# HKCU so no Administrator rights are needed for a per-user install.
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KasBookingDispatch'
New-Item -Path $uninstallKey -Force | Out-Null
$uninstallCommand = 'powershell.exe -ExecutionPolicy Bypass -File "{0}\installer\Uninstall-Kas.ps1"' -f $InstallDir
Set-ItemProperty -Path $uninstallKey -Name 'DisplayName' -Value 'Kas Booking Dispatch'
Set-ItemProperty -Path $uninstallKey -Name 'DisplayVersion' -Value $incomingVersion
Set-ItemProperty -Path $uninstallKey -Name 'Publisher' -Value 'Kas'
Set-ItemProperty -Path $uninstallKey -Name 'InstallLocation' -Value $InstallDir
Set-ItemProperty -Path $uninstallKey -Name 'UninstallString' -Value $uninstallCommand
Set-ItemProperty -Path $uninstallKey -Name 'NoModify' -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name 'NoRepair' -Value 1 -Type DWord
if (Test-Path $iconPath) { Set-ItemProperty -Path $uninstallKey -Name 'DisplayIcon' -Value $iconPath }
Write-Log '  da dang ky trong Apps & features'

# The uninstaller travels with the install so it survives the release folder.
$installedInstallerDir = Join-Path $InstallDir 'installer'
if (-not (Test-Path $installedInstallerDir)) { New-Item -ItemType Directory -Path $installedInstallerDir -Force | Out-Null }
Copy-Item (Join-Path $PSScriptRoot 'Uninstall-Kas.ps1') (Join-Path $installedInstallerDir 'Uninstall-Kas.ps1') -Force

Write-Host ''
Write-Log "Cai dat hoan tat: $InstallDir" 'Green'

# --- First run --------------------------------------------------------------
$freshEnv = -not (Test-Path $envPath) -or $decision.action.kind -eq 'FRESH'
if ($NoLaunch) {
    Write-Log 'Bo qua khoi dong (-NoLaunch).'
} elseif ($freshEnv -and -not $existingInstall) {
    Write-Host ''
    Write-Log 'BUOC TIEP THEO: mo .env trong thu muc cai dat va dien DATABASE_URL,' 'Yellow'
    Write-Log 'sau do nhan dup bieu tuong Kas tren Desktop.' 'Yellow'
} else {
    Write-Log 'Dang khoi dong Kas...' 'Cyan'
    Start-Process -FilePath $targetCmd -WorkingDirectory $InstallDir
}

Write-Host ''
Write-Log "Nhat ky: $LogFile"
exit 0
