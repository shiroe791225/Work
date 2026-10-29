<#
.SYNOPSIS
    常駐監看「每日施工照片整理」母資料夾，照片一丟進來就自動搬入當日日期資料夾。

.DESCRIPTION
    設計重點（施工照片屬工程紀錄，優先保證「不遺失、不覆蓋、可追溯」）：

      1. 採「輪詢掃描」而非 FileSystemWatcher
         ── 不漏事件、不受事件風暴影響、重開機後行為一致，最穩。

      2. 檔案穩定性檢查（最重要）
         ── 必須連續兩次掃描的「大小 + 修改時間」完全相同，且能以獨占模式開啟
            （代表無人正在寫入），才會搬動。避免搬到「複製中」的半截檔案。

      3. 絕不覆蓋、絕不刪除
         ── 同名且內容相同（SHA256 相同）→ 搬到 `_重複檔案` 子夾保留。
         ── 同名但內容不同          → 自動改名 `IMG_1234_1.jpg`。

      4. 只處理母資料夾「第一層」
         ── 不遞迴，既有日期資料夾內的檔案永不被動到。

      5. 只處理影像／影片副檔名
         ── Excel、PDF、Word 等文件不會被搬走。

      6. 全程寫入 `_自動歸檔紀錄.log`，含時間、原檔名、目的路徑、結果。

      7. 單一實例鎖（Mutex）
         ── 避免同時跑兩份監看程式互搶檔案。

.PARAMETER Root
    母資料夾。預設 E:\22-1 AI資料生成區\04_每日施工照片整理

.PARAMETER Format
    日期資料夾命名：YYYYMMDD（預設）/ YYYY-MM-DD / ROC（1151029）/ ROC-DASH（115-10-29）

.PARAMETER Suffix
    日期後附加文字，例如 -Suffix '施工照片' → 20261029_施工照片

.PARAMETER DateSource
    決定檔案該歸到哪一天的資料夾：
      Today    （預設）一律歸入「執行當天」。最可預期，符合「今天拍、今天丟」的作業流程。
      FileTime 依檔案最後修改時間。適合一次補丟多天份的照片。
      Exif     依 EXIF 拍攝時間（影片用編碼時間），取不到時自動退回 FileTime。

.PARAMETER DateTakenOffsetHours
    搭配 -DateSource Exif：若發現歸檔日期固定差一天（Windows 時區處理問題），
    用此參數校正，例如 -DateTakenOffsetHours 8。

.PARAMETER IntervalSeconds
    掃描間隔秒數，預設 10。

.PARAMETER StableSeconds
    檔案需「大小與修改時間不變」達幾秒才搬，預設 5。
    走網路磁碟或大量 RAW/影片時建議調大（例如 20）。

.PARAMETER WithSubfolders
    日期資料夾下建立 01_原始照片 / 02_已篩選 / 03_成果報告 / 04_其他，
    且照片一律搬入 01_原始照片。

.PARAMETER RunOnce
    只掃一次就結束（給「工作排程器」定時呼叫用，不常駐）。
    注意：單次執行時，穩定性判定改為「就地等待 StableSeconds 後複查」。

.EXAMPLE
    .\Watch-DailyPhotoFolder.ps1
    常駐監看，照片自動歸入當日資料夾。Ctrl+C 停止。

.EXAMPLE
    .\Watch-DailyPhotoFolder.ps1 -RunOnce -WhatIf
    試跑一次：只顯示會搬哪些檔案，不實際動檔。

.EXAMPLE
    .\Watch-DailyPhotoFolder.ps1 -DateSource Exif -WithSubfolders
    依拍攝日期歸檔，並放進 01_原始照片。
