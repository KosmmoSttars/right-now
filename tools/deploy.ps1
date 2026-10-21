# Builds Right Now and replaces the live copy at https://kosmo-stars.ru/now/.
# Usage: powershell -ExecutionPolicy Bypass -File tools\deploy.ps1 [-Server user@host] [-SkipBuild]
# The SSH target comes from -Server, the RIGHTNOW_SERVER variable or an untracked
# tools\deploy.local.ps1 that sets $Server.
param(
    [string]$Server = $env:RIGHTNOW_SERVER,
    [string]$Site = "/www/wwwroot/kosmo-stars.ru",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$localConfig = Join-Path $PSScriptRoot "deploy.local.ps1"
if (-not $Server -and (Test-Path $localConfig)) { . $localConfig }
if (-not $Server) { throw "no server: pass -Server user@host, set RIGHTNOW_SERVER or create tools\deploy.local.ps1" }
Set-Location (Split-Path $PSScriptRoot -Parent)
$Dir = "$Site/now"
$Data = "$Site/data/rightnow"

if (-not $SkipBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "build failed" }
}
if (-not (Test-Path "dist\index.html")) { throw "no build in dist\ - run the build first" }

$archive = Join-Path $env:TEMP "right-now.tar.gz"
# Windows' own bsdtar: a GNU tar from Git Bash on PATH would read "C:" as a remote host.
& "$env:SystemRoot\System32\tar.exe" -czf $archive -C dist .
if ($LASTEXITCODE -ne 0) { throw "packing failed" }

scp -q $archive "${Server}:/tmp/right-now.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "upload failed" }

# Unpack next to the live copy, check the PHP, then swap, so visitors never see a
# half-written app. Only now/ and the data cache in data/rightnow are touched.
$remote = @"
set -e
rm -rf $Dir.next
mkdir -p $Dir.next
tar -xzf /tmp/right-now.tar.gz -C $Dir.next
rm /tmp/right-now.tar.gz
php -l $Dir.next/api/data.php > /dev/null
mkdir -p $Data
chown -R www:www $Data
chmod 755 $Data
chown -R www:www $Dir.next
find $Dir.next -type d -exec chmod 755 {} +
find $Dir.next -type f -exec chmod 644 {} +
rm -rf $Dir.old
if [ -d $Dir ]; then mv $Dir $Dir.old; fi
mv $Dir.next $Dir
rm -rf $Dir.old
"@
ssh $Server ($remote -replace "`r", "")
if ($LASTEXITCODE -ne 0) { throw "server update failed" }
Remove-Item $archive

# First deploy (or a lost cache): build the caches from the command line as the web
# user, where there is no 100-second request limit.
$status = curl.exe -s "https://kosmo-stars.ru/now/api/data.php?set=status"
Write-Host "Data cache: $status"
if ($status -match '"asteroids":null') {
    Write-Host "Building the asteroid catalogue (about four minutes)..."
    ssh $Server "cd /tmp && sudo -u www php $Dir/api/data.php asteroids"
}
if ($status -match '"craft":null') {
    Write-Host "Fetching the spacecraft trajectories from JPL Horizons (about ten minutes)..."
    ssh $Server "cd /tmp && sudo -u www php $Dir/api/data.php craft"
}
if ($status -match '"live":null') {
    Write-Host "Fetching the live data..."
    ssh $Server "cd /tmp && sudo -u www php $Dir/api/data.php live"
}
Write-Host "Deployed to https://kosmo-stars.ru/now/"
