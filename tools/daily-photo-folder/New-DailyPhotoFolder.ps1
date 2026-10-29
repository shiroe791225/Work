<#
.SYNOPSIS
    在「每日施工照片整理」母資料夾下，建立以今天日期命名的施工照片資料夾，
    並可選擇把剛丟進母資料夾的照片/影片自動搬入該日期資料夾。

.DESCRIPTION
    設計原則：
      1. 可重複執行（idempotent）：資料夾已存在不會報錯、不會覆蓋。
      2. 搬檔預設關閉，必須加 -MovePhotos 才會動到檔案（避免誤搬）。
      3. 支援 -WhatIf 先試跑，確認動作後再正式執行。
      4. 檔名衝突時自動加流水號 _1、_2…，絕不覆蓋既有檔案。
      5. 全程寫入 _整理紀錄.log，便於品管追溯。

.PARAMETER Root
    母資料夾路徑。預設 E:\22-1 AI資料生成區\04_每日施工照片整理

.PARAMETER Format
    日期資料夾命名格式：
      YYYYMMDD    → 20261029          （預設，排序最穩）
      YYYY-MM-DD  → 2026-10-29
      ROC         → 1151029           （民國年）
      ROC-DASH    → 115-10-29

.PARAMETER Suffix
    日期後附加文字，例如 -Suffix '施工照片' → 20261029_施工照片

.PARAMETER Date
    指定日期（補建前幾天的資料夾用），例如 -Date '2026-10-27'。預設今天。

.PARAMETER WithSubfolders
    一併建立固定子資料夾（01_原始照片 / 02_已篩選 / 03_成果報告 / 04_其他）。

.PARAMETER MovePhotos
    將母資料夾「第一層」的散落照片/影片搬入新建的日期資料夾。

.PARAMETER OnlyToday
    搭配 -MovePhotos：只搬「檔案時間 = 目標日期」的檔案。

.PARAMETER Open
    完成後用檔案總管開啟該資料夾。

.EXAMPLE
    .\New-DailyPhotoFolder.ps1
    只建立 20261029 資料夾。

.EXAMPLE
    .\New-DailyPhotoFolder.ps1 -MovePhotos -WhatIf
    試跑：顯示會搬哪些檔案，但不實際執行。

.EXAMPLE
    .\New-DailyPhotoFolder.ps1 -MovePhotos -WithSubfolders -Open
    建立資料夾+子資料夾、搬入照片、並開啟資料夾。
#>
#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $Root = 'E:\22-1 AI資料生成區\04_每日施工照片整理',

    [ValidateSet('YYYYMMDD', 'YYYY-MM-DD', 'ROC', 'ROC-DASH')]
    [string] $Format = 'YYYYMMDD',

    [string] $Suffix = '',

    [datetime] $Date = (Get-Date),

    [switch] $WithSubfolders,
    [switch] $MovePhotos,
    [switch] $OnlyToday,
    [switch] $Open
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---- 可調整區 ---------------------------------------------------------------
$MediaExtensions = @(
    '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.webp', '.gif',
    '.mp4', '.mov', '.avi', '.3gp', '.mkv', '.m4v'
)
$SubfolderNames = @('01_原始照片', '02_已篩選', '03_成果報告', '04_其他')
# ---------------------------------------------------------------------------

function Get-DateFolderName {
    param([datetime] $D, [string] $Fmt, [string] $Sfx)

    switch ($Fmt) {
        'YYYYMMDD'   { $name = $D.ToString('yyyyMMdd') }
        'YYYY-MM-DD' { $name = $D.ToString('yyyy-MM-dd') }
        'ROC'        { $name = '{0:000}{1:MMdd}' -f ($D.Year - 1911), $D }
        'ROC-DASH'   { $name = '{0:000}-{1:MM-dd}' -f ($D.Year - 1911), $D }
    }
    if ($Sfx) { $name = '{0}_{1}' -f $name, $Sfx.Trim() }
    return $name
}

