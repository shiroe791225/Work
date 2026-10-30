<#
.SYNOPSIS
    建立指定日期的施工照片資料夾，並把「下載」資料夾（或本腳本同層）中
    檔名符合 <日期>_*.jpg 的照片搬進去。

.DESCRIPTION
    用途：把從對話下載回來的照片，一鍵歸入 E:\...\04_每日施工照片整理\<日期>\
    安全：不覆蓋（同名自動加流水號）、不刪除、只搬移符合日期前綴的影像檔。

.PARAMETER DateFolder
    目標日期資料夾名稱，預設 20261029。

.PARAMETER Root
    母資料夾，預設 E:\22-1 AI資料生成區\04_每日施工照片整理

.PARAMETER SourceDirs
    來源資料夾清單，預設為「下載」資料夾 + 本腳本所在資料夾。

.EXAMPLE
    .\Import-PhotosToDateFolder.ps1
.EXAMPLE
    .\Import-PhotosToDateFolder.ps1 -DateFolder 20261030
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]   $DateFolder = '20261029',
    [string]   $Root       = 'E:\22-1 AI資料生成區\04_每日施工照片整理',
    [string[]] $SourceDirs
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

if (-not $SourceDirs) {
    $SourceDirs = @(
        (Join-Path $env:USERPROFILE 'Downloads'),
        $PSScriptRoot
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Write-Host "[錯誤] 找不到母資料夾：$Root" -ForegroundColor Red
    Write-Host "       請確認 ADATA SD810 (E:) 已連接，或用 -Root 指定正確路徑。" -ForegroundColor Red
    pause; exit 1
}

$target = Join-Path $Root $DateFolder
if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    New-Item -ItemType Directory -Path $target | Out-Null
    Write-Host "已建立資料夾：$target" -ForegroundColor Green
} else {
    Write-Host "資料夾已存在：$target" -ForegroundColor Yellow
}

$exts  = @('.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff', '.mp4', '.mov')
$found = @()
foreach ($dir in $SourceDirs) {
    Write-Host "搜尋來源：$dir"
    $found += Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like "$DateFolder*" -and $exts -contains $_.Extension.ToLower() }
}
$found = $found | Sort-Object FullName -Unique

if (-not $found) {
    Write-Host ''
    Write-Host "找不到檔名以 $DateFolder 開頭的照片。" -ForegroundColor Yellow
    Write-Host "請先把對話中的 6 張照片下載下來（預設會存到「下載」資料夾），再執行一次。"
    pause; exit 0
}

$moved = 0
foreach ($f in $found) {
    $dest = Join-Path $target $f.Name
    if (Test-Path -LiteralPath $dest) {
        $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
        $ext  = $f.Extension
        for ($i = 1; $i -lt 1000; $i++) {
            $c = Join-Path $target ('{0}_{1}{2}' -f $base, $i, $ext)
            if (-not (Test-Path -LiteralPath $c)) { $dest = $c; break }
        }
    }
    Move-Item -LiteralPath $f.FullName -Destination $dest
    Write-Host ("  搬入：{0}" -f ([IO.Path]::GetFileName($dest))) -ForegroundColor Green
    $moved++
}

Write-Host ''
Write-Host ("完成：共搬入 {0} 個檔案 -> {1}" -f $moved, $target) -ForegroundColor Green
Start-Process explorer.exe $target
pause
