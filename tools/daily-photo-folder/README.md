# 每日施工照片自動歸檔工具

母資料夾：`E:\22-1 AI資料生成區\04_每日施工照片整理`

**照片丟進母資料夾 → 自動建立當日日期資料夾 → 自動把照片搬進去**，全程無須點擊。

---

## 一、檔案說明

| 檔案 | 用途 |
|---|---|
| `Watch-DailyPhotoFolder.ps1` | **自動歸檔主程式**（常駐監看） |
| `Install-AutoArchiveTask.ps1` | 註冊／移除 Windows 排程任務（開機登入即自動啟動） |
| `New-DailyPhotoFolder.ps1` | 手動版主程式（只建資料夾／手動搬檔） |
| `3-dry-run-preview.bat` | **先跑這個**：試跑預覽，不建資料夾、不動檔案 |
| `4-start-auto-archive-now.bat` | 立刻啟動自動歸檔（有視窗，看得到即時訊息） |
| `5-install-auto-archive-at-logon.bat` | 安裝為開機自動執行（背景隱藏執行） |
| `6-uninstall-auto-archive.bat` | 移除開機自動執行 |
| `1-create-folder-only.bat` | 手動：只建立今日資料夾 |
| `2-create-folder-and-move-photos.bat` | 手動：建資料夾 + 搬檔（一次性） |

---

## 二、安裝步驟（一次性，約 3 分鐘）

1. 把**整個資料夾的所有檔案**複製到
   `E:\22-1 AI資料生成區\04_每日施工照片整理\_工具\`
   （所有檔案必須放在同一層，`.bat` 會自動找同層的 `.ps1`）

2. **先試跑**：丟 2～3 張測試照片進母資料夾 → 雙擊 `3-dry-run-preview.bat`
   → 確認畫面顯示的目的路徑正確（不會動到任何檔案）。

3. **實測一次**：雙擊 `4-start-auto-archive-now.bat`
   → 約 20～30 秒後，測試照片會自動消失並出現在 `20261029` 資料夾中。
   → 確認無誤後關閉視窗。

4. **設為長期自動**：對 `5-install-auto-archive-at-logon.bat`
   按右鍵 →「以系統管理員身分執行」。
   之後每次登入 Windows 會自動在背景啟動，不需要再開視窗。

> 若出現「指令碼無法載入，因為這個系統上已停用指令碼執行」：
> 請一律透過 `.bat` 啟動（已內建 `-ExecutionPolicy Bypass`），**不需要**變更系統原本的執行原則。

---

## 三、日常作業流程

1. 現場照片用任何方式丟進 `04_每日施工照片整理`（母資料夾第一層）。
2. 約 20～30 秒內自動歸入 `20261029` 這類當日資料夾。
3. 要稽核時看母資料夾的 `_自動歸檔紀錄.log`：每筆都有時間、原檔名、目的路徑、結果。

**拖到一半會不會被搬走？不會。** 程式要求檔案「大小與修改時間連續兩次掃描完全相同」
且「能以獨占模式開啟（代表沒有程式正在寫入）」才會搬，半截檔案會留在原地等下一輪。

---

## 四、關鍵參數

### 歸檔日期依據 `-DateSource`

| 值 | 行為 | 適用情境 |
|---|---|---|
| `Today`（**預設**） | 一律歸入「程式執行當天」 | 今天拍、今天丟。最可預期，**建議維持預設** |
| `FileTime` | 依檔案最後修改時間 | 一次補丟多天份的照片 |
| `Exif` | 依 EXIF 拍攝時間（影片用編碼時間），讀不到自動退回 `FileTime` | 混合多天、且確定 EXIF 完整 |

安裝時指定（例如改用拍攝日期）：

```powershell
.\Install-AutoArchiveTask.ps1 -DateSource Exif
```

### 其他常用參數

```powershell
# 民國年命名：1151029
.\Watch-DailyPhotoFolder.ps1 -Format ROC

# 加後綴：20261029_施工照片
.\Watch-DailyPhotoFolder.ps1 -Suffix '施工照片'

# 一併建立子資料夾，照片歸入 01_原始照片
.\Watch-DailyPhotoFolder.ps1 -WithSubfolders