#>
#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $Root = 'E:\22-1 AI資料生成區\04_每日施工照片整理',

    [ValidateSet('YYYYMMDD', 'YYYY-MM-DD', 'ROC', 'ROC-DASH')]
    [string] $Format = 'YYYYMMDD',

    [string] $Suffix = '',

    [ValidateSet('Today', 'FileTime', 'Exif')]
    [string] $DateSource = 'Today',

    [int] $DateTakenOffsetHours = 0,

    [ValidateRange(2, 3600)]
    [int] $IntervalSeconds = 10,

    [ValidateRange(0, 600)]
    [int] $StableSeconds = 5,

    [switch] $WithSubfolders,
    [switch] $RunOnce
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---- 可調整區 ---------------------------------------------------------------
$MediaExtensions = @(
    '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.webp', '.gif',
    '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2',
    '.mp4', '.mov', '.avi', '.3gp', '.mkv', '.m4v', '.mts', '.m2ts'
)
$SubfolderNames  = @('01_原始照片', '02_已篩選', '03_成果報告', '04_其他')
$DupFolderName   = '_重複檔案'
$LogFileName     = '_自動歸檔紀錄.log'
$MaxRetryPerFile = 5          # 同一檔案連續失敗幾次後放棄並提醒人工處理
$HeartbeatMin    = 60         # 每幾分鐘寫一次「仍在運行」心跳
# ---------------------------------------------------------------------------

$script:LogPath = Join-Path $Root $LogFileName

function Write-Log {
    param(
        [string] $Message,
        [ValidateSet('INFO', 'MOVE', 'WARN', 'FAIL')] [string] $Level = 'INFO'
    )
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    switch ($Level) {
        'MOVE' { Write-Host $line -ForegroundColor Green }
        'WARN' { Write-Host $line -ForegroundColor Yellow }
        'FAIL' { Write-Host $line -ForegroundColor Red }
        default { Write-Host $line }
    }
    try { Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8 } catch { }
}

function Get-DateFolderName {
    param([datetime] $D)
    switch ($Format) {
        'YYYYMMDD'   { $name = $D.ToString('yyyyMMdd') }
        'YYYY-MM-DD' { $name = $D.ToString('yyyy-MM-dd') }
        'ROC'        { $name = '{0:000}{1:MMdd}' -f ($D.Year - 1911), $D }
        'ROC-DASH'   { $name = '{0:000}-{1:MM-dd}' -f ($D.Year - 1911), $D }
    }
    if ($Suffix) { $name = '{0}_{1}' -f $name, $Suffix.Trim() }
    return $name
}

function Get-CaptureDate {
    # 依 -DateSource 決定檔案歸屬日期
    param([System.IO.FileInfo] $File)

    if ($DateSource -eq 'Today')    { return (Get-Date).Date }
    if ($DateSource -eq 'FileTime') { return $File.LastWriteTime.Date }

    # Exif：以 Shell 屬性名稱讀取（不依賴欄位索引，跨 Windows 版本較穩）
    try {
        $shell  = New-Object -ComObject Shell.Application
        $folder = $shell.Namespace($File.DirectoryName)
        $item   = $folder.ParseName($File.Name)
        foreach ($prop in @('System.Photo.DateTaken', 'System.Media.DateEncoded')) {
            $v = $item.ExtendedProperty($prop)
            if ($v -is [datetime]) {
                return ([datetime]$v).AddHours($DateTakenOffsetHours).Date
            }
        }
    } catch {
        Write-Log ("讀取 EXIF 失敗，改用檔案時間：{0}（{1}）" -f $File.Name, $_.Exception.Message) 'WARN'
    } finally {
        if ($shell) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } catch { } }
    }
    return $File.LastWriteTime.Date
}

function Test-FileUnlocked {
    # 能以「不允許共用」模式開啟 → 代表沒有程式正在寫入
    param([string] $Path)
    try {
        $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open,
                                     [System.IO.FileAccess]::Read,
                                     [System.IO.FileShare]::None)
        $fs.Close(); $fs.Dispose()
        return $true
    } catch { return $false }
}

function Get-Sha256 {
    param([string] $Path)
    try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash } catch { return $null }
}

function Get-UniquePath {
    param([string] $Directory, [string] $FileName)
    $target = Join-Path $Directory $FileName
    if (-not (Test-Path -LiteralPath $target)) { return $target }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext  = [System.IO.Path]::GetExtension($FileName)
    for ($i = 1; $i -lt 10000; $i++) {
        $c = Join-Path $Directory ('{0}_{1}{2}' -f $base, $i, $ext)
        if (-not (Test-Path -LiteralPath $c)) { return $c }
    }
    throw "無法為 $FileName 產生不重複檔名"
}

