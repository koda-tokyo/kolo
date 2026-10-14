<#
.SYNOPSIS
  KoLo installer for Windows (PowerShell 7 or Windows PowerShell 5.1).

.DESCRIPTION
  iwr -useb https://kodasoken.com/kolo/install.ps1 | iex
  & ([scriptblock]::Create((iwr -useb https://kodasoken.com/kolo/install.ps1))) -Version 2026.2.1 -NoService

  1. Picks the release bundle for this CPU from GitHub Releases
     (kolo-<version>-win32-<arch>.zip built by scripts/bundle.mjs, with SHA256SUMS.txt next
     to it; layout in docs/PACKAGING.md: bin\kolo.cmd, node\, lib\, SHA256SUMS, bundle-manifest.json).
  2. Verifies the SHA-256 of the download against SHA256SUMS.txt before unpacking.
  3. Installs under $env:KOLO_INSTALL_DIR (default %LOCALAPPDATA%\KoLo\app\<version>)
     and puts %LOCALAPPDATA%\KoLo\bin on the user PATH.
  4. Runs `kolo init --non-interactive` and `kolo service install` (Task Scheduler) unless told not to.
  5. Prints a pairing invitation for a second device or terminal.

  Requirements: none beyond PowerShell; the bundle ships its own Node.js runtime.
  Nothing is downloaded from anywhere but github.com. Nothing requires administrator rights.
#>
[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Prefix = $(if ($env:KOLO_INSTALL_DIR) { $env:KOLO_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "KoLo\app" }),
  [string]$BinDir = $(if ($env:KOLO_BIN_DIR) { $env:KOLO_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "KoLo\bin" }),
  [string]$Bundle = "",
  [string]$Sums = "",
  [string]$Name = $(if ($env:KOLO_IDENTITY) { $env:KOLO_IDENTITY } else { "default" }),
  [switch]$NoInit,
  [switch]$NoService,
  [switch]$NoInvite,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Repo = "koda-tokyo/kolo"
$Api = "https://api.github.com/repos/$Repo/releases"
$Download = "https://github.com/$Repo/releases/download"
$Docs = "https://kodasoken.com/kolo"

function Fail([string]$Message) {
  Write-Error "install.ps1: $Message"
  exit 1
}

$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
  "X64" { "x64" }
  "Arm64" { "arm64" }
  default { Fail "unsupported CPU: $_" }
}

if ($Bundle) {
  if (-not (Test-Path $Bundle)) { Fail "bundle not found: $Bundle" }
  $asset = Split-Path $Bundle -Leaf
  if ($asset -notmatch '^kolo-(.+)-win32-(x64|arm64)\.zip$') { Fail "bundle name must look like kolo-<version>-win32-<arch>.zip" }
  $Version = $Matches[1]
} else {
  if (-not $Version) {
    $latest = Invoke-RestMethod -Uri "$Api/latest" -Headers @{ Accept = "application/vnd.github+json" }
    $Version = $latest.tag_name
  }
  $Version = $Version.TrimStart("v")
  $asset = "kolo-$Version-win32-$arch.zip"
}
$dest = Join-Path $Prefix $Version

Write-Host "KoLo $Version  win32/$arch"
Write-Host "asset      $asset"
Write-Host "install    $dest"
Write-Host "command    $(Join-Path $BinDir 'kolo.cmd')"
if ($DryRun) {
  $source = if ($Bundle) { $Bundle } else { "$Download/v$Version/$asset" }
  Write-Host "source     $source"
  Write-Host "dry run: nothing downloaded, nothing written"
  exit 0
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("kolo-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  if ($Bundle) {
    $bundlePath = (Resolve-Path $Bundle).Path
    $sumsPath = if ($Sums) { $Sums }
      elseif (Test-Path "$bundlePath.sha256") { "$bundlePath.sha256" }
      else { Join-Path (Split-Path $bundlePath -Parent) "SHA256SUMS.txt" }
    if (-not (Test-Path $sumsPath)) { Fail "no checksum file next to the bundle ($asset.sha256 or SHA256SUMS.txt; pass -Sums)" }
  } else {
    $bundlePath = Join-Path $tmp $asset
    $sumsPath = Join-Path $tmp "SHA256SUMS.txt"
    Write-Host "download   $Download/v$Version/$asset"
    Invoke-WebRequest -Uri "$Download/v$Version/$asset" -OutFile $bundlePath -UseBasicParsing
    Invoke-WebRequest -Uri "$Download/v$Version/SHA256SUMS.txt" -OutFile $sumsPath -UseBasicParsing
  }

  $line = Get-Content $sumsPath | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } | Select-Object -First 1
  if (-not $line) { Fail "$asset is not listed in $(Split-Path $sumsPath -Leaf)" }
  $expected = ($line -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $bundlePath).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { Fail "SHA-256 mismatch for ${asset}: expected $expected, got $actual" }
  Write-Host "sha256 ok  $actual"

  $partial = "$dest.partial"
  if (Test-Path $partial) { Remove-Item -Recurse -Force $partial }
  New-Item -ItemType Directory -Path $partial -Force | Out-Null
  # Windows PowerShell 5.1's Expand-Archive extracts nothing from zip64 archives (more than 65,535
  # entries) and reports no error. bsdtar ships with Windows 10 1803+ and handles them; use it first.
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if ($tar) {
    & $tar.Source -xf $bundlePath -C $partial
    if ($LASTEXITCODE -ne 0) { Fail "tar.exe failed to extract $asset (exit $LASTEXITCODE)" }
  } else {
    Expand-Archive -Path $bundlePath -DestinationPath $partial -Force
  }
  $extracted = (Get-ChildItem -Path $partial -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  if ($extracted -lt 100) { Fail "extraction produced $extracted files; install tar.exe (Windows 10 1803+) or PowerShell 7 and retry" }
  # The archive has one top-level directory; lift its contents.
  $top = Get-ChildItem -Path $partial -Directory | Select-Object -First 1
  if (-not $top -or -not (Test-Path (Join-Path $top.FullName "bin\kolo.cmd"))) { Fail "bundle has no bin\kolo.cmd" }
  if (-not (Test-Path (Join-Path $top.FullName "bundle-manifest.json"))) { Fail "bundle has no bundle-manifest.json (not a scripts/bundle.mjs bundle)" }
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Move-Item -Path $top.FullName -Destination $dest
  Remove-Item -Recurse -Force $partial

  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  $launcher = Join-Path $BinDir "kolo.cmd"
  Set-Content -Path $launcher -Value "@echo off`r`n`"$dest\bin\kolo.cmd`" %*" -Encoding ASCII
  # Idempotent PATH edit: compare entries case-insensitively with trailing separators and
  # whitespace removed, so a re-run (or a PATH that already lists the dir as "...\bin\") adds
  # nothing. The same check guards the current session's PATH.
  $binNorm = $BinDir.TrimEnd('\', '/')
  $hasBin = {
    param([string]$value)
    foreach ($entry in ($value -split ';')) {
      $e = $entry.Trim().TrimEnd('\', '/')
      if ($e -and ($e -ieq $binNorm)) { return $true }
    }
    return $false
  }
  $userPath = [string][Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (& $hasBin $userPath)) {
    $newPath = if ($userPath) { "$BinDir;$userPath" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "added $BinDir to the user PATH (open a new terminal to pick it up)"
  }
  if (-not (& $hasBin ([string]$env:Path))) {
    $env:Path = "$BinDir;$env:Path"
  }
  Write-Host "installed  $(& $launcher --version)"

  if (-not $NoInit) {
    Write-Host ""
    & $launcher init --non-interactive --name $Name --bind loopback
    if ($LASTEXITCODE -ne 0) { Fail "kolo init failed" }
  }
  $invite = -not $NoInvite
  if (-not $NoService) {
    Write-Host ""
    & $launcher service install --id $Name
    if ($LASTEXITCODE -ne 0) {
      Write-Host "service install did not complete; start the gateway in a terminal with: kolo gateway"
      $invite = $false
    }
  }
  if ($NoService) {
    $invite = $false
    Write-Host ""
    Write-Host "no service registered: start the gateway with 'kolo gateway', then run 'kolo pair invite --scope attach'"
  }
  if ($invite) {
    Write-Host ""
    Write-Host "pairing invitation (scope: attach, one use):"
    & $launcher pair invite --scope attach
    if ($LASTEXITCODE -ne 0) { Write-Host "run 'kolo pair invite --scope attach' once the gateway is up" }
  }
  Write-Host ""
  Write-Host "next: kolo health - kolo tui - kolo --help - $Docs/start/getting-started"
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