# 網路磁碟或大量 RAW/影片 → 加大穩定判定秒數（預設 5）
.\Watch-DailyPhotoFolder.ps1 -StableSeconds 20

# 掃描間隔（預設 10 秒）
.\Watch-DailyPhotoFolder.ps1 -IntervalSeconds 30

# 不常駐，只掃一次就結束（給排程器定時呼叫）
.\Watch-DailyPhotoFolder.ps1 -RunOnce

# EXIF 歸檔固定差一天時校正時區
.\Watch-DailyPhotoFolder.ps1 -DateSource Exif -DateTakenOffsetHours 8

# 換母資料夾
.\Watch-DailyPhotoFolder.ps1 -Root 'D:\其他專案\施工照片'
```

---

## 五、安全設計（工程紀錄不可遺失，這段請務必確認）

| 風險 | 本工具的處理方式 |
|---|---|
| 搬到複製中的半截檔案 | 需「大小+修改時間連續兩輪不變」**且**可獨占開啟，才搬 |
| 覆蓋既有照片 | **絕不覆蓋**。同名不同檔 → 自動改名 `IMG_1234_1.jpg` |
| 重複丟同一批照片 | 比對 SHA256，內容相同 → 搬到 `_重複檔案` 子夾**保留**，不刪除 |
| 誤搬文件檔 | 只處理影像／影片副檔名；Excel、PDF、Word 完全不動 |
| 翻動既有日期資料夾 | 只掃母資料夾**第一層**，不遞迴 |
| 磁碟未掛載時誤建到別處 | 母資料夾不存在即報錯中止 |
| 同時跑兩份程式互搶檔案 | Mutex 單一實例鎖 + 排程 `IgnoreNew` |
| 某檔案反覆失敗塞住流程 | 同檔連續失敗 5 次後略過並在 log 標註，請人工處理 |
| 程式當掉沒人發現 | 排程每 15 分鐘嘗試啟動一次，掉了自動補啟；log 每小時寫心跳 |
| 刪除檔案 | **本工具任何情況下都不刪除檔案**，只搬移 |

處理的副檔名：
`.jpg .jpeg .png .heic .heif .tif .tiff .bmp .webp .gif`
`.dng .cr2 .cr3 .nef .arw .raf .orf .rw2`
`.mp4 .mov .avi .3gp .mkv .m4v .mts .m2ts`

要增減類型：修改 `Watch-DailyPhotoFolder.ps1` 開頭「可調整區」的 `$MediaExtensions`。

---

## 六、限制與前提

- **僅適用 Windows**（PowerShell 5.1 以上，Win10/11 內建即可）。
- **需使用者登入**：監看程式在使用者工作階段執行；若 `E:` 是外接或網路磁碟，
  未登入或未掛載時不會運作（也不會誤建到其他位置）。
- **`-DateSource Exif` 的限制**：Windows 讀 `System.Photo.DateTaken` 在部分版本
  會有時區位移，可能造成跨午夜照片歸錯一天。若發現固定差一天，用
  `-DateTakenOffsetHours` 校正，或改回預設 `Today`。
- **LINE 傳來的照片**：多數情況 EXIF 已被移除、檔案時間為下載時間，
  因此預設 `Today` 是較安全的選擇。
- **即時性約 20～30 秒**（掃描 10 秒 + 穩定判定 5 秒 + 搬檔），非毫秒級。
  這是為了避開「複製中」的檔案，刻意的取捨。
- **`_重複檔案` 需定期人工清理**，程式不會自動刪。

---

## 七、故障排除

| 現象 | 檢查方向 |
|---|---|
| 照片沒被搬走 | 看 `_自動歸檔紀錄.log` 最後幾行；確認排程任務「每日施工照片自動歸檔」為「執行中」 |
| log 出現「檔案仍被占用」 | 正常現象，仍在複製中，下一輪會重試；若持續不消失，檢查是否有預覽程式鎖住檔案 |
| 排程任務沒啟動 | 工作排程器 → 找該任務 → 右鍵「執行」，看歷史記錄錯誤碼 |
| 檔案被改名成 `_1` | 代表目的資料夾已有同名但**內容不同**的檔案，這是防覆蓋的正常行為 |
| 想暫停自動歸檔 | 雙擊 `6-uninstall-auto-archive.bat`，或在工作排程器停用該任務 |