function Get-UniquePath {
    # 目標檔名已存在時，回傳 xxx_1.jpg / xxx_2.jpg …
    param([string] $Directory, [string] $FileName)

    $target = Join-Path $Directory $FileName
    if (-not (Test-Path -LiteralPath $target)) { return $target }

    $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext  = [System.IO.Path]::GetExtension($FileName)
    for ($i = 1; $i -lt 10000; $i++) {
        $candidate = Join-Path $Directory ('{0}_{1}{2}' -f $base, $i, $ext)
        if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    throw "無法為 $FileName 產生不重複檔名"
}

# ---- 1. 檢查母資料夾 --------------------------------------------------------
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Write-Host "[錯誤] 找不到母資料夾：$Root" -ForegroundColor Red
    Write-Host "       請確認磁碟機 E: 已連接、路徑正確，或用 -Root 指定其他路徑。" -ForegroundColor Red
    exit 1
}

$folderName = Get-DateFolderName -D $Date -Fmt $Format -Sfx $Suffix
$targetDir  = Join-Path $Root $folderName
$logPath    = Join-Path $Root '_整理紀錄.log'

function Write-Log {
    param([string] $Message)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch { }
}

Write-Log "=== 開始：母資料夾 = $Root ==="

# ---- 2. 建立日期資料夾 ------------------------------------------------------
if (Test-Path -LiteralPath $targetDir -PathType Container) {
    Write-Log "資料夾已存在，略過建立：$folderName"
} else {
    if ($PSCmdlet.ShouldProcess($targetDir, '建立資料夾')) {
        New-Item -ItemType Directory -Path $targetDir | Out-Null
        Write-Log "已建立資料夾：$folderName"
    }
}

# ---- 3. 建立子資料夾（選用） ------------------------------------------------
if ($WithSubfolders) {
    foreach ($sub in $SubfolderNames) {
        $subPath = Join-Path $targetDir $sub
        if (Test-Path -LiteralPath $subPath -PathType Container) { continue }
        if ($PSCmdlet.ShouldProcess($subPath, '建立子資料夾')) {
            New-Item -ItemType Directory -Path $subPath | Out-Null
            Write-Log "  已建立子資料夾：$folderName\$sub"
        }
    }
}

# ---- 4. 搬移散落照片（選用） ------------------------------------------------
if ($MovePhotos) {
    $candidates = Get-ChildItem -LiteralPath $Root -File |
        Where-Object { $MediaExtensions -contains $_.Extension.ToLower() }

    if ($OnlyToday) {
        $d0 = $Date.Date
        $candidates = $candidates | Where-Object { $_.LastWriteTime.Date -eq $d0 }
    }

    if (-not $candidates) {
        Write-Log '母資料夾第一層沒有需要搬移的照片/影片。'
    } else {
        Write-Log ("待搬移檔案：{0} 個" -f @($candidates).Count)
        $destRoot = if ($WithSubfolders) { Join-Path $targetDir $SubfolderNames[0] } else { $targetDir }

        $moved = 0; $failed = 0
        foreach ($f in $candidates) {
            $dest = Get-UniquePath -Directory $destRoot -FileName $f.Name
            if ($PSCmdlet.ShouldProcess($f.FullName, "搬移至 $dest")) {
                try {
                    Move-Item -LiteralPath $f.FullName -Destination $dest
                    $moved++
                    if ($dest -ne (Join-Path $destRoot $f.Name)) {
                        Write-Log ("  搬移（更名避免覆蓋）：{0} -> {1}" -f $f.Name, [System.IO.Path]::GetFileName($dest))
                    }
                } catch {
                    $failed++
                    Write-Log ("  [失敗] {0}：{1}" -f $f.Name, $_.Exception.Message)
                }
            }
        }
        Write-Log ("搬移完成：成功 {0} 個、失敗 {1} 個" -f $moved, $failed)
    }
}

# ---- 5. 收尾 ---------------------------------------------------------------
Write-Log "=== 結束：$targetDir ==="
Write-Host ''
Write-Host "完成，資料夾路徑：$targetDir" -ForegroundColor Green

if ($Open -and -not $WhatIfPreference) {
    Start-Process explorer.exe $targetDir
}
