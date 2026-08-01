<#
.SYNOPSIS
  Sends the two confirmed OTA samples through the REAL /api/admin/ota/review
  route and prints what the Admin screen would receive.

.DESCRIPTION
  Development proof, not a test. It logs in as an Admin against a LOCAL backend,
  posts each sanitized fixture, and reports the fields that matter operationally
  plus the note generated for each payment mode.

  Nothing is written: the review endpoint is stateless.

  No secret is printed. The password is read from -AdminPassword or the
  KAS_PROOF_ADMIN_PASSWORD environment variable, never echoed, and the database
  URL is never touched by this script.

.EXAMPLE
  ./scripts/ota-review-proof.ps1 -BaseUrl http://127.0.0.1:3001 -AdminUser admin
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:3001',
  [string]$AdminUser = 'admin',
  [string]$AdminPassword = $env:KAS_PROOF_ADMIN_PASSWORD
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw 'Set -AdminPassword or $env:KAS_PROOF_ADMIN_PASSWORD. The value is never printed.'
}

# Refuse to point at anything but a local development backend.
if ($BaseUrl -notmatch '^https?://(127\.0\.0\.1|localhost)(:\d+)?/?$') {
  throw "Refusing: $BaseUrl is not a local development backend."
}

$repo = Split-Path -Parent $PSScriptRoot
$samples = @(
  @{ Source = 'CTRIP'; Path = Join-Path $repo 'server/tests/fixtures/ctrip/06-real-page-property-above.txt' },
  @{ Source = 'AGODA'; Path = Join-Path $repo 'server/tests/fixtures/agoda/08-real-bilingual-inline.txt' }
)

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "Backend: $BaseUrl" -ForegroundColor Cyan
$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -WebSession $session
Write-Host ("Health : pid={0} db-connected={1}" -f $health.process.pid, $health.database.connected)

Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method Post -WebSession $session `
  -ContentType 'application/json' `
  -Body (@{ username = $AdminUser; password = $AdminPassword } | ConvertTo-Json) | Out-Null
Write-Host "Login  : ok as $AdminUser" -ForegroundColor Green

function Send-Review {
  param([string]$Source, [string]$RawText, [hashtable]$Overrides)
  $payload = @{ source = $Source; rawText = $RawText }
  if ($Overrides) { $payload.overrides = $Overrides }
  Invoke-RestMethod -Uri "$BaseUrl/api/admin/ota/review" -Method Post -WebSession $session `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6)))
}

foreach ($sample in $samples) {
  $raw = Get-Content -LiteralPath $sample.Path -Raw -Encoding UTF8
  Write-Host ("`n=============== {0} ===============" -f $sample.Source) -ForegroundColor Cyan
  Write-Host ("fixture        : {0}" -f (Split-Path -Leaf $sample.Path))

  $res = Send-Review -Source $sample.Source -RawText $raw
  $r = $res.review

  Write-Host  "status         : 200 OK"
  Write-Host ("source         : {0}" -f $r.source)
  Write-Host ("branch         : {0} (id={1})  {2}" -f $r.branchCode, $r.branchId, $r.branchAddress)
  Write-Host ("guest          : {0}" -f $r.guestName)
  Write-Host ("booking code   : {0}" -f $r.bookingCode)
  Write-Host ("dates          : {0} -> {1}  ({2} nights)" -f $r.checkIn, $r.checkOut, $r.nights)
  foreach ($room in $r.rooms) {
    Write-Host ("room           : {0} x '{1}' -> {2}  (manual={3})" -f `
      $room.quantity, $room.otaRoomName, $room.pmsCode, $room.requiresManualMapping)
  }
  Write-Host ("branchPrice    : {0}" -f $r.branchPrice)
  Write-Host ("guestBookedPr. : {0}" -f $r.guestBookedPrice)
  Write-Host ("breakfast      : {0}" -f $r.breakfastIncluded)
  $blocking = if ($r.blockingReasons.Count -eq 0) { '(none)' } else { $r.blockingReasons -join ' | ' }
  Write-Host ("blocking       : {0}" -f $blocking)
  $warnings = if ($r.warnings.Count -eq 0) { '(none)' } else { ($r.warnings | ForEach-Object { $_.code }) -join ' | ' }
  Write-Host ("warnings       : {0}" -f $warnings)

  foreach ($mode in @('CN', 'HOTEL_PAYMENT')) {
    $withMode = Send-Review -Source $sample.Source -RawText $raw -Overrides @{ paymentMode = $mode }
    Write-Host ("`nnote [{0}]:" -f $mode) -ForegroundColor Yellow
    Write-Host $withMode.review.note
    Write-Host ("canDispatch    : {0}" -f $withMode.review.canDispatch)
  }
}

Write-Host "`nDone. Nothing was written -- the review endpoint is stateless." -ForegroundColor Green
