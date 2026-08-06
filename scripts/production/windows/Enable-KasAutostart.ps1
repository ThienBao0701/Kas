<#
.SYNOPSIS
    Registers the two Windows Scheduled Tasks that run Kas unattended.

.DESCRIPTION
    The installer registers these itself when it is run elevated. This script
    exists for the case that actually happens: Kas was installed without
    Administrator rights, so the tasks were skipped and nobody noticed until
    the machine was next restarted and Kas did not come back.

        Kas          at Windows startup, as SYSTEM, before anyone logs in
        Kas Backup   daily at 22:00, as SYSTEM

    Both point at files inside the install directory. Registering a task
    against a path that does not exist would produce a boot failure discovered
    only after a reboot, so the files are checked first.

    ELEVATION IS REQUIRED, because both tasks run as SYSTEM. Without it the
    script says so and changes nothing.

.EXAMPLE
    Right-click -> Run with PowerShell (as Administrator)

    .\Enable-KasAutostart.ps1 -InstallDir 'C:\Kas'
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Kas'),
    # Report what would be registered and change nothing.
    [switch]$WhatIfOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceCmd = Join-Path $InstallDir 'KasService.cmd'
$backupCmd = Join-Path $InstallDir 'KasBackup.cmd'

Write-Host ''
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host '  Kas - bat tu dong khoi dong cung Windows' -ForegroundColor Cyan
Write-Host '===============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Thu muc cai dat : $InstallDir"

# --- The files the tasks will point at --------------------------------------
$missing = @()
foreach ($file in $serviceCmd, $backupCmd) {
    if (-not (Test-Path $file)) { $missing += $file }
}
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host '  KHONG TIM THAY TEP CAN THIET:' -ForegroundColor Red
    foreach ($file in $missing) { Write-Host "    $file" -ForegroundColor Red }
    Write-Host ''
    Write-Host '  Dang ky mot Scheduled Task tro toi tep khong ton tai se tao ra loi' -ForegroundColor Red
    Write-Host '  chi phat hien duoc sau khi khoi dong lai may. Hay cai dat Kas truoc,' -ForegroundColor Red
    Write-Host '  hoac chi dinh dung thu muc bang -InstallDir.' -ForegroundColor Red
    exit 1
}

# --- Elevation ---------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ''
    Write-Host '  CAN QUYEN ADMINISTRATOR.' -ForegroundColor Yellow
    Write-Host '  Ca hai tac vu chay duoi tai khoan SYSTEM nen Windows bat buoc phai co quyen nay.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Cach chay:' -ForegroundColor Yellow
    Write-Host '    1. Bam chuot phai vao Start > Windows PowerShell (Administrator)' -ForegroundColor Yellow
    Write-Host "    2. Chay:  & '$PSCommandPath' -InstallDir '$InstallDir'" -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Khong co gi bi thay doi.' -ForegroundColor Yellow
    exit 1
}

if ($WhatIfOnly) {
    Write-Host ''
    Write-Host '  -WhatIfOnly: se dang ky' -ForegroundColor Cyan
    Write-Host "    Kas         ONSTART  SYSTEM  -> $serviceCmd"
    Write-Host "    Kas Backup  DAILY 22:00  SYSTEM  -> $backupCmd"
    exit 0
}

# --- Register -----------------------------------------------------------------
# The exit code is the answer; stderr is left alone. On PowerShell 5.1
# redirecting a native command's stderr wraps each line in an ErrorRecord and,
# under $ErrorActionPreference = 'Stop', aborts the script — schtasks writes to
# stderr for ordinary conditions, so that path is hit routinely.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$failed = $false

try {
    # /F replaces an existing registration, which is what makes this safe to
    # re-run after an upgrade moved the install.
    schtasks.exe /Create /TN 'Kas' /TR "`"$serviceCmd`"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks (Kas) tra ve ma $LASTEXITCODE" }
    # The default 72-hour limit would stop a healthy server every three days.
    schtasks.exe /Change /TN 'Kas' /ET 00:00 | Out-Null
    Write-Host '  [OK] Kas          - khoi dong cung Windows' -ForegroundColor Green

    schtasks.exe /Create /TN 'Kas Backup' /TR "`"$backupCmd`"" /SC DAILY /ST 22:00 /RU SYSTEM /RL HIGHEST /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks (Kas Backup) tra ve ma $LASTEXITCODE" }
    # Two hours is far longer than a backup takes; it stops an overrun from
    # overlapping the next night's run.
    schtasks.exe /Change /TN 'Kas Backup' /ET 02:00 | Out-Null
    Write-Host '  [OK] Kas Backup   - sao luu hang ngay 22:00' -ForegroundColor Green
} catch {
    $failed = $true
    Write-Host "  [LOI] $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $ErrorActionPreference = $previousPreference
}

if ($failed) { exit 1 }

# --- Prove it -----------------------------------------------------------------
Write-Host ''
Write-Host '  Kiem tra lai:' -ForegroundColor Cyan
$ErrorActionPreference = 'Continue'
foreach ($task in 'Kas', 'Kas Backup') {
    schtasks.exe /Query /TN $task | Out-Null
    $state = if ($LASTEXITCODE -eq 0) { 'da dang ky' } else { 'KHONG THAY' }
    Write-Host ("    {0,-12} {1}" -f $task, $state)
}
$ErrorActionPreference = $previousPreference

Write-Host ''
Write-Host '  Xong. Kas se tu chay sau lan khoi dong may tiep theo.' -ForegroundColor Green
Write-Host '  Chay ngay khong can khoi dong lai:  schtasks /Run /TN "Kas"' -ForegroundColor Green
Write-Host '  Kiem tra toan bo he thong:          Kas.cmd --diagnose' -ForegroundColor Green
exit 0
