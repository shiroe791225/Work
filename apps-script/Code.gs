/**
 * =========================================================================
 * 現場回報系統 － Google Apps Script 後端
 *
 * 功能：Google Sheets 存資料、Google Drive 存照片、Google Docs 轉 PDF
 *
 * 部署步驟（詳見 README.md）：
 *   1. script.google.com 建立新專案，貼上本檔案內容
 *   2. 執行一次 setup()，授權後會自動建立試算表與資料夾
 *   3. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *        執行身分：我
 *        存取權限：任何人
 *   4. 複製 /exec 網址，填入 assets/config.js 的 APPS_SCRIPT_URL
 * =========================================================================
 */

/* ---------------- 可調整設定 ---------------- */

var SETTINGS = {
  ROOT_FOLDER_NAME: '現場回報系統',
  SPREADSHEET_NAME: '現場回報資料',
  SHEET_NAME: 'Reports',
  FORM_PREFIX: 'FR',          // 表單編號前綴：FR-20261106-001
  DEFAULT_SEVERITY: '一般',
  STATUS: { OPEN: '待改善', FIXED: '已改善', ACCEPTED: '已驗收' },
  PDF_MAX_IMAGE_WIDTH: 460,   // Google Docs 內照片寬度（pt）
  TIMEZONE: 'Asia/Taipei'
};

var COLUMNS = [
  'reportId', 'formNumber', 'project', 'category', 'categoryGroup', 'vendor',
  'location', 'description', 'severity', 'owner', 'dueDate', 'status',
  'createdByName', 'createdAt', 'beforePhotoId', 'beforePhotoUrl',
  'improvementNote', 'improvedByName', 'improvedAt', 'afterPhotoId', 'afterPhotoUrl',
  'improvementPdfUrl', 'acceptedByName', 'acceptedAt', 'acceptancePdfUrl'
];

/* ---------------- 入口 ---------------- */

