# 端到端隧道自检：起中继 -> 起 cloudflared 快速隧道 -> 通过 URL 取页面 -> 收尾
#   powershell -File tools\test-tunnel.ps1
$ErrorActionPreference = "Continue"
$w   = Split-Path -Parent $PSScriptRoot          # webradar\
$cf  = Join-Path $w "tools\bin\cloudflared.exe"
$log = Join-Path $env:TEMP "cf_selftest.log"

if (-not (Test-Path $cf)) { Write-Host "[X] not found: $cf"; exit 1 }
Remove-Item $log -ErrorAction SilentlyContinue

Write-Host "[1/5] starting relay (22006) ..."
$relay = Start-Process "node" -ArgumentList "ws/app.js" -WorkingDirectory $w -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2

$local = (Test-NetConnection 127.0.0.1 -Port 22006 -WarningAction SilentlyContinue).TcpTestSucceeded
Write-Host "      127.0.0.1:22006 = $local"
if (-not $local) {
    Write-Host "[X] relay did not start"
    Stop-Process $relay.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "[2/5] starting cloudflared ..."
$cfp = Start-Process $cf -ArgumentList "tunnel", "--url", "http://localhost:22006", "--no-autoupdate" -WindowStyle Hidden -PassThru -RedirectStandardError $log

$url = $null
for ($i = 0; $i -lt 30 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue
    if ($m) { $url = $m.Matches[0].Value }
}
if (-not $url) { Write-Host "[X] no tunnel URL within 30s"; Get-Content $log -Tail 15 }
Write-Host "      URL = $url"

if ($url) {
    Write-Host "[3/5] waiting for propagation (15s) ..."
    Start-Sleep -Seconds 15

    Write-Host "[4/5] fetching through the tunnel ..."
    foreach ($path in @("/", "/data/de_dust2/data.json", "/assets/icons/cog.svg")) {
        try {
            $r = Invoke-WebRequest "$url$path" -UseBasicParsing -TimeoutSec 30
            Write-Host ("      {0,-28} HTTP {1}  {2} bytes" -f $path, $r.StatusCode, $r.RawContentLength)
        } catch {
            $e = $_.Exception
            Write-Host ("      {0,-28} ERR  {1}" -f $path, $e.Message)
            if ($e.InnerException) { Write-Host ("                                     -> " + $e.InnerException.Message) }
        }
    }
}

Write-Host "[5/5] cleanup ..."
Stop-Process -Id $cfp.Id   -Force -ErrorAction SilentlyContinue
Stop-Process -Id $relay.Id -Force -ErrorAction SilentlyContinue
Write-Host "done"