function Resolve-TargetDirectory {
    # 建立（必要時）並回傳該檔案應歸入的資料夾
    param([datetime] $D)

    $dir = Join-Path $Root (Get-DateFolderName -D $D)
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        if ($PSCmdlet.ShouldProcess($dir, '建立日期資料夾')) {
            New-Item -ItemType Directory -Path $dir | Out-Null
            Write-Log ("已建立日期資料夾：{0}" -f (Split-Path $dir -Leaf))
        }
    }
    if ($WithSubfolders) {
        foreach ($sub in $SubfolderNames) {
            $p = Join-Path $dir $sub
            if (-not (Test-Path -LiteralPath $p -PathType Container)) {
                if ($PSCmdlet.ShouldProcess($p, '建立子資料夾')) {
                    New-Item -ItemType Directory -Path $p | Out-Null
                }
            }
        }
        return (Join-Path $dir $SubfolderNames[0])
    }
    return $dir
}

function Move-OneFile {
    param([System.IO.FileInfo] $File)

    $captureDate = Get-CaptureDate -File $File
    $destDir     = Resolve-TargetDirectory -D $captureDate
    if (-not (Test-Path -LiteralPath $destDir -PathType Container)) {
        # -WhatIf 模式下目的資料夾不會真的存在
        Write-Log ("[試跑] 將搬移 {0} -> {1}" -f $File.Name, $destDir) 'MOVE'
        return $true
    }

    $plain = Join-Path $destDir $File.Name

    if (Test-Path -LiteralPath $plain) {
        # 同名：先比內容，相同視為重複投遞，保留到 _重複檔案
        $srcHash = Get-Sha256 $File.FullName
        $dstHash = Get-Sha256 $plain
        if ($srcHash -and $dstHash -and $srcHash -eq $dstHash) {
            # -WithSubfolders 時 $destDir 是 01_原始照片，重複檔應放在其上層日期資料夾
            $dateDir = if ($WithSubfolders) { Split-Path $destDir -Parent } else { $destDir }
            $dupDir  = Join-Path $dateDir $DupFolderName
            if (-not (Test-Path -LiteralPath $dupDir -PathType Container)) {
                if ($PSCmdlet.ShouldProcess($dupDir, '建立重複檔案資料夾')) {
                    New-Item -ItemType Directory -Path $dupDir | Out-Null
                }
            }
            $dest = Get-UniquePath -Directory $dupDir -FileName $File.Name
            if ($PSCmdlet.ShouldProcess($File.FullName, "搬移（內容重複）至 $dest")) {
                Move-Item -LiteralPath $File.FullName -Destination $dest
                Write-Log ("內容重複，保留至 {0}\{1}" -f $DupFolderName, [IO.Path]::GetFileName($dest)) 'WARN'
            }
            return $true
        }
    }

    $dest = Get-UniquePath -Directory $destDir -FileName $File.Name
    if ($PSCmdlet.ShouldProcess($File.FullName, "搬移至 $dest")) {
        Move-Item -LiteralPath $File.FullName -Destination $dest
        $renamed = ($dest -ne $plain)
        Write-Log ("{0} -> {1}{2}" -f $File.Name,
                   ($dest.Substring($Root.Length).TrimStart('\')),
                   ($(if ($renamed) { '（同名不同檔，已自動改名）' } else { '' }))) 'MOVE'
    }
    return $true
}

# =============================================================================
# 主程式
# =============================================================================
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Write-Host "[錯誤] 找不到母資料夾：$Root" -ForegroundColor Red
    Write-Host "       請確認磁碟機 E: 已連接、路徑正確，或用 -Root 指定其他路徑。" -ForegroundColor Red
    exit 1
}

# 單一實例鎖
$mutexName = 'Global\DailyPhotoWatch_' +
             ([BitConverter]::ToString(
                 [Security.Cryptography.MD5]::Create().ComputeHash(
                     [Text.Encoding]::UTF8.GetBytes($Root.ToLower()))) -replace '-', '')
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) {
    Write-Host '[提醒] 已有另一個自動歸檔程式正在監看同一個資料夾，本次結束。' -ForegroundColor Yellow
    exit 0
}

