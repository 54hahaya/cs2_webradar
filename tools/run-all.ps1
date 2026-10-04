# 一键启动：构建 -> 中继 -> 隧道 -> 打印所有可用地址 -> Ctrl+C 退出时自动收尾
#   start-all.bat 会调用本脚本
$ErrorActionPreference = "Continue"
$webradar = Split-Path -Parent $PSScriptRoot
Set-Location $webradar

$cf        = Join-Path $PSScriptRoot "bin\cloudflared.exe"
$relayLog  = Join-Path $env:TEMP "radar_relay.log"
$tunnelLog = Join-Path $env:TEMP "radar_tunnel.log"
$children  = @()

function Stop-All {
    foreach ($p in $children) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host "   CS2 Web-Radar  -  一键启动" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host ""

# ---------- 0) 端口占用检查 ----------
$busy = Get-NetTCPConnection -LocalPort 22006 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "[!] 22006 已被占用 (pid=$($busy[0].OwningProcess))。可能是上一次的 serve.bat 还开着。" -ForegroundColor Yellow
    Write-Host "    先关掉它，或按 Ctrl+C 退出后重试。" -ForegroundColor Yellow
    Write-Host ""
}

# ---------- 1) 构建 ----------
Write-Host "[1/4] 构建前端 ..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "[X] 构建失败" -ForegroundColor Red; exit 1 }

# ---------- 2) 中继 ----------
Write-Host "[2/4] 启动中继 (22006) ..." -ForegroundColor Cyan
Remove-Item $relayLog -ErrorAction SilentlyContinue
$relay = Start-Process "node" -ArgumentList "ws/app.js" -WorkingDirectory $webradar -WindowStyle Hidden `
    -PassThru -RedirectStandardOutput $relayLog -RedirectStandardError "$relayLog.err"
$children += $relay
Start-Sleep -Seconds 2

if (-not (Test-NetConnection 127.0.0.1 -Port 22006 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    Write-Host "[X] 中继没起来，日志：$relayLog" -ForegroundColor Red
    Stop-All; exit 1
}
Write-Host "      中继 OK" -ForegroundColor Green

# ---------- 3) 隧道 ----------
$tunnelUrl = $null
if (-not (Test-Path $cf)) {
    Write-Host "[3/4] 跳过隧道：找不到 $cf" -ForegroundColor Yellow
    Write-Host "      只有局域网可用。要外网访问就把 cloudflared.exe 放到 tools\bin\ 下。" -ForegroundColor Yellow
} else {
    Write-Host "[3/4] 启动 cloudflared 隧道 ..." -ForegroundColor Cyan
    Remove-Item $tunnelLog -ErrorAction SilentlyContinue
    $tun = Start-Process $cf -ArgumentList "tunnel", "--url", "http://localhost:22006", "--no-autoupdate" `
        -WindowStyle Hidden -PassThru -RedirectStandardError $tunnelLog
    $children += $tun

    for ($i = 0; $i -lt 40 -and -not $tunnelUrl; $i++) {
        Start-Sleep -Seconds 1
        $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue
        if ($m) { $tunnelUrl = $m.Matches[0].Value }
    }
    if ($tunnelUrl) { Write-Host "      隧道 OK：$tunnelUrl" -ForegroundColor Green }
    else            { Write-Host "      [!] 40s 内没拿到隧道地址，日志：$tunnelLog" -ForegroundColor Yellow }
}

# ---------- 4) 汇总可用地址 ----------
$gw = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
      Sort-Object RouteMetric | Select-Object -First 1
$lanIp = $null
if ($gw) {
    $lanIp = (Get-NetIPAddress -InterfaceIndex $gw.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
              Select-Object -First 1).IPAddress
}

$pagesBase = $null
try {
    $remote = (git remote get-url origin 2>$null)
    if ($remote -match 'github\.com[:/]([^/]+)/([^/.]+)') {
        $pagesBase = "https://$($Matches[1]).github.io/$($Matches[2])/"
    }
} catch { }

Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host "   打开下面任一地址" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  PC 本机        : http://localhost:22006" -ForegroundColor White
if ($lanIp) {
    Write-Host "  手机(同一WiFi) : http://${lanIp}:22006" -ForegroundColor White
}
if ($tunnelUrl) {
    $th = $tunnelUrl -replace '^https://', ''
    Write-Host "  手机(任意网络) : $tunnelUrl" -ForegroundColor Green
    if ($pagesBase) {
        Write-Host "  Pages 入口     : ${pagesBase}?ip=$th" -ForegroundColor Green
    }
} else {
    Write-Host "  手机(任意网络) : 需要隧道（见上面的提示）" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  手机上打不开先等 10~20 秒再刷新（隧道要传播）" -ForegroundColor DarkGray
Write-Host "  按 Ctrl+C 退出（会一并关掉中继和隧道）" -ForegroundColor DarkGray
Write-Host ""

# ---------- 5) 守在这儿，顺便把中继日志转出来 ----------
$shown = 0
try {
    while ($true) {
        Start-Sleep -Seconds 1
        if ($relay.HasExited) { Write-Host "[!] 中继进程退出了" -ForegroundColor Red; break }
        if (Test-Path $relayLog) {
            # -Encoding UTF8：node 写的是 UTF-8 无 BOM，PS 5.1 默认按 ANSI 读会变乱码
            $lines = @(Get-Content $relayLog -Encoding UTF8 -ErrorAction SilentlyContinue)
            if ($lines.Count -gt $shown) {
                for ($i = $shown; $i -lt $lines.Count; $i++) {
                    Write-Host ("    [中继] " + $lines[$i]) -ForegroundColor DarkGray
                }
                $shown = $lines.Count
            }
        }
    }
} finally {
    Write-Host ""
    Write-Host "[退出] 正在关闭中继和隧道 ..." -ForegroundColor Yellow
    Stop-All
    Write-Host "[退出] 完成" -ForegroundColor Yellow
}
