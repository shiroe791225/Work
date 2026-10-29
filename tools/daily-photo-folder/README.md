# 每日施工照片資料夾自動建立工具

用途：在 `E:\22-1 AI資料生成區\04_每日施工照片整理` 之下，自動建立以**今天日期**命名的施工照片資料夾，並可把剛丟進母資料夾的散落照片自動搬進去。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `New-DailyPhotoFolder.ps1` | 主程式（PowerShell 5.1 以上，Windows 10/11 內建即可） |
| `3-dry-run-preview.bat` | **先跑這個**：試跑預覽，只顯示會做什麼，不動任何檔案 |
| `1-create-folder-only.bat` | 只建立今日日期資料夾 |
| `2-create-folder-and-move-photos.bat` | 建立今日日期資料夾 + 搬入母資料夾第一層的照片/影片 |

## 安裝（一次性）

1. 把這 4 個檔案複製到 `E:\22-1 AI資料生成區\04_每日施工照片整理\_工具\`（或任一固定位置，4 個檔案需放在同一層）。
2. 需要的話，在桌面建立 `2-create-folder-and-move-photos.bat` 的捷徑，之後每天雙擊即可。

> 若出現「指令碼無法載入，因為這個系統上已停用指令碼執行」：請一律透過 `.bat` 啟動（已內建 `-ExecutionPolicy Bypass`），不需要變更系統原本的執行原則。

## 日常操作流程

1. 把當日現場照片丟進 `04_每日施工照片整理`（母資料夾第一層）。
2. 雙擊 `2-create-folder-and-move-photos.bat`。
3. 完成後自動開啟 `20261029` 這類日期資料夾，照片已在其中。
4. 所有動作寫入母資料夾的 `_整理紀錄.log`，可供品管追溯。

## 常用參數（直接用 PowerShell 執行時）

```powershell
# 只建立今日資料夾
.\New-DailyPhotoFolder.ps1

# 試跑，不動檔案
.\New-DailyPhotoFolder.ps1 -MovePhotos -WhatIf

# 民國年命名：1151029
.\New-DailyPhotoFolder.ps1 -Format ROC

# 加上後綴：20261029_施工照片
.\New-DailyPhotoFolder.ps1 -Suffix '施工照片'

# 一併建立子資料夾 01_原始照片 / 02_已篩選 / 03_成果報告 / 04_其他
.\New-DailyPhotoFolder.ps1 -WithSubfolders -MovePhotos

# 補建前幾天的資料夾
.\New-DailyPhotoFolder.ps1 -Date '2026-10-27'

# 只搬「檔案時間 = 當日」的檔案
.\New-DailyPhotoFolder.ps1 -MovePhotos -OnlyToday

# 換母資料夾路徑
.\New-DailyPhotoFolder.ps1 -Root 'D:\其他專案\施工照片'
```

## 設為每日自動執行（選用）

在**系統管理員權限**的 PowerShell 執行一次（以每日 07:30 建立當日資料夾為例）：

```powershell
$ps1 = 'E:\22-1 AI資料生成區\04_每日施工照片整理\_工具\New-DailyPhotoFolder.ps1'
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
           -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At 07:30
Register-ScheduledTask -TaskName '每日施工照片資料夾' -Action $action -Trigger $trigger -Description '每日建立當日施工照片資料夾'
```

> 建議排程**只建立資料夾、不自動搬檔**（如上），搬檔仍由人工雙擊 `.bat` 執行，避免無人監看時誤搬檔案。

## 安全設計（重要）

- **不覆蓋**：日期資料夾已存在 → 略過建立；檔名重複 → 自動改為 `IMG_1234_1.jpg`，絕不覆蓋。
- **搬檔需明示**：未加 `-MovePhotos` 不會動到任何檔案。
- **僅第一層**：搬檔只處理母資料夾第一層的散落檔案，不會遞迴翻動既有日期資料夾。
- **僅影音副檔名**：`.jpg .jpeg .png .heic .heif .tif .tiff .bmp .webp .gif .mp4 .mov .avi .3gp .mkv .m4v`，Excel、PDF 等文件不會被搬走。
- **可追溯**：全程寫入 `_整理紀錄.log`。

## 限制

- 僅適用 Windows（使用 PowerShell 與 `explorer.exe`）。
- 若 `E:` 為網路磁碟或外接硬碟，執行前須確認已連線掛載；未掛載時腳本會直接報錯並中止，不會誤建到別處。
- 搬檔以**副檔名**判斷，不讀 EXIF；`-OnlyToday` 依「檔案最後修改時間」判斷，若照片是從相機複製而來，該時間通常為拍攝時間。