$state     = @{}   # 路徑 -> @{ Size; Write; Since }
$failCount = @{}   # 路徑 -> 連續失敗次數
$giveUp    = @{}   # 已放棄、等人工處理的路徑
$lastBeat  = Get-Date

Write-Log ('=== 自動歸檔啟動 ===')
Write-Log ("母資料夾 : {0}" -f $Root)
Write-Log ("歸檔依據 : {0}   命名格式 : {1}{2}" -f $DateSource, $Format,
           $(if ($Suffix) { "_$Suffix" } else { '' }))
Write-Log ("掃描間隔 : {0} 秒   穩定判定 : {1} 秒   模式 : {2}" -f
           $IntervalSeconds, $StableSeconds, $(if ($RunOnce) { '單次' } else { '常駐（Ctrl+C 停止）' }))

try {
    do {
        try {
            $files = @(Get-ChildItem -LiteralPath $Root -File -ErrorAction Stop |
                       Where-Object {
                           ($MediaExtensions -contains $_.Extension.ToLower()) -and
                           ($_.Name -notmatch '^(~\$|\.)') -and
                           (-not $giveUp.ContainsKey($_.FullName))
                       })

            foreach ($f in $files) {
                $key = $f.FullName

                # --- 穩定性判定 ---
                $ready = $false
                if ($RunOnce) {
                    # 單次模式：就地等待後複查
                    if ($StableSeconds -gt 0) { Start-Sleep -Seconds $StableSeconds }
                    try {
                        $again = Get-Item -LiteralPath $key -ErrorAction Stop
                        $ready = ($again.Length -eq $f.Length -and $again.LastWriteTimeUtc -eq $f.LastWriteTimeUtc)
                    } catch { $ready = $false }
                } else {
                    if ($state.ContainsKey($key) -and
                        $state[$key].Size  -eq $f.Length -and
                        $state[$key].Write -eq $f.LastWriteTimeUtc) {
                        $ready = (((Get-Date) - $state[$key].Since).TotalSeconds -ge $StableSeconds)
                    } else {
                        $state[$key] = @{ Size = $f.Length; Write = $f.LastWriteTimeUtc; Since = (Get-Date) }
                        continue   # 本輪先記錄，下一輪再判定
                    }
                }
                if (-not $ready) { continue }

                # --- 鎖定判定：仍在寫入就等下一輪 ---
                if (-not (Test-FileUnlocked $key)) {
                    Write-Log ("檔案仍被占用（可能複製中），稍後重試：{0}" -f $f.Name) 'WARN'
                    $state.Remove($key)
                    continue
                }

                # --- 搬移 ---
                try {
                    [void](Move-OneFile -File $f)
                    $state.Remove($key)
                    $failCount.Remove($key)
                } catch {
                    $n = 1 + [int]$failCount[$key]
                    $failCount[$key] = $n
                    Write-Log ("搬移失敗（第 {0} 次）：{1}｜{2}" -f $n, $f.Name, $_.Exception.Message) 'FAIL'
                    if ($n -ge $MaxRetryPerFile) {
                        $giveUp[$key] = $true
                        Write-Log ("已連續失敗 {0} 次，停止重試並略過，請人工檢查：{1}" -f $n, $f.Name) 'FAIL'
                    }
                    $state.Remove($key)
                }
            }

            # 清掉已不存在的追蹤紀錄
            foreach ($k in @($state.Keys)) {
                if (-not (Test-Path -LiteralPath $k)) { $state.Remove($k) }
            }
        } catch {
            Write-Log ("掃描發生錯誤，將於下一輪重試：{0}" -f $_.Exception.Message) 'FAIL'
        }

        if ($RunOnce) { break }

        if (((Get-Date) - $lastBeat).TotalMinutes -ge $HeartbeatMin) {
            Write-Log '監看中（無新檔案）'
            $lastBeat = Get-Date
        }
        Start-Sleep -Seconds $IntervalSeconds
    } while ($true)
} finally {
    Write-Log '=== 自動歸檔結束 ==='
    try { $mutex.ReleaseMutex() } catch { }
    try { $mutex.Dispose() }     catch { }
}
