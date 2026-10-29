<#
.SYNOPSIS
    把「每日施工照片自動歸檔」註冊為 Windows 工作排程器任務：登入後自動啟動、
    每 15 分鐘自我檢查（掉了會自動重啟），並且不會重複開啟多份。

.PARAMETER Root
    母資料夾。預設 E:\22-1 AI資料生成區\04_每日施工照片整理

.PARAMETER TaskName
    排程任務名稱，預設「每日施工照片自動歸檔」。

.PARAMETER DateSource
    傳給監看程式：Today（預設）/ FileTime / Exif

.PARAMETER WithSubfolders
    傳給監看程式：建立固定子資料夾並歸入 01_原始照片。

.PARAMETER Uninstall
    移除排程任務。

.EXAMPLE
    .\Install-AutoArchiveTask.ps1
.EXAMPLE
    .\Install-AutoArchiveTask.ps1 -Uninstall
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string] $Root     = 'E:\22-1 AI資料生成區\04_每日施工照片整理',
    [string] $TaskName = '每日施工照片自動歸檔',
    [ValidateSet('Today', 'FileTime', 'Exif')] [string] $DateSource = 'Today',
    [switch] $WithSubfolders,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask    -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "已移除排程任務：$TaskName" -ForegroundColor Green
    } else {
        Write-Host "找不到排程任務：$TaskName（可能已移除）" -ForegroundColor Yellow
    }
    return
}

$ps1 = Join-Path $PSScriptRoot 'Watch-DailyPhotoFolder.ps1'
if (-not (Test-Path -LiteralPath $ps1)) {
    Write-Host "[錯誤] 找不到 Watch-DailyPhotoFolder.ps1，請與本檔放在同一個資料夾。" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Write-Host "[錯誤] 找不到母資料夾：$Root" -ForegroundColor Red
    exit 1
}

$argList = @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $ps1),
    '-Root', ('"{0}"' -f $Root),
    '-DateSource', $DateSource
)
if ($WithSubfolders) { $argList += '-WithSubfolders' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($argList -join ' ')

# 觸發條件 1：登入時啟動
$t1 = New-ScheduledTaskTrigger -AtLogOn
# 觸發條件 2：每 15 分鐘嘗試啟動一次（搭配 IgnoreNew → 已在跑就忽略，掉了就自動補啟）
$t2 = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(2)) `
        -RepetitionInterval (New-TimeSpan -Minutes 15) `
        -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($t1, $t2) `
    -Settings $settings -Principal $principal `
    -Description '監看每日施工照片整理資料夾，照片丟入後自動歸入當日日期資料夾。' | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host "已註冊並啟動排程任務：$TaskName" -ForegroundColor Green
Write-Host "  監看資料夾 : $Root"
Write-Host "  歸檔依據   : $DateSource"
Write-Host "  紀錄檔     : $(Join-Path $Root '_自動歸檔紀錄.log')"
Write-Host ''
Write-Host '驗證方式：丟一張測試照片進母資料夾，約 20-30 秒後應自動消失並出現在當日資料夾。'
Write-Host '移除方式：執行 .\Install-AutoArchiveTask.ps1 -Uninstall'
