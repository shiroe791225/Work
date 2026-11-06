/* =========================================================================
 * 現場回報系統 － 設定檔
 * 這個檔案是「唯一需要修改」的設定來源，改完直接 commit 即可生效。
 * ========================================================================= */

window.CONFIG = {
  /* ---- 系統基本資料 ---- */
  SYSTEM_NAME: "現場回報系統",
  DEFAULT_PROJECT: "永青前鎮亞灣智慧公宅第一期",

  /* ---- 後端 Google Apps Script 網址 ----
   * 留空字串 = 本機示範模式（資料存在這台裝置的瀏覽器，可先測流程）
   * 填入 https://script.google.com/macros/s/..../exec = 正式雲端模式
   */
  APPS_SCRIPT_URL: "",

  /* ---- 流程參數 ---- */
  DUE_DAYS: 7,              // 改善期限 = 開立日 + N 天
  MAX_IMAGE_SIZE: 1600,     // 照片長邊上限（px），避免手機原圖過大
  JPEG_QUALITY: 0.78,       // 輸出 JPEG 品質
  STAMP_DATE: true,         // 送出時於照片右下角蓋日期

  /* ---- 嚴重程度 ---- */
  SEVERITIES: ["一般", "重要", "緊急"],

  /* ---- 回報類型（工程項目）----
   * group  : 大分類，用來對應改善負責單位
   * label  : 下拉選單顯示文字，也是存進資料庫的類型全名
   * vendor : 施作廠商（可留空）
   */
  CATEGORIES: [
    { group: "機電", label: "機電-弱電工程",              vendor: "" },
    { group: "機電", label: "機電-消防工程",              vendor: "" },
    { group: "機電", label: "機電-給(排)水工程",          vendor: "" },
    { group: "機電", label: "機電-電力工程",              vendor: "" },
    { group: "土建", label: "土建-泥作(玖太)",            vendor: "玖太" },
    { group: "土建", label: "土建-輕隔間(六奕)",          vendor: "六奕" },
    { group: "土建", label: "土建-景觀(恆安)",            vendor: "恆安" },
    { group: "土建", label: "土建-防水.地下室地坪(寶鴻)", vendor: "寶鴻" },
    { group: "土建", label: "土建-電動捲門(翔越)",        vendor: "翔越" },
    { group: "土建", label: "土建-防火門(燦通)",          vendor: "燦通" },
    { group: "土建", label: "土建-鋁門窗(同安)",          vendor: "同安" },
    { group: "土建", label: "土建-外牆塗料(軒晟)",        vendor: "軒晟" },
    { group: "土建", label: "土建-外牆石材(圓瓏)",        vendor: "圓瓏" },
    { group: "土建", label: "土建-曬衣架(高興鳳)",        vendor: "高興鳳" }
  ],

  /* ---- 大分類 → 改善負責單位 ----
   * 目前全案的改善負責單位皆為「永青營造」。
   * 若日後機電要改由分包單位負責，只需改這一行，例如：
   *   "機電": "雄菱工程",
   */
  OWNER_BY_GROUP: {
    "機電": "永青營造",
    "土建": "永青營造"
  },

  /* ---- PDF 匯出 ----
   * 檔名格式可用 {formNumber}、{title}、{project}、{date}
   */
  PDF: {
    FILE_NAME: "{formNumber}_{title}",
    PAGE_SIZE: "a4",
    SCALE: 2,                 // 解析度倍率，2 = 清晰可印；調 1 可加快速度
    LIST_ROWS_PER_PAGE: 16,   // 清單匯出每頁筆數
    ARCHIVE_TO_DRIVE: true    // 雲端模式時，是否同時在 Google Drive 保存一份
  },

  /* ---- 狀態字樣（請勿隨意更動，後端共用） ---- */
  STATUS: {
    OPEN: "待改善",
    FIXED: "已改善",
    ACCEPTED: "已驗收"
  }
};