function doGet() {
  return jsonOutput({ ok: true, message: '現場回報系統後端運作中。' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = request.action;
    var data = request.data || {};

    var handlers = {
      createReport: createReport,
      listReports: listReports,
      getPhoto: getPhoto,
      completeImprovement: completeImprovement,
      createPdf: createPdf
    };

    if (!handlers[action]) throw new Error('不支援的操作：' + action);

    var result = handlers[action](data);
    result.ok = true;

    return jsonOutput(result);
  } catch (error) {
    return jsonOutput({ ok: false, message: error && error.message ? error.message : String(error) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function jsonOutput(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 初始化 ---------------- */

function setup() {
  var sheet = getSheet();
  var folder = getRootFolder();

  Logger.log('試算表：' + sheet.getParent().getUrl());
  Logger.log('資料夾：' + folder.getUrl());
  Logger.log('設定完成，請接著部署為網頁應用程式（存取權限：任何人）。');
}

function getProperties() { return PropertiesService.getScriptProperties(); }

function getRootFolder() {
  var properties = getProperties();
  var id = properties.getProperty('ROOT_FOLDER_ID');

  if (id) {
    try { return DriveApp.getFolderById(id); } catch (error) { /* 重新建立 */ }
  }

  var folder = DriveApp.createFolder(SETTINGS.ROOT_FOLDER_NAME);
  properties.setProperty('ROOT_FOLDER_ID', folder.getId());

  return folder;
}

function getSubFolder(name) {
  var root = getRootFolder();
  var iterator = root.getFoldersByName(name);

  return iterator.hasNext() ? iterator.next() : root.createFolder(name);
}

function getSheet() {
  var properties = getProperties();
  var id = properties.getProperty('SPREADSHEET_ID');
  var spreadsheet = null;

  if (id) {
    try { spreadsheet = SpreadsheetApp.openById(id); } catch (error) { spreadsheet = null; }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create(SETTINGS.SPREADSHEET_NAME);
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());

    // 把試算表搬進系統資料夾
    var file = DriveApp.getFileById(spreadsheet.getId());
    getRootFolder().addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }

  var sheet = spreadsheet.getSheetByName(SETTINGS.SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SETTINGS.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }

  return sheet;
}

/* ---------------- 資料存取 ---------------- */

function readAllRows() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();

  return values.map(function (row, index) {
    var record = { rowNumber: index + 2 };

    COLUMNS.forEach(function (key, columnIndex) {
      var value = row[columnIndex];
      record[key] = value instanceof Date ? formatDate(value) : String(value == null ? '' : value);
    });

    return record;
  });
}

function findRecord(reportId) {
  if (!reportId) throw new Error('缺少回報編號。');

  var rows = readAllRows();

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].reportId === reportId) return rows[i];
  }

  throw new Error('找不到指定的回報資料。');
}

function updateRecord(record, changes) {
  var sheet = getSheet();

  Object.keys(changes).forEach(function (key) {
    var columnIndex = COLUMNS.indexOf(key);
    if (columnIndex < 0) return;

    sheet.getRange(record.rowNumber, columnIndex + 1).setValue(changes[key]);
    record[key] = changes[key];
  });

  return record;
}

/* ---------------- 工具 ---------------- */

function formatDate(date) {
  return Utilities.formatDate(date, SETTINGS.TIMEZONE, 'yyyy-MM-dd');
}

function nowText() {
  return Utilities.formatDate(new Date(), SETTINGS.TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function requireText(value, label, maxLength) {
  var text = String(value == null ? '' : value).trim();

  if (!text) throw new Error('請輸入' + label + '。');
  if (maxLength && text.length > maxLength) throw new Error(label + '過長（上限 ' + maxLength + ' 字）。');

  return text;
}

function nextFormNumber() {
  var today = Utilities.formatDate(new Date(), SETTINGS.TIMEZONE, 'yyyyMMdd');
  var prefix = SETTINGS.FORM_PREFIX + '-' + today + '-';
  var rows = readAllRows();
  var used = 0;

  rows.forEach(function (row) {
    if (row.formNumber && row.formNumber.indexOf(prefix) === 0) used++;
  });

  return prefix + ('00' + (used + 1)).slice(-3);
}

/* 將 data:image/jpeg;base64,... 存入 Drive，回傳 {id, url} */
function savePhoto(dataUrl, fileName) {
  var text = String(dataUrl || '');
  var match = text.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) throw new Error('照片格式不正確，請重新選擇照片。');

  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, match[1], fileName);
  var file = getSubFolder('photos').createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { id: file.getId(), url: file.getUrl() };
}

function photoToDataUrl(fileId) {
  if (!fileId) throw new Error('此回報沒有照片。');

  var blob = DriveApp.getFileById(fileId).getBlob();

  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ---------------- 動作：建立回報 ---------------- */

function createReport(data) {
  var reporterName = requireText(data.reporterName, '回報人姓名', 50);
  var project = requireText(data.project, '專案名稱', 100);
  var category = requireText(data.category, '回報類型', 100);
  var location = requireText(data.location, '現場位置', 150);
  var description = requireText(data.description, '回報內容', 2000);

  var reportId = Utilities.getUuid();
  var formNumber = nextFormNumber();
  var photo = savePhoto(data.photo, formNumber + '_before.jpg');

  var record = {
    reportId: reportId,
    formNumber: formNumber,
    project: project,
    category: category,
    categoryGroup: String(data.categoryGroup || '').trim(),
    vendor: String(data.vendor || '').trim(),
    location: location,
    description: description,
    severity: String(data.severity || SETTINGS.DEFAULT_SEVERITY).trim(),
    owner: String(data.owner || '').trim(),
    dueDate: String(data.dueDate || '').trim(),
    status: SETTINGS.STATUS.OPEN,
    createdByName: reporterName,
    createdAt: nowText(),
    beforePhotoId: photo.id,
    beforePhotoUrl: photo.url,
    improvementNote: '',
    improvedByName: '',
    improvedAt: '',
    afterPhotoId: '',
    afterPhotoUrl: '',
    improvementPdfUrl: '',
    acceptedByName: '',
    acceptedAt: '',
    acceptancePdfUrl: ''
  };

  getSheet().appendRow(COLUMNS.map(function (key) { return record[key] || ''; }));

  return { reportId: reportId, formNumber: formNumber };
}

/* ---------------- 動作：讀取清單 ---------------- */

function listReports() {
  var rows = readAllRows();

  var list = rows.map(function (row) {
    return {
      reportId: row.reportId,
      formNumber: row.formNumber,
      project: row.project,
      category: row.category,
      categoryGroup: row.categoryGroup,
      vendor: row.vendor,
      location: row.location,
      description: row.description,
      severity: row.severity,
      owner: row.owner,
      dueDate: row.dueDate,
      status: row.status,
      createdByName: row.createdByName,
      createdAt: row.createdAt,
      hasBeforePhoto: !!row.beforePhotoId,
      hasAfterPhoto: !!row.afterPhotoId,
      improvementNote: row.improvementNote,
      improvedByName: row.improvedByName,
      improvedAt: row.improvedAt,
      acceptedByName: row.acceptedByName,
      acceptedAt: row.acceptedAt,
      improvementPdfUrl: row.improvementPdfUrl,
      acceptancePdfUrl: row.acceptancePdfUrl
    };
  });

  list.reverse(); // 新的在前

  return { reports: list };
}

/* ---------------- 動作：取得照片 ---------------- */

function getPhoto(data) {
  var record = findRecord(data.reportId);
  var which = data.which === 'after' ? 'after' : 'before';
  var fileId = which === 'after' ? record.afterPhotoId : record.beforePhotoId;

  return { photo: photoToDataUrl(fileId), which: which };
}

/* ---------------- 動作：改善完成回報 ---------------- */

function completeImprovement(data) {
  var reporterName = requireText(data.reporterName, '改善回報人姓名', 50);
  var improvementNote = requireText(data.improvementNote, '改善說明', 2000);
  var record = findRecord(data.reportId);

  if (record.status === SETTINGS.STATUS.ACCEPTED) {
    throw new Error('此項目已驗收完成，無法再次回報改善。');
  }

  var photo = savePhoto(data.photo, (record.formNumber || 'report') + '_after.jpg');

  updateRecord(record, {
    improvementNote: improvementNote,
    improvedByName: reporterName,
    improvedAt: nowText(),
    afterPhotoId: photo.id,
    afterPhotoUrl: photo.url,
    status: SETTINGS.STATUS.FIXED
  });

  return { reportId: record.reportId };
}

/* ---------------- 動作：產生 PDF ---------------- */

function createPdf(data) {
  var record = findRecord(data.reportId);
  var isAcceptance = data.reportType === 'acceptance';

  if (isAcceptance && !record.improvementNote) {
    throw new Error('此項目尚未完成改善回報，無法產生驗收單。');
  }

  if (isAcceptance) {
    var acceptorName = requireText(data.acceptorName, '驗收人姓名', 50);

    updateRecord(record, {
      acceptedByName: acceptorName,
      acceptedAt: nowText(),
      status: SETTINGS.STATUS.ACCEPTED
    });
  }

  var url = buildPdf(record, isAcceptance);

  updateRecord(record, isAcceptance ? { acceptancePdfUrl: url } : { improvementPdfUrl: url });

  return { url: url };
}

function buildPdf(record, isAcceptance) {
  var title = isAcceptance ? '缺失改善驗收單' : '缺失改善報告';
  var fileName = (record.formNumber || record.reportId) + '_' + title;

  var doc = DocumentApp.create(fileName);
  var body = doc.getBody();

  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(42).setMarginRight(42);

  var heading = body.appendParagraph(title);
  heading.setHeading(DocumentApp.ParagraphHeading.TITLE);
  heading.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  var subtitle = body.appendParagraph(record.project + '　　列印時間：' + nowText());
  subtitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  subtitle.setFontSize(10);

  var rows = [
    ['表單編號', record.formNumber],
    ['專案名稱', record.project],
    ['回報類型', record.category],
    ['施作廠商', record.vendor || '－'],
    ['現場位置', record.location],
    ['嚴重程度', record.severity],
    ['改善負責人', record.owner || '－'],
    ['改善期限', record.dueDate || '－'],
    ['缺失內容', record.description],
    ['回報人／時間', record.createdByName + '　' + record.createdAt]
  ];

  if (record.improvementNote) {
    rows.push(['改善說明', record.improvementNote]);
    rows.push(['改善回報人／時間', record.improvedByName + '　' + record.improvedAt]);
  }

  if (isAcceptance) {
    rows.push(['驗收人／時間', record.acceptedByName + '　' + record.acceptedAt]);
  }

  var table = body.appendTable(rows);
  table.setBorderWidth(1);

  for (var i = 0; i < rows.length; i++) {
    table.getCell(i, 0).setWidth(110);
    table.getCell(i, 0).getChild(0).asParagraph().editAsText().setBold(true);
    table.getCell(i, 0).setBackgroundColor('#f1f5f9');
  }

  appendPhoto(body, record.beforePhotoId, '改善前照片');
  appendPhoto(body, record.afterPhotoId, '改善後照片');

  var signature = body.appendTable([['回報人：', '改善單位：', '監造／驗收：']]);
  signature.setBorderWidth(0);

  doc.saveAndClose();

  var docFile = DriveApp.getFileById(doc.getId());
  var pdfBlob = docFile.getAs('application/pdf').setName(fileName + '.pdf');
  var pdfFile = getSubFolder('reports').createFile(pdfBlob);

  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  docFile.setTrashed(true); // 刪除暫存的 Google 文件

  return pdfFile.getUrl();
}

function appendPhoto(body, fileId, caption) {
  if (!fileId) return;

  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    var label = body.appendParagraph(caption);

    label.setBold(true);
    label.setFontSize(11);

    var image = body.appendImage(blob);
    var ratio = image.getHeight() / image.getWidth();

    image.setWidth(SETTINGS.PDF_MAX_IMAGE_WIDTH);
    image.setHeight(Math.round(SETTINGS.PDF_MAX_IMAGE_WIDTH * ratio));
  } catch (error) {
    body.appendParagraph(caption + '：讀取失敗（' + error.message + '）');
  }
}
