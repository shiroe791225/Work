# 現場回報系統（Field Report System）

工地現場缺失回報與改善追蹤的單頁網站：**免登入、手機直接拍照回報、照片框選標示、改善回報、驗收、產出 PDF 報告**。

前端為純 HTML / CSS / JavaScript（無框架、無建置流程），可直接放 GitHub Pages；
後端可選用 Google Apps Script（Google Sheets + Drive），零伺服器成本。

---

## 1. 功能一覽

| 分頁 | 功能 |
| --- | --- |
| 新增回報 | 回報人、專案、回報類型、現場位置、嚴重程度、內容；拍照或選相簿；照片可畫紅框標示缺失、移動／縮放／復原；送出時自動蓋日期 |
| 改善回報 | 從「待改善」清單挑選項目、顯示原缺失資料與改善前照片、填改善說明、上傳改善後照片 |
| 回報清單 | 統計（總數／待改善／已改善／已驗收／逾期）、狀態與類型篩選、關鍵字搜尋、展開照片、產生「缺失改善報告」與「驗收單」 |

自動化欄位：

- **改善負責人**：依回報類型的大分類自動帶入（例：機電 → 雄菱工程）
- **施作廠商**：依回報類型自動帶入，可手動覆寫
- **改善期限**：開立日 + 7 天（可在設定檔調整）
- **表單編號**：`FR-20261106-001`（每日流水號）
- **狀態流程**：`待改善` → `已改善`（改善回報）→ `已驗收`（產生驗收單時輸入驗收人）

---

## 2. 檔案結構

```
.
├── index.html            # 單頁介面（三個分頁）
├── assets/
│   ├── config.js         # ★ 唯一需要修改的設定檔
│   ├── styles.css        # 樣式（現場可讀性、觸控 >= 44px）
│   └── app.js            # 主程式（照片編輯、表單、清單、API）
└── apps-script/
    └── Code.gs           # Google Apps Script 後端（Sheets + Drive + PDF）
```

---

## 3. 兩種執行模式

| 模式 | 設定方式 | 資料存放 | 適用情境 |
| --- | --- | --- | --- |
| **本機示範模式**（預設） | `APPS_SCRIPT_URL: ""` | 這台裝置的瀏覽器（IndexedDB） | 先試流程、簡報示範；**資料不會同步，換手機就看不到** |
| **雲端模式** | 填入 Apps Script `/exec` 網址 | Google Sheets + Drive | 正式使用、多人共用 |

> 現在直接打開 `index.html` 就能完整操作（含 PDF 列印版），不需要先架後端。

---

## 4. 部署步驟

### 步驟 A：發佈前端到 GitHub Pages

1. 將本專案推上 GitHub。
2. GitHub 專案頁 → **Settings → Pages**。
3. Source 選 **Deploy from a branch**，Branch 選你的分支、資料夾選 `/ (root)`，按 Save。
4. 約 1 分鐘後取得網址：`https://<帳號>.github.io/<專案名>/`

手機請用「加到主畫面」建立捷徑，開啟後就像 App 一樣。

### 步驟 B：建立 Google Apps Script 後端（要多人共用才需要）

1. 開 <https://script.google.com> → **新增專案**。
2. 刪除預設的 `Code.gs` 內容，貼上本專案 `apps-script/Code.gs` 全部內容 → 儲存。
3. 函式選單選 `setup` → **執行** → 依提示授權（會要求 Drive / Sheets 權限）。
   - 執行完成後，於「執行紀錄」可看到自動建立的試算表與資料夾網址。
4. 右上 **部署 → 新增部署作業 → 選取類型：網頁應用程式**
   - 說明：`v1`
   - **執行身分：我**
   - **具有存取權的使用者：任何人**　←（少了這個前端會拿不到 JSON）
5. 複製部署網址（結尾為 `/exec`）。
6. 編輯 `assets/config.js`：

   ```js
   APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfyc.../exec",
   ```

7. commit + push，等 GitHub Pages 更新，標頭會顯示「雲端模式」。

> 之後若修改 `Code.gs`，必須再執行一次「部署 → 管理部署作業 → 編輯 → 版本：新版本」，否則線上仍是舊版。

---

## 5. 自訂設定（`assets/config.js`）

```js
SYSTEM_NAME: "現場回報系統",     // 標頭與瀏覽器標題
DEFAULT_PROJECT: "亞灣社宅",     // 專案名稱預設值
APPS_SCRIPT_URL: "",             // 留空 = 本機示範模式
DUE_DAYS: 7,                     // 改善期限 = 開立日 + N 天
MAX_IMAGE_SIZE: 1600,            // 照片長邊上限 px
JPEG_QUALITY: 0.78,              // 照片壓縮品質
STAMP_DATE: true,                // 是否蓋日期戳記
SEVERITIES: ["一般", "重要", "緊急"],
```

### 新增／修改工程項目

```js
CATEGORIES: [
  { group: "機電", label: "機電-弱電工程",   vendor: "" },
  { group: "土建", label: "土建-泥作(玖太)", vendor: "玖太" }
],

OWNER_BY_GROUP: {
  "機電": "雄菱工程",
  "土建": "永青營造"
}
```

- `group`：大分類，用來決定「改善負責人」。新增大分類時，記得在 `OWNER_BY_GROUP` 補上對應單位。
- `label`：下拉顯示文字，同時是存進資料庫的類型全名（含廠商括號）。
- `vendor`：施作廠商，送出時一併記錄，方便依廠商統計。

---

## 6. 資料欄位（Google Sheets `Reports` 工作表）

| 欄位 | 說明 |
| --- | --- |
| `reportId` / `formNumber` | 系統唯一碼 / 表單編號 |
| `project` / `category` / `categoryGroup` / `vendor` | 專案、類型全名、大分類、廠商 |
| `location` / `description` / `severity` | 位置、缺失內容、嚴重程度 |
| `owner` / `dueDate` / `status` | 負責單位、改善期限、狀態 |
| `createdByName` / `createdAt` | 回報人、建立時間 |
| `beforePhotoId` / `beforePhotoUrl` | 改善前照片（Drive） |
| `improvementNote` / `improvedByName` / `improvedAt` | 改善說明、改善回報人、時間 |
| `afterPhotoId` / `afterPhotoUrl` | 改善後照片（Drive） |
| `acceptedByName` / `acceptedAt` | 驗收人、驗收時間 |
| `improvementPdfUrl` / `acceptancePdfUrl` | 已產生的 PDF 連結 |

需要報表時，直接在試算表上做樞紐分析或連 Looker Studio 即可。

---

## 7. 限制與注意事項

- **免登入**：任何拿到網址的人都能回報與讀取清單，姓名為自填，無身分驗證。若需控管，請改為 Google 帳號登入（Apps Script 部署改為「僅組織內使用者」）或自行加密碼閘門。
- **Apps Script 配額**：免費帳號每日執行時間約 90 分鐘、單次執行上限 6 分鐘。每天數百筆回報內通常無虞，大量照片上傳請留意。
- **照片會被壓縮**：長邊縮至 1600px、JPEG 0.78，用於缺失紀錄足夠；若需原圖存證請調整 `MAX_IMAGE_SIZE` 與 `JPEG_QUALITY`。
- **本機示範模式**資料僅存在該瀏覽器，清除瀏覽資料即消失，請勿當正式記錄使用。
- **PDF 連結**為 Drive「知道連結的任何人可檢視」，等同公開連結，請勿記錄個資。
- 照片框選座標不會另存，框線是直接燒進輸出的 JPEG，送出後無法再編輯。
