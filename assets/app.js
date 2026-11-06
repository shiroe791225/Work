/* =========================================================================
 * 現場回報系統 － 主程式
 *
 * 架構：
 *   1. 工具函式
 *   2. 後端轉接層（Api）：APPS_SCRIPT_URL 有值走雲端，留空走本機示範模式
 *   3. 照片編輯器（canvas 框選 + 日期戳記）
 *   4. 畫面：新增回報 / 改善回報 / 回報清單
 * ========================================================================= */

(function () {
  "use strict";

  var CONFIG = window.CONFIG || {};
  var STATUS = CONFIG.STATUS || { OPEN: "待改善", FIXED: "已改善", ACCEPTED: "已驗收" };
  var USE_REMOTE = !!(CONFIG.APPS_SCRIPT_URL || "").trim();

  var reports = [];
  var detailRequestToken = 0;

  /* =======================================================================
   * 1. 工具函式
   * ===================================================================== */

  function $(id) { return document.getElementById(id); }

  function getValue(id) {
    var el = $(id);
    return el ? String(el.value || "").trim() : "";
  }

  function setValue(id, value) {
    var el = $(id);
    if (el) el.value = value == null ? "" : value;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getErrorMessage(error) {
    if (!error) return "發生未知錯誤。";
    return error.message || String(error);
  }

  function formatLocalDate(date) {
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  function formatDateTime(date) {
    return formatLocalDate(date) + " " +
      String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0");
  }

  function showMessage(text, type) {
    var el = $("message");
    el.textContent = text || "";
    el.className = "message " + (type || "info");
    el.classList.remove("hidden");

    if (type === "success" || type === "error") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function findCategory(label) {
    var list = CONFIG.CATEGORIES || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].label === label) return list[i];
    }
    return null;
  }

  /* =======================================================================
   * 2. 後端轉接層
   * ===================================================================== */

  /* ---- 2a. 雲端模式：Google Apps Script ---- */

  var RemoteApi = {
    name: "雲端模式（Google Apps Script）",

    call: async function (action, data) {
      var url = (CONFIG.APPS_SCRIPT_URL || "").trim();

      if (!/^https:\/\/script\.google\.com\//.test(url)) {
        throw new Error("Apps Script 網址設定錯誤，請檢查 assets/config.js。");
      }

      var payload = Object.assign({}, data || {});
      if (!payload.reporterName) payload.reporterName = getCurrentReporterName();

      var response;
      try {
        response = await fetch(url, {
          method: "POST",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: action, data: payload })
        });
      } catch (error) {
        console.error(error);
        throw new Error("無法連線至後端。請檢查網路、Apps Script 網址及部署權限（需設為「任何人」可存取）。");
      }

      var text = await response.text();

      if (!response.ok) {
        throw new Error("後端連線失敗：HTTP " + response.status + "。" + text.substring(0, 150));
      }

      var result;
      try {
        result = JSON.parse(text);
      } catch (error) {
        console.error("後端原始回應：", text);
        throw new Error("後端沒有回傳有效 JSON。請確認 Apps Script 已部署為「任何人」可存取。");
      }

      if (!result.ok) throw new Error(result.message || "操作失敗。");
      return result;
    },

    createReport: function (data) { return RemoteApi.call("createReport", data); },
    listReports: function () { return RemoteApi.call("listReports", {}); },
    getPhoto: function (reportId, which) { return RemoteApi.call("getPhoto", { reportId: reportId, which: which || "before" }); },
    completeImprovement: function (data) { return RemoteApi.call("completeImprovement", data); },
    createPdf: function (data) { return RemoteApi.call("createPdf", data); }
  };

  /* ---- 2b. 本機示範模式：IndexedDB ---- */

  var LocalDb = {
    open: function () {
      return new Promise(function (resolve, reject) {
        var request = indexedDB.open("field-report-system", 1);

        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains("reports")) db.createObjectStore("reports", { keyPath: "reportId" });
          if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
        };

        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(new Error("無法開啟本機資料庫（瀏覽器可能停用儲存功能）。")); };
      });
    },

    run: async function (store, mode, worker) {
      var db = await LocalDb.open();

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, mode);
        var request = worker(tx.objectStore(store));

        tx.oncomplete = function () { db.close(); resolve(request ? request.result : undefined); };
        tx.onerror = function () { db.close(); reject(new Error("本機資料庫寫入失敗。")); };
      });
    },

    put: function (store, value, key) {
      return LocalDb.run(store, "readwrite", function (os) { return key === undefined ? os.put(value) : os.put(value, key); });
    },

    get: function (store, key) {
      return LocalDb.run(store, "readonly", function (os) { return os.get(key); });
    },

    all: function (store) {
      return LocalDb.run(store, "readonly", function (os) { return os.getAll(); });
    }
  };

  var LocalApi = {
    name: "本機示範模式（資料僅存於本裝置）",

    nextFormNumber: function (existing) {
      var today = formatLocalDate(new Date()).replace(/-/g, "");
      var prefix = "FR-" + today + "-";
      var used = existing.filter(function (r) { return (r.formNumber || "").indexOf(prefix) === 0; }).length;
      return prefix + String(used + 1).padStart(3, "0");
    },

    createReport: async function (data) {
      var existing = await LocalDb.all("reports");
      var now = new Date();
      var reportId = "R" + now.getTime() + "-" + Math.random().toString(36).slice(2, 7);

      var record = {
        reportId: reportId,
        formNumber: LocalApi.nextFormNumber(existing),
        project: data.project,
        category: data.category,
        categoryGroup: data.categoryGroup,
        vendor: data.vendor || "",
        location: data.location,
        description: data.description,
        severity: data.severity,
        owner: data.owner || "",
        dueDate: data.dueDate || "",
        status: STATUS.OPEN,
        createdByName: data.reporterName,
        createdAt: formatDateTime(now),
        hasBeforePhoto: true,
        hasAfterPhoto: false,
        improvementNote: "",
        improvedByName: "",
        improvedAt: "",
        acceptedByName: "",
        acceptedAt: ""
      };

      await LocalDb.put("photos", data.photo, reportId + ":before");
      await LocalDb.put("reports", record);

      return { ok: true, reportId: reportId, formNumber: record.formNumber };
    },

    listReports: async function () {
      var list = await LocalDb.all("reports");

      list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      return { ok: true, reports: list };
    },

    getPhoto: async function (reportId, which) {
      var photo = await LocalDb.get("photos", reportId + ":" + (which || "before"));
      if (!photo) throw new Error("找不到照片。");
      return { ok: true, photo: photo };
    },

    completeImprovement: async function (data) {
      var record = await LocalDb.get("reports", data.reportId);
      if (!record) throw new Error("找不到指定的回報資料。");

      record.improvementNote = data.improvementNote;
      record.improvedByName = data.reporterName;
      record.improvedAt = formatDateTime(new Date());
      record.status = STATUS.FIXED;
      record.hasAfterPhoto = true;

      await LocalDb.put("photos", data.photo, data.reportId + ":after");
      await LocalDb.put("reports", record);

      return { ok: true };
    },

    createPdf: async function (data) {
      var record = await LocalDb.get("reports", data.reportId);
      if (!record) throw new Error("找不到指定的回報資料。");

      if (data.reportType === "acceptance") {
        if (!record.improvementNote) throw new Error("此項目尚未完成改善回報，無法產生驗收單。");

        record.acceptedByName = data.acceptorName;
        record.acceptedAt = formatDateTime(new Date());
        record.status = STATUS.ACCEPTED;

        await LocalDb.put("reports", record);
      }

      var before = await LocalDb.get("photos", data.reportId + ":before");
      var after = record.hasAfterPhoto ? await LocalDb.get("photos", data.reportId + ":after") : "";

      return { ok: true, printHtml: buildPrintHtml(record, data.reportType, before, after) };
    }
  };

  var Api = USE_REMOTE ? RemoteApi : LocalApi;

  /* =======================================================================
   * 3. 本機模式的列印版報告（可另存為 PDF）
   * ===================================================================== */

  function buildPrintHtml(report, reportType, beforePhoto, afterPhoto) {
    var isAcceptance = reportType === "acceptance";
    var title = isAcceptance ? "缺失改善驗收單" : "缺失改善報告";

    function row(label, value) {
      return "<tr><th>" + escapeHtml(label) + "</th><td>" + escapeHtml(value || "－") + "</td></tr>";
    }

    var rows =
      row("表單編號", report.formNumber) +
      row("專案名稱", report.project) +
      row("回報類型", report.category) +
      row("施作廠商", report.vendor) +
      row("現場位置", report.location) +
      row("嚴重程度", report.severity) +
      row("改善負責人", report.owner) +
      row("改善期限", report.dueDate) +
      row("缺失內容", report.description) +
      row("回報人／時間", report.createdByName + "　" + report.createdAt) +
      (report.improvementNote ? row("改善說明", report.improvementNote) : "") +
      (report.improvedByName ? row("改善回報人／時間", report.improvedByName + "　" + report.improvedAt) : "") +
      (isAcceptance ? row("驗收人／時間", report.acceptedByName + "　" + report.acceptedAt) : "");

    var photos =
      '<div class="photos">' +
      (beforePhoto ? '<figure><img src="' + beforePhoto + '"><figcaption>改善前</figcaption></figure>' : "") +
      (afterPhoto ? '<figure><img src="' + afterPhoto + '"><figcaption>改善後</figcaption></figure>' : "") +
      "</div>";

    return '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">' +
      "<title>" + escapeHtml(title + " " + report.formNumber) + "</title><style>" +
      'body{font-family:"Microsoft JhengHei",sans-serif;color:#111;margin:28px;}' +
      "h1{font-size:22px;text-align:center;margin:0 0 4px;letter-spacing:4px;}" +
      ".sub{text-align:center;color:#555;font-size:13px;margin-bottom:18px;}" +
      "table{width:100%;border-collapse:collapse;font-size:14px;}" +
      "th,td{border:1px solid #333;padding:7px 9px;vertical-align:top;}" +
      "th{width:130px;background:#f0f0f0;text-align:left;white-space:nowrap;}" +
      ".photos{display:flex;gap:12px;margin-top:14px;}" +
      ".photos figure{flex:1;margin:0;text-align:center;}" +
      ".photos img{width:100%;border:1px solid #333;}" +
      "figcaption{font-size:13px;margin-top:4px;}" +
      ".sign{display:flex;gap:16px;margin-top:28px;font-size:14px;}" +
      ".sign div{flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;}" +
      "@media print{body{margin:12mm;}}" +
      "</style></head><body>" +
      "<h1>" + escapeHtml(title) + "</h1>" +
      '<p class="sub">' + escapeHtml(report.project) + "　列印時間：" + escapeHtml(formatDateTime(new Date())) + "</p>" +
      "<table>" + rows + "</table>" + photos +
      '<div class="sign"><div>回報人</div><div>改善單位</div><div>監造／驗收</div></div>' +
      "</body></html>";
  }

  /* =======================================================================
   * 4. 照片編輯器（框選 + 日期戳記）
   * ===================================================================== */

  function createEditor(prefix) {
    return {
      prefix: prefix,
      canvas: null,
      context: null,
      base: null,      // 原始照片（不含框）
      loaded: false,
      tool: "",        // "draw" = 等待拖曳畫框
      shapes: [],      // [{x, y, w, h}]
      selected: -1,
      drag: null,
      history: []
    };
  }

  var editors = { before: createEditor("before"), after: createEditor("after") };

  function initializeEditors() {
    Object.keys(editors).forEach(function (prefix) {
      var editor = editors[prefix];

      editor.canvas = $(prefix + "Canvas");
      if (!editor.canvas) throw new Error("找不到照片畫布：" + prefix);

      editor.context = editor.canvas.getContext("2d");

      editor.canvas.addEventListener("pointerdown", function (e) { onPointerDown(prefix, e); });
      editor.canvas.addEventListener("pointermove", function (e) { onPointerMove(prefix, e); });
      editor.canvas.addEventListener("pointerup", function (e) { onPointerUp(prefix, e); });
      editor.canvas.addEventListener("pointercancel", function (e) { onPointerUp(prefix, e); });
    });
  }

  function setPhotoStatus(prefix, text, isError) {
    var el = $(prefix + "Status");
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#b91c1c" : "#64748b";
  }

  function resetFileInputs(prefix) {
    [prefix + "File", prefix + "Camera"].forEach(function (id) {
      var input = $(id);
      if (input) input.value = "";
    });
  }

  function loadPhoto(prefix, event) {
    var input = event.target;
    var file = input.files && input.files[0];

    if (!file) return;

    if (!file.type || file.type.indexOf("image/") !== 0) {
      input.value = "";
      setPhotoStatus(prefix, "檔案格式不正確", true);
      showMessage("請選擇 JPG、PNG 或手機照片。", "error");
      return;
    }

    setPhotoStatus(prefix, "正在讀取照片：" + file.name, false);
    showMessage("正在讀取照片，請稍候……", "info");

    var imageUrl = URL.createObjectURL(file);
    var image = new Image();

    image.onload = function () {
      try {
        var editor = editors[prefix];
        var sourceWidth = image.naturalWidth || image.width;
        var sourceHeight = image.naturalHeight || image.height;

        if (!sourceWidth || !sourceHeight) throw new Error("無法取得照片尺寸。");

        var maxSize = CONFIG.MAX_IMAGE_SIZE || 1600;
        var ratio = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
        var width = Math.max(1, Math.round(sourceWidth * ratio));
        var height = Math.max(1, Math.round(sourceHeight * ratio));

        editor.canvas.width = width;
        editor.canvas.height = height;
        editor.context = editor.canvas.getContext("2d");

        editor.base = document.createElement("canvas");
        editor.base.width = width;
        editor.base.height = height;
        editor.base.getContext("2d").drawImage(image, 0, 0, width, height);

        editor.loaded = true;
        editor.tool = "";
        editor.shapes = [];
        editor.selected = -1;
        editor.drag = null;
        editor.history = [];
        editor.canvas.classList.remove("hidden");

        renderEditor(prefix);

        setPhotoStatus(prefix, "照片已載入：" + file.name + "（" + width + " × " + height + "）", false);
        showMessage("照片已載入，可按「新增框選」標示缺失範圍。", "success");
      } catch (error) {
        console.error(error);

        input.value = "";
        editors[prefix].loaded = false;
        editors[prefix].canvas.classList.add("hidden");

        setPhotoStatus(prefix, "照片處理失敗", true);
        showMessage("照片處理失敗：" + getErrorMessage(error), "error");
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    };

    image.onerror = function () {
      URL.revokeObjectURL(imageUrl);
      input.value = "";

      editors[prefix].loaded = false;
      editors[prefix].canvas.classList.add("hidden");

      setPhotoStatus(prefix, "瀏覽器無法讀取此照片", true);
      showMessage("瀏覽器無法開啟這張照片。請改用 JPG、PNG，或先將照片截圖後再上傳。", "error");
    };

    image.src = imageUrl;
  }

  /* ---- 繪製 ---- */

  function getHandleSize(editor) { return Math.max(18, editor.canvas.width * 0.025); }

  function getCorners(shape) {
    return [
      [shape.x, shape.y],
      [shape.x + shape.w, shape.y],
      [shape.x, shape.y + shape.h],
      [shape.x + shape.w, shape.y + shape.h]
    ];
  }

  function drawShapes(context, editor, withHandles) {
    var lineWidth = Math.max(5, editor.canvas.width * 0.006);

    editor.shapes.forEach(function (shape, index) {
      context.strokeStyle = "#ff0000";
      context.lineWidth = lineWidth;
      context.lineJoin = "round";
      context.strokeRect(shape.x, shape.y, shape.w, shape.h);

      if (withHandles && index === editor.selected) {
        var size = getHandleSize(editor);

        getCorners(shape).forEach(function (corner) {
          context.fillStyle = "#ffffff";
          context.fillRect(corner[0] - size / 2, corner[1] - size / 2, size, size);
          context.lineWidth = Math.max(3, lineWidth * 0.6);
          context.strokeStyle = "#ff0000";
          context.strokeRect(corner[0] - size / 2, corner[1] - size / 2, size, size);
        });
      }
    });
  }

  function renderEditor(prefix) {
    var editor = editors[prefix];
    if (!editor.loaded || !editor.base) return;

    editor.context.clearRect(0, 0, editor.canvas.width, editor.canvas.height);
    editor.context.drawImage(editor.base, 0, 0);
    drawShapes(editor.context, editor, true);
  }

  /* ---- 座標與命中判斷 ---- */

  function getPoint(editor, event) {
    var rect = editor.canvas.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left) * (editor.canvas.width / rect.width),
      y: (event.clientY - rect.top) * (editor.canvas.height / rect.height)
    };
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function findHandle(editor, point) {
    if (editor.selected < 0) return -1;

    var shape = editor.shapes[editor.selected];
    var hitRadius = getHandleSize(editor) * 1.2;
    var corners = getCorners(shape);

    for (var i = 0; i < corners.length; i++) {
      var dx = point.x - corners[i][0];
      var dy = point.y - corners[i][1];
      if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) return i;
    }

    return -1;
  }

  function findShapeAt(editor, point) {
    var tolerance = getHandleSize(editor) * 0.5;

    for (var i = editor.shapes.length - 1; i >= 0; i--) {
      var s = editor.shapes[i];

      if (point.x >= s.x - tolerance && point.x <= s.x + s.w + tolerance &&
          point.y >= s.y - tolerance && point.y <= s.y + s.h + tolerance) {
        return i;
      }
    }

    return -1;
  }

  /* ---- 指標事件 ---- */

  function onPointerDown(prefix, event) {
    var editor = editors[prefix];
    if (!editor.loaded) return;

    event.preventDefault();
    var point = getPoint(editor, event);

    try { editor.canvas.setPointerCapture(event.pointerId); } catch (error) { /* 部分瀏覽器不支援 */ }

    // 1. 畫框模式
    if (editor.tool === "draw") {
      saveHistory(prefix);

      editor.shapes.push({ x: point.x, y: point.y, w: 0, h: 0 });
      editor.selected = editor.shapes.length - 1;
      editor.drag = { type: "create", startX: point.x, startY: point.y };

      renderEditor(prefix);
      return;
    }

    // 2. 拖曳四角控制點 → 縮放
    var handleIndex = findHandle(editor, point);

    if (handleIndex >= 0) {
      var corners = getCorners(editor.shapes[editor.selected]);
      var anchor = corners[3 - handleIndex];

      saveHistory(prefix);
      editor.drag = { type: "resize", anchorX: anchor[0], anchorY: anchor[1] };
      return;
    }

    // 3. 點到框內 → 選取並移動
    var shapeIndex = findShapeAt(editor, point);

    if (shapeIndex >= 0) {
      var shape = editor.shapes[shapeIndex];

      saveHistory(prefix);
      editor.selected = shapeIndex;
      editor.drag = { type: "move", offsetX: point.x - shape.x, offsetY: point.y - shape.y };

      renderEditor(prefix);
      return;
    }

    // 4. 點空白處 → 取消選取
    editor.selected = -1;
    renderEditor(prefix);
  }

  function onPointerMove(prefix, event) {
    var editor = editors[prefix];
    if (!editor.loaded || !editor.drag) return;

    event.preventDefault();

    var point = getPoint(editor, event);
    var width = editor.canvas.width;
    var height = editor.canvas.height;
    var shape = editor.shapes[editor.selected];

    if (!shape) return;

    var px = clamp(point.x, 0, width);
    var py = clamp(point.y, 0, height);

    if (editor.drag.type === "create") {
      shape.x = Math.min(editor.drag.startX, px);
      shape.y = Math.min(editor.drag.startY, py);
      shape.w = Math.abs(px - editor.drag.startX);
      shape.h = Math.abs(py - editor.drag.startY);
    } else if (editor.drag.type === "resize") {
      shape.x = Math.min(editor.drag.anchorX, px);
      shape.y = Math.min(editor.drag.anchorY, py);
      shape.w = Math.abs(px - editor.drag.anchorX);
      shape.h = Math.abs(py - editor.drag.anchorY);
    } else if (editor.drag.type === "move") {
      shape.x = clamp(point.x - editor.drag.offsetX, 0, width - shape.w);
      shape.y = clamp(point.y - editor.drag.offsetY, 0, height - shape.h);
    }

    renderEditor(prefix);
  }

  function onPointerUp(prefix, event) {
    var editor = editors[prefix];
    if (!editor.loaded || !editor.drag) return;

    var dragType = editor.drag.type;
    var shape = editor.shapes[editor.selected];
    var minSize = Math.max(20, editor.canvas.width * 0.02);

    if (shape && (dragType === "create" || dragType === "resize")) {
      if (shape.w < minSize || shape.h < minSize) {
        if (dragType === "create") {
          // 只是點一下：以點擊位置為中心產生預設框
          var width = editor.canvas.width * 0.25;
          var height = editor.canvas.height * 0.25;

          shape.w = width;
          shape.h = height;
          shape.x = clamp(editor.drag.startX - width / 2, 0, editor.canvas.width - width);
          shape.y = clamp(editor.drag.startY - height / 2, 0, editor.canvas.height - height);
        } else {
          shape.w = Math.max(shape.w, minSize);
          shape.h = Math.max(shape.h, minSize);
        }
      }
    }

    if (dragType === "create") {
      editor.tool = "";
      showMessage("已加入框選。拖曳框內可移動，拖曳四角白點可調整大小。", "success");
    }

    editor.drag = null;
    renderEditor(prefix);
  }

  /* ---- 工具按鈕 ---- */

  function addFrame(prefix) {
    var editor = editors[prefix];

    if (!editor.loaded) { showMessage("請先拍照或選擇照片。", "error"); return; }

    editor.tool = "draw";
    showMessage("請在照片上拖曳，畫出要框選的範圍（單點一下會產生預設框）。", "info");
  }

  function deleteSelectedFrame(prefix) {
    var editor = editors[prefix];

    if (!editor.loaded) { showMessage("請先拍照或選擇照片。", "error"); return; }
    if (editor.selected < 0 || !editor.shapes[editor.selected]) { showMessage("請先點選要刪除的框。", "info"); return; }

    saveHistory(prefix);
    editor.shapes.splice(editor.selected, 1);
    editor.selected = -1;
    renderEditor(prefix);

    showMessage("已刪除選取的框。", "success");
  }

  function saveHistory(prefix) {
    var editor = editors[prefix];

    editor.history.push(JSON.stringify({ shapes: editor.shapes, selected: editor.selected }));
    if (editor.history.length > 20) editor.history.shift();
  }

  function undoPhoto(prefix) {
    var editor = editors[prefix];

    if (!editor.history.length) { showMessage("沒有可以復原的操作。", "info"); return; }

    var state = JSON.parse(editor.history.pop());

    editor.shapes = state.shapes;
    editor.selected = state.selected;
    editor.tool = "";
    editor.drag = null;

    renderEditor(prefix);
    showMessage("已復原上一個操作。", "success");
  }

  function clearPhoto(prefix) {
    var editor = editors[prefix];

    if (editor.canvas && editor.context) {
      editor.context.clearRect(0, 0, editor.canvas.width, editor.canvas.height);
    }

    editor.loaded = false;
    editor.base = null;
    editor.tool = "";
    editor.shapes = [];
    editor.selected = -1;
    editor.drag = null;
    editor.history = [];

    if (editor.canvas) editor.canvas.classList.add("hidden");

    resetFileInputs(prefix);
    setPhotoStatus(prefix, "尚未載入照片", false);
  }

  /* ---- 輸出最終照片：原圖 + 框選（不含控制點）+ 右下角日期 ---- */

  function createFinalPhoto(prefix) {
    var editor = editors[prefix];

    if (!editor.loaded || !editor.base) {
      throw new Error(prefix === "before" ? "現場照片尚未成功載入。" : "改善後照片尚未成功載入。");
    }

    var output = document.createElement("canvas");
    output.width = editor.canvas.width;
    output.height = editor.canvas.height;

    var context = output.getContext("2d");
    context.drawImage(editor.base, 0, 0);
    drawShapes(context, editor, false);

    if (CONFIG.STAMP_DATE !== false) {
      var fontSize = Math.max(20, output.width * 0.024);
      var padding = Math.max(12, output.width * 0.015);
      var now = new Date();
      var dateText = now.getFullYear() + "/" +
        String(now.getMonth() + 1).padStart(2, "0") + "/" +
        String(now.getDate()).padStart(2, "0");

      context.font = "bold " + fontSize + "px sans-serif";

      var textWidth = context.measureText(dateText).width;
      var boxWidth = textWidth + padding * 2;
      var boxHeight = fontSize + padding * 2;

      context.fillStyle = "rgba(0,0,0,0.68)";
      context.fillRect(output.width - boxWidth, output.height - boxHeight, boxWidth, boxHeight);

      context.fillStyle = "#ffffff";
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillText(dateText, output.width - boxWidth + padding, output.height - padding - fontSize * 0.15);
    }

    var dataUrl = output.toDataURL("image/jpeg", CONFIG.JPEG_QUALITY || 0.78);

    if (!dataUrl || dataUrl.indexOf("data:image/jpeg;base64,") !== 0) {
      throw new Error("照片轉換失敗，請重新選擇照片。");
    }

    return dataUrl;
  }

  /* =======================================================================
   * 5. 回報人姓名（記在本機，免登入）
   * ===================================================================== */

  var NAME_KEY = "fieldReportReporterName";
  var ACCEPTOR_KEY = "fieldReportAcceptorName";

  function restoreReporterName() {
    var savedName = "";
    try { savedName = localStorage.getItem(NAME_KEY) || ""; } catch (e) { /* 隱私模式 */ }

    setValue("reporterName", savedName);
    setValue("improvementReporterName", savedName);
    updateUserInfo(savedName);
  }

  function saveReporterName(name) {
    if (!name) return;
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* 忽略 */ }
    updateUserInfo(name);
  }

  function updateUserInfo(name) {
    $("userInfo").textContent = name
      ? "目前填報人：" + name + "｜免登入直接回報"
      : "免登入，開啟後即可直接回報";
  }

  function getCurrentReporterName() {
    var saved = "";
    try { saved = localStorage.getItem(NAME_KEY) || ""; } catch (e) { /* 忽略 */ }
    return getValue("reporterName") || getValue("improvementReporterName") || saved || "現場人員";
  }

  /* =======================================================================
   * 6. 自動欄位（負責人、廠商、期限）
   * ===================================================================== */

  function updateAutomaticFields() {
    var label = getValue("category");
    var category = findCategory(label);
    var group = category ? category.group : "";

    setValue("owner", (CONFIG.OWNER_BY_GROUP || {})[group] || "");

    var vendorInput = $("vendor");
    if (vendorInput && !vendorInput.dataset.touched) {
      vendorInput.value = category ? (category.vendor || "") : "";
    }

    var date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + (CONFIG.DUE_DAYS || 7));
    setValue("dueDate", formatLocalDate(date));
  }

  /* =======================================================================
   * 7. 送出新增回報
   * ===================================================================== */

  async function submitReport(event) {
    event.preventDefault();

    var button = $("submitReportButton");
    button.disabled = true;

    try {
      updateAutomaticFields(); // 避免跨日後日期仍為前一天

      var reporterName = getValue("reporterName");
      var project = getValue("project");
      var categoryLabel = getValue("category");
      var location = getValue("location");
      var description = getValue("description");

      if (!reporterName) throw new Error("請輸入回報人姓名。");
      if (!project) throw new Error("請輸入專案名稱。");
      if (!categoryLabel) throw new Error("請選擇回報類型。");
      if (!location) throw new Error("請輸入現場位置。");
      if (!description) throw new Error("請輸入回報內容。");
      if (!editors.before.loaded) throw new Error("請先拍照或選擇現場照片。");

      saveReporterName(reporterName);

      showMessage("正在整理照片，請勿關閉網頁……", "info");
      var photo = createFinalPhoto("before");

      showMessage("正在上傳照片並建立回報，請稍候……", "info");

      var category = findCategory(categoryLabel);

      var result = await Api.createReport({
        reporterName: reporterName,
        project: project,
        category: categoryLabel,
        categoryGroup: category ? category.group : "",
        vendor: getValue("vendor"),
        location: location,
        description: description,
        owner: getValue("owner"),
        dueDate: getValue("dueDate"),
        severity: getValue("severity") || "一般",
        photo: photo
      });

      $("reportForm").reset();
      setValue("reporterName", reporterName);
      setValue("project", CONFIG.DEFAULT_PROJECT || "");
      var vendorInput = $("vendor");
      if (vendorInput) delete vendorInput.dataset.touched;
      updateAutomaticFields();

      clearPhoto("before");

      await loadReports(false);
      showPage("listPage");

      showMessage("回報建立成功，表單編號：" + (result.formNumber || result.reportId), "success");
    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error), "error");
    } finally {
      button.disabled = false;
    }
  }

  /* =======================================================================
   * 8. 送出改善回報
   * ===================================================================== */

  async function submitImprovement(event) {
    event.preventDefault();

    var button = $("submitImprovementButton");
    button.disabled = true;

    try {
      var reporterName = getValue("improvementReporterName");
      var reportId = getValue("improvementReportId");
      var improvementNote = getValue("improvementNote");

      if (!reporterName) throw new Error("請輸入改善回報人姓名。");
      if (!reportId) throw new Error("請選擇待改善項目。");
      if (!improvementNote) throw new Error("請輸入改善說明。");
      if (!editors.after.loaded) throw new Error("請先拍照或選擇改善後照片。");

      var report = reports.find(function (item) { return item.reportId === reportId; });
      if (!report) throw new Error("找不到指定的回報資料。");

      saveReporterName(reporterName);

      showMessage("正在整理改善照片，請勿關閉網頁……", "info");
      var photo = createFinalPhoto("after");

      showMessage("正在上傳改善資料，請稍候……", "info");

      await Api.completeImprovement({
        reporterName: reporterName,
        reportId: reportId,
        improvementNote: improvementNote,
        photo: photo
      });

      $("improvementForm").reset();
      setValue("improvementReporterName", reporterName);

      clearPhoto("after");

      await loadReports(false);
      renderImprovementDetail();
      showPage("listPage");

      showMessage("改善回報完成。", "success");
    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error), "error");
    } finally {
      button.disabled = false;
    }
  }

  /* =======================================================================
   * 9. 回報清單
   * ===================================================================== */

  async function loadReports(showLoading) {
    try {
      if (showLoading !== false) showMessage("正在讀取回報資料……", "info");

      var result = await Api.listReports();

      reports = Array.isArray(result.reports) ? result.reports : [];

      renderReports();
      updateImprovementOptions();

      if (showLoading !== false) showMessage("已讀取 " + reports.length + " 筆資料。", "success");
    } catch (error) {
      console.error(error);
      $("reportList").innerHTML = "<p>無法讀取回報資料。</p>";
      if (showLoading !== false) showMessage(getErrorMessage(error), "error");
    }
  }

  function isOverdue(report) {
    if (!report.dueDate || report.status !== STATUS.OPEN) return false;
    return report.dueDate < formatLocalDate(new Date());
  }

  function filteredReports() {
    var status = getValue("filterStatus");
    var group = getValue("filterGroup");
    var keyword = getValue("filterKeyword").toLowerCase();

    return reports.filter(function (report) {
      if (status && report.status !== status) return false;
      if (group && report.categoryGroup !== group) return false;

      if (keyword) {
        var haystack = [
          report.formNumber, report.location, report.description,
          report.createdByName, report.category, report.vendor, report.owner
        ].join(" ").toLowerCase();

        if (haystack.indexOf(keyword) < 0) return false;
      }

      return true;
    });
  }

  function renderStats() {
    var counts = { total: reports.length, open: 0, fixed: 0, accepted: 0, overdue: 0 };

    reports.forEach(function (report) {
      if (report.status === STATUS.OPEN) counts.open++;
      else if (report.status === STATUS.FIXED) counts.fixed++;
      else if (report.status === STATUS.ACCEPTED) counts.accepted++;
      if (isOverdue(report)) counts.overdue++;
    });

    $("stats").innerHTML =
      '<div class="stat"><b>' + counts.total + "</b><span>總筆數</span></div>" +
      '<div class="stat"><b>' + counts.open + "</b><span>待改善</span></div>" +
      '<div class="stat"><b>' + counts.fixed + "</b><span>已改善</span></div>" +
      '<div class="stat"><b>' + counts.accepted + "</b><span>已驗收</span></div>" +
      '<div class="stat"><b>' + counts.overdue + "</b><span>已逾期</span></div>";
  }

  function renderReports() {
    renderStats();

    var container = $("reportList");
    var list = filteredReports();

    if (!reports.length) { container.innerHTML = "<p>目前沒有回報資料。</p>"; return; }
    if (!list.length) { container.innerHTML = "<p>沒有符合篩選條件的資料。</p>"; return; }

    container.innerHTML = list.map(function (report) {
      var encodedId = encodeURIComponent(report.reportId || "");
      var overdue = isOverdue(report);

      function link(url, text) {
        return url
          ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + text + "</a>"
          : "";
      }

      function line(label, value) {
        return value ? "<p><strong>" + label + "：</strong>" + escapeHtml(value) + "</p>" : "";
      }

      var acceptanceButton = report.improvementNote
        ? '<button type="button" class="secondary" data-pdf-id="' + encodedId + '" data-pdf-type="acceptance">驗收單 PDF</button>'
        : "";

      return '<article class="report sev-' + escapeHtml(report.severity || "一般") + (overdue ? " overdue" : "") + '">' +
        "<h3>" + escapeHtml(report.formNumber || report.reportId) + "｜" + escapeHtml(report.project) + "</h3>" +

        '<p><span class="badge ' + escapeHtml(report.status) + '">' + escapeHtml(report.status) + "</span> " +
        (overdue ? '<span class="badge late">已逾期</span> ' : "") +
        escapeHtml(report.category) + "／" + escapeHtml(report.severity) + "</p>" +

        line("位置", report.location) +
        line("內容", report.description) +
        line("施作廠商", report.vendor) +
        line("負責人", report.owner || "未指定") +
        line("期限", report.dueDate || "未設定") +
        line("回報人", report.createdByName || "現場人員") +
        line("建立時間", report.createdAt) +
        line("改善說明", report.improvementNote) +
        line("改善回報人", report.improvedByName) +
        line("改善時間", report.improvedAt) +
        line("驗收人", report.acceptedByName) +
        line("驗收時間", report.acceptedAt) +

        '<div class="actions">' +
          '<button type="button" class="light" data-photo-id="' + encodedId + '">查看照片</button>' +
          '<button type="button" data-pdf-id="' + encodedId + '" data-pdf-type="improvement">缺失改善報告 PDF</button>' +
          acceptanceButton +
          link(report.improvementPdfUrl, "下載改善報告") +
          link(report.acceptancePdfUrl, "下載驗收單") +
        "</div>" +
        '<div class="photo-view" data-photo-box="' + encodedId + '"></div>' +
      "</article>";
    }).join("");

    container.querySelectorAll("[data-pdf-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        createPdf(decodeURIComponent(button.dataset.pdfId), button.dataset.pdfType, button);
      });
    });

    container.querySelectorAll("[data-photo-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        togglePhotos(decodeURIComponent(button.dataset.photoId), button);
      });
    });
  }

  async function togglePhotos(reportId, button) {
    var box = document.querySelector('[data-photo-box="' + CSS.escape(encodeURIComponent(reportId)) + '"]');
    if (!box) return;

    if (box.innerHTML) { box.innerHTML = ""; button.textContent = "查看照片"; return; }

    var report = reports.find(function (item) { return item.reportId === reportId; });
    if (!report) return;

    button.disabled = true;
    box.innerHTML = '<p class="muted">正在讀取照片……</p>';

    try {
      var html = "";

      if (report.hasBeforePhoto !== false) {
        var before = await Api.getPhoto(reportId, "before");
        html += '<p><strong>改善前：</strong></p><img alt="改善前照片" src="' + before.photo + '">';
      }

      if (report.hasAfterPhoto) {
        var after = await Api.getPhoto(reportId, "after");
        html += '<p><strong>改善後：</strong></p><img alt="改善後照片" src="' + after.photo + '">';
      }

      box.innerHTML = html || '<p class="muted">此回報沒有照片。</p>';
      button.textContent = "收起照片";
    } catch (error) {
      box.innerHTML = '<p class="muted">照片讀取失敗：' + escapeHtml(getErrorMessage(error)) + "</p>";
    } finally {
      button.disabled = false;
    }
  }

  /* =======================================================================
   * 10. 改善回報：待改善選單與詳細資料
   * ===================================================================== */

  function updateImprovementOptions() {
    var select = $("improvementReportId");
    var selectedValue = select.value;

    var available = reports.filter(function (report) { return report.status === STATUS.OPEN; });

    if (!available.length) {
      select.innerHTML = '<option value="">目前沒有待改善項目</option>';
      renderImprovementDetail();
      return;
    }

    select.innerHTML = '<option value="">請選擇回報項目</option>' +
      available.map(function (report) {
        return '<option value="' + escapeHtml(report.reportId) + '">' +
          escapeHtml((report.formNumber || report.reportId) + "｜" + report.location) + "</option>";
      }).join("");

    if (available.some(function (report) { return report.reportId === selectedValue; })) {
      select.value = selectedValue;
    }

    renderImprovementDetail();
  }

  async function renderImprovementDetail() {
    var box = $("improvementDetail");
    var reportId = getValue("improvementReportId");
    var token = ++detailRequestToken;

    var report = reports.find(function (item) { return item.reportId === reportId; });

    if (!report) { box.innerHTML = ""; box.classList.add("hidden"); return; }

    function line(label, value) {
      return "<p><strong>" + label + "：</strong>" + escapeHtml(value || "－") + "</p>";
    }

    box.innerHTML =
      line("表單編號", report.formNumber || report.reportId) +
      line("專案", report.project) +
      line("類型／嚴重程度", report.category + "／" + report.severity) +
      line("施作廠商", report.vendor) +
      line("位置", report.location) +
      line("缺失內容", report.description) +
      line("負責人", report.owner) +
      line("改善期限", report.dueDate) +
      line("回報人", report.createdByName || "現場人員") +
      line("建立時間", report.createdAt) +
      '<div id="detailPhoto"><p class="muted">正在讀取改善前照片……</p></div>';

    box.classList.remove("hidden");

    var photoBox = $("detailPhoto");

    if (report.hasBeforePhoto === false) {
      photoBox.innerHTML = '<p class="muted">此回報沒有改善前照片。</p>';
      return;
    }

    try {
      var result = await Api.getPhoto(reportId, "before");
      if (token !== detailRequestToken) return; // 使用者已切換項目

      photoBox.innerHTML = "<p><strong>改善前照片：</strong></p>" +
        '<img alt="改善前照片" src="' + result.photo + '">';
    } catch (error) {
      if (token !== detailRequestToken) return;
      photoBox.innerHTML = '<p class="muted">照片讀取失敗：' + escapeHtml(getErrorMessage(error)) + "</p>";
    }
  }

  /* =======================================================================
   * 11. PDF／列印報告
   * ===================================================================== */

  async function createPdf(reportId, reportType, button) {
    var isAcceptance = reportType === "acceptance";
    var acceptorName = "";

    // 必須在使用者點擊的當下詢問並開窗，否則會被瀏覽器阻擋
    if (isAcceptance) {
      var savedName = "";
      try { savedName = localStorage.getItem(ACCEPTOR_KEY) || ""; } catch (e) { /* 忽略 */ }

      var input = window.prompt("請輸入驗收人姓名：", savedName);
      if (input === null) return;

      acceptorName = input.trim();

      if (!acceptorName) { showMessage("請輸入驗收人姓名，才能產生驗收單。", "error"); return; }

      try { localStorage.setItem(ACCEPTOR_KEY, acceptorName); } catch (e) { /* 忽略 */ }
    }

    if (button) button.disabled = true;

    var documentName = isAcceptance ? "驗收單" : "缺失改善報告";
    var reportWindow = window.open("about:blank", "_blank");

    try {
      showMessage("正在產生" + documentName + "，請稍候……", "info");

      var result = await Api.createPdf({
        reporterName: getCurrentReporterName(),
        reportId: reportId,
        reportType: reportType,
        acceptorName: acceptorName
      });

      await loadReports(false);

      if (result.url && reportWindow) {
        reportWindow.location.href = result.url;
        showMessage(documentName + "已產生。", "success");
      } else if (result.printHtml && reportWindow) {
        reportWindow.document.open();
        reportWindow.document.write(result.printHtml);
        reportWindow.document.close();
        showMessage(documentName + "已產生，請在新視窗按「列印／另存為 PDF」。", "success");
      } else {
        showMessage(documentName + "已產生，但瀏覽器阻擋了新視窗，請允許彈出視窗後重試。", "error");
      }
    } catch (error) {
      console.error(error);
      if (reportWindow && !reportWindow.closed) reportWindow.close();
      showMessage(getErrorMessage(error), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* =======================================================================
   * 12. 畫面切換與初始化
   * ===================================================================== */

  function showPage(pageId) {
    document.querySelectorAll(".page").forEach(function (el) { el.classList.add("hidden"); });

    var page = $(pageId);
    if (page) page.classList.remove("hidden");

    document.querySelectorAll(".nav button").forEach(function (button) {
      button.setAttribute("aria-current", button.dataset.page === pageId ? "true" : "false");
    });
  }

  function buildOptions() {
    var category = $("category");
    var severity = $("severity");
    var filterGroup = $("filterGroup");
    var groups = [];

    category.innerHTML = (CONFIG.CATEGORIES || []).map(function (item) {
      if (groups.indexOf(item.group) < 0) groups.push(item.group);
      return '<option value="' + escapeHtml(item.label) + '">' + escapeHtml(item.label) + "</option>";
    }).join("");

    severity.innerHTML = (CONFIG.SEVERITIES || ["一般"]).map(function (item) {
      return '<option value="' + escapeHtml(item) + '">' + escapeHtml(item) + "</option>";
    }).join("");

    filterGroup.innerHTML = '<option value="">全部類型</option>' +
      groups.map(function (group) {
        return '<option value="' + escapeHtml(group) + '">' + escapeHtml(group) + "</option>";
      }).join("");
  }

  function bindEvents() {
    document.querySelectorAll(".nav button").forEach(function (button) {
      button.addEventListener("click", function () {
        var page = button.dataset.page;

        if (page === "improvementPage") { openImprovementPage(); }
        else if (page === "listPage") { openListPage(); }
        else { showPage(page); }
      });
    });

    document.querySelectorAll("[data-click]").forEach(function (button) {
      button.addEventListener("click", function () { $(button.dataset.click).click(); });
    });

    document.querySelectorAll("[data-frame]").forEach(function (b) {
      b.addEventListener("click", function () { addFrame(b.dataset.frame); });
    });
    document.querySelectorAll("[data-delframe]").forEach(function (b) {
      b.addEventListener("click", function () { deleteSelectedFrame(b.dataset.delframe); });
    });
    document.querySelectorAll("[data-undo]").forEach(function (b) {
      b.addEventListener("click", function () { undoPhoto(b.dataset.undo); });
    });
    document.querySelectorAll("[data-clear]").forEach(function (b) {
      b.addEventListener("click", function () { clearPhoto(b.dataset.clear); });
    });

    ["beforeFile", "beforeCamera"].forEach(function (id) {
      $(id).addEventListener("change", function (event) { loadPhoto("before", event); });
    });
    ["afterFile", "afterCamera"].forEach(function (id) {
      $(id).addEventListener("change", function (event) { loadPhoto("after", event); });
    });

    $("reportForm").addEventListener("submit", submitReport);
    $("improvementForm").addEventListener("submit", submitImprovement);

    $("reportForm").addEventListener("reset", function () {
      window.setTimeout(function () {
        setValue("project", CONFIG.DEFAULT_PROJECT || "");
        updateAutomaticFields();
      }, 0);
    });

    $("category").addEventListener("change", updateAutomaticFields);
    $("vendor").addEventListener("input", function () { this.dataset.touched = "1"; });

    $("reporterName").addEventListener("change", function () {
      var name = getValue("reporterName");
      saveReporterName(name);
      setValue("improvementReporterName", name);
    });

    $("improvementReporterName").addEventListener("change", function () {
      var name = getValue("improvementReporterName");
      saveReporterName(name);
      setValue("reporterName", name);
    });

    $("improvementReportId").addEventListener("change", renderImprovementDetail);

    $("refreshButton").addEventListener("click", function () { loadReports(true); });

    ["filterStatus", "filterGroup"].forEach(function (id) {
      $(id).addEventListener("change", renderReports);
    });
    $("filterKeyword").addEventListener("input", renderReports);
  }

  function openImprovementPage() {
    updateImprovementOptions();

    var savedName = "";
    try { savedName = localStorage.getItem(NAME_KEY) || ""; } catch (e) { /* 忽略 */ }
    if (savedName) setValue("improvementReporterName", savedName);

    showPage("improvementPage");
  }

  async function openListPage() {
    showPage("listPage");
    await loadReports(true);
  }

  window.addEventListener("load", function () {
    try {
      $("systemName").textContent = CONFIG.SYSTEM_NAME || "現場回報系統";
      document.title = CONFIG.SYSTEM_NAME || "現場回報系統";
      $("modeTag").textContent = USE_REMOTE ? "雲端模式" : "本機示範模式";
      $("dueDaysText").textContent = String(CONFIG.DUE_DAYS || 7);
      $("footerInfo").textContent = (CONFIG.SYSTEM_NAME || "現場回報系統") + "｜" + Api.name;

      setValue("project", CONFIG.DEFAULT_PROJECT || "");

      buildOptions();
      initializeEditors();
      restoreReporterName();
      bindEvents();
      updateAutomaticFields();
      showPage("createPage");

      showMessage(USE_REMOTE
        ? "系統已就緒，請填寫資料並選擇照片。"
        : "目前為本機示範模式：資料只存在這台裝置。要多人共用請在 assets/config.js 填入 Apps Script 網址。", "success");

      loadReports(false);
    } catch (error) {
      console.error(error);
      showMessage("系統初始化失敗：" + getErrorMessage(error), "error");
    }
  });
})();
