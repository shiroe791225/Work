#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
產生測試資料：一份結構符合規格的「使照勘驗缺失紀錄表.xlsx」+ 對應的「照片/」資料夾。

用途：
    驗證 build_photo_report.py 在各種情境下都能正確運作，包含：
      - 一般情境：改善前/改善後子資料夾、無子資料夾（視為改善前）
      - 邊界情境：資料夾不存在、資料夾存在但空白、孤兒資料夾（主表查無編號）
      - 四種狀態：已改善／待複查／改善中／逾期 都各出現至少一筆
      - EXIF 方向：故意產生一張「感光元件橫向拍攝 + Orientation=6」的照片，
        驗證程式是否正確校正成直式而不是躺平
      - 壓縮：故意產生一張解析度很大、檔案很肥的照片，驗證縮圖＋壓縮有效果

用法：
    python tests/generate_test_data.py                      # 預設：10 筆精選情境資料
    python tests/generate_test_data.py --rows 65 --photos-per 2   # 觸發分組分頁門檻
    python tests/generate_test_data.py --rows 50 --photos-per 3   # 驗收標準的容量情境
    python tests/generate_test_data.py --out 自訂輸出資料夾
"""

from __future__ import annotations

import argparse
import random
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from PIL import Image, ImageDraw

TITLE_BLUE = "1F3864"
LIGHT_BLUE = "D6E4F0"
YELLOW = "FFF2CC"
HEADER_GREY = "595959"
HEADER_BLUE = "2E75B6"
DATA_GREY = "EDEDED"
OVERDUE_RED = "FFE4E4"

ITEMS = [
    "防火避難設施", "消防安全設備", "結構安全", "無障礙設施", "機電設備",
    "外牆及帷幕牆", "屋頂及排水", "樓梯及欄杆", "window", "電梯設備",
    "污水處理設施", "停車空間", "逃生標示", "防水工程", "給排水管線",
    "瓦斯安全設備", "照明設備", "通風採光", "庭園及景觀", "其他",
]
REVIEW_OPTIONS = ["合格", "不合格", "未複查"]


# ----------------------------------------------------------------------
# 建立 Excel 主表
# ----------------------------------------------------------------------

def _thin_border():
    side = Side(style="thin", color="BFBFBF")
    return Border(left=side, right=side, top=side, bottom=side)


def _fill(color):
    return PatternFill(start_color=color, end_color=color, fill_type="solid")


def build_workbook(rows: list[dict]) -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "勘驗紀錄"

    headers = [
        "編號", "發現日期", "位置（樓層/區域）", "查驗項目", "缺失記錄", "照片編號",
        "責任單位/廠商", "改善期限", "改善完成日", "複查結果", "狀態", "備註",
    ]

    ws.merge_cells("A1:L1")
    ws["A1"] = "使用執照 現場勘驗缺失紀錄表（測試資料）"
    ws["A1"].font = Font(name="Arial", size=15, bold=True, color="FFFFFF")
    ws["A1"].fill = _fill(TITLE_BLUE)
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 31.5

    ws.merge_cells("A2:L2")
    ws["A2"] = "白底欄位由人員填寫，灰底欄位（編號、狀態）自動計算請勿輸入。此為測試資料，可任意覆蓋。"
    ws["A2"].font = Font(name="Arial", size=9, color="404040")
    ws["A2"].fill = _fill(LIGHT_BLUE)
    ws["A2"].alignment = Alignment(horizontal="general", vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 31.5

    info_pairs = [("A3", "工程名稱"), ("D3", "起造人"), ("F3", "建照號碼"), ("H3", "勘驗日期"), ("J3", "勘驗單位/人員")]
    ws.merge_cells("B3:C3")
    ws.merge_cells("K3:L3")
    for coord, label in info_pairs:
        c = ws[coord]
        c.value = label
        c.font = Font(name="Arial", size=10, bold=True)
        c.fill = _fill(LIGHT_BLUE)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = _thin_border()
    ws["B3"] = "測試工程"
    ws["K3"] = "測試單位"
    for coord in ("B3", "E3", "G3", "I3", "K3"):
        ws[coord].fill = _fill(YELLOW)
        ws[coord].border = _thin_border()
    ws.row_dimensions[3].height = 24

    legend = [("A4", "圖例"), ("B4", "人員填寫"), ("C4", "自動計算"), ("D4", "已改善"), ("E4", "待複查"), ("F4", "改善中"), ("G4", "逾期未改善")]
    for coord, label in legend:
        c = ws[coord]
        c.value = label
        c.font = Font(name="Arial", size=9)
        c.border = _thin_border()
    ws.row_dimensions[4].height = 19.5

    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=5, column=i, value=h)
        c.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
        c.fill = _fill(HEADER_GREY if i in (1, 11) else HEADER_BLUE)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = _thin_border()
    ws.row_dimensions[5].height = 30

    widths = {"A": 9, "B": 11, "C": 20, "D": 16, "E": 38, "F": 12, "G": 14, "H": 11, "I": 11, "J": 12, "K": 10, "L": 24}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    last_row = 5 + 120
    for row_idx in range(6, last_row + 1):
        a = ws.cell(row=row_idx, column=1, value=f'=IF($E{row_idx}="","","D-"&TEXT(ROW()-5,"000"))')
        a.font = Font(name="Arial", size=10)
        a.fill = _fill(DATA_GREY)
        a.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        a.border = _thin_border()

        k = ws.cell(
            row=row_idx,
            column=11,
            value=(
                f'=IF($E{row_idx}="","",IF($J{row_idx}="合格","已改善",'
                f'IF(AND($H{row_idx}<>"",$H{row_idx}<TODAY(),$I{row_idx}=""),"逾期",'
                f'IF($I{row_idx}<>"","待複查","改善中"))))'
            ),
        )
        k.font = Font(name="Arial", size=10)
        k.fill = _fill(DATA_GREY)
        k.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        k.border = _thin_border()

        for col_idx in range(2, 11):
            if col_idx == 11:
                continue
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.font = Font(name="Arial", size=10)
            cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            cell.border = _thin_border()
        ws.cell(row=row_idx, column=12).border = _thin_border()
        ws.row_dimensions[row_idx].height = 24

        data = next((d for d in rows if d["row"] == row_idx), None)
        if data:
            ws.cell(row=row_idx, column=2, value=data.get("found_date"))
            ws.cell(row=row_idx, column=3, value=data.get("location"))
            ws.cell(row=row_idx, column=4, value=data.get("item"))
            ws.cell(row=row_idx, column=5, value=data.get("defect_text"))
            ws.cell(row=row_idx, column=6, value=data.get("photo_no", ""))
            ws.cell(row=row_idx, column=7, value=data.get("responsible", ""))
            ws.cell(row=row_idx, column=8, value=data.get("deadline"))
            ws.cell(row=row_idx, column=9, value=data.get("completed"))
            ws.cell(row=row_idx, column=10, value=data.get("review"))
            ws.cell(row=row_idx, column=12, value=data.get("note", ""))
            if isinstance(data.get("found_date"), datetime):
                ws.cell(row=row_idx, column=2).number_format = "yyyy/mm/dd"
            if isinstance(data.get("deadline"), datetime):
                ws.cell(row=row_idx, column=8).number_format = "yyyy/mm/dd"
            if isinstance(data.get("completed"), datetime):
                ws.cell(row=row_idx, column=9).number_format = "yyyy/mm/dd"

    ws.freeze_panes = "C6"
    ws.auto_filter.ref = f"A5:L{last_row}"

    # --- 選單分頁 ---
    menu = wb.create_sheet("選單")
    menu["A3"] = "查驗項目選項"
    menu["B3"] = "複查結果選項"
    for i, item in enumerate(ITEMS, start=4):
        menu.cell(row=i, column=1, value=item)
    for i, opt in enumerate(REVIEW_OPTIONS, start=4):
        menu.cell(row=i, column=2, value=opt)

    dv_item = DataValidation(type="list", formula1="選單!$A$4:$A$43", allow_blank=True)
    dv_review = DataValidation(type="list", formula1="選單!$B$4:$B$43", allow_blank=True)
    ws.add_data_validation(dv_item)
    ws.add_data_validation(dv_review)
    dv_item.add(f"D6:D{last_row}")
    dv_review.add(f"J6:J{last_row}")

    # --- 條件式格式：K 欄狀態上色 + 逾期整列變紅 ---
    ws.conditional_formatting.add(
        f"K6:K{last_row}",
        CellIsRule(operator="equal", formula=['"已改善"'], fill=_fill("C6EFCE"), font=Font(color="006100")),
    )
    ws.conditional_formatting.add(
        f"K6:K{last_row}",
        CellIsRule(operator="equal", formula=['"待複查"'], fill=_fill("DDEBF7"), font=Font(color="1F4E79")),
    )
    ws.conditional_formatting.add(
        f"K6:K{last_row}",
        CellIsRule(operator="equal", formula=['"改善中"'], fill=_fill("FFEB9C"), font=Font(color="9C5700")),
    )
    ws.conditional_formatting.add(
        f"K6:K{last_row}",
        CellIsRule(operator="equal", formula=['"逾期"'], fill=_fill("FFC7CE"), font=Font(color="9C0006")),
    )
    ws.conditional_formatting.add(
        f"A6:L{last_row}",
        FormulaRule(formula=["$K6=\"逾期\""], fill=_fill(OVERDUE_RED)),
    )

    # --- 統計分頁（簡化版，公式邏輯與正式版一致） ---
    stats = wb.create_sheet("統計")
    stats["A1"] = "缺失改善統計"
    stats["A4"] = "整體"
    stats["A5"], stats["B5"] = "缺失總件數", f"=COUNTA({ws.title}!$E$6:$E${last_row})"
    stats["A6"], stats["B6"] = "已改善", f'=COUNTIF({ws.title}!$K:$K,"已改善")'
    stats["A7"], stats["B7"] = "待複查", f'=COUNTIF({ws.title}!$K:$K,"待複查")'
    stats["A8"], stats["B8"] = "改善中", f'=COUNTIF({ws.title}!$K:$K,"改善中")'
    stats["A9"], stats["B9"] = "逾期未改善", f'=COUNTIF({ws.title}!$K:$K,"逾期")'
    stats["A10"], stats["B10"] = "改善完成率", "=IF(B5=0,0,B6/B5)"

    # --- 查驗項目參考分頁（靜態資料，簡化） ---
    ref = wb.create_sheet("查驗項目參考")
    ref["A1"], ref["B1"], ref["C1"] = "查驗項目", "重點說明", "備註"
    for i, item in enumerate(ITEMS, start=2):
        ref.cell(row=i, column=1, value=item)
        ref.cell(row=i, column=2, value=f"{item} 常見檢查重點（測試資料）")

    return wb


# ----------------------------------------------------------------------
# 建立測試照片
# ----------------------------------------------------------------------

def make_normal_photo(path: Path, color, label: str, size=(1200, 900)):
    img = Image.new("RGB", size, color)
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, size[0] - 20, size[1] - 20], outline=(255, 255, 255), width=6)
    draw.text((40, 40), label, fill=(255, 255, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="JPEG", quality=90)


def make_rotated_exif_photo(path: Path):
    """
    模擬手機直拍：感光元件實際存成橫向 1600x1200，並標記 EXIF Orientation=6
    （需順時針旋轉 90 度才是人眼看到的直式畫面）。
    用來驗證程式是否會「先套用 EXIF 再存檔」，而不是把照片存成躺平的樣子。
    """
    w, h = 1600, 1200
    img = Image.new("RGB", (w, h), (30, 120, 200))
    draw = ImageDraw.Draw(img)
    # 畫一個只在「正確方向」才看起來正常的箭頭／文字（上方留白+文字朝上）
    draw.rectangle([0, 0, w, 200], fill=(255, 255, 255))
    draw.text((40, 60), "TOP (should be up after rotation)", fill=(0, 0, 0))
    draw.polygon([(w // 2, 220), (w // 2 - 60, 320), (w // 2 + 60, 320)], fill=(255, 255, 255))

    exif = img.getexif()
    exif[0x0112] = 6  # Orientation = 6 (rotate 90 CW to display correctly)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="JPEG", quality=90, exif=exif)


def make_heavy_photo(path: Path, size=(3200, 4000)):
    """模擬手機原始大圖（高解析度 + 隨機雜訊內容，壓不太下去），驗證縮圖＋壓縮效果。"""
    rng = random.Random(42)
    noise = bytes(rng.getrandbits(8) for _ in range(size[0] * size[1] * 3 // 50))
    img = Image.new("RGB", size, (200, 200, 200))
    draw = ImageDraw.Draw(img)
    # 貼一些亂數色塊製造高頻細節，讓 JPEG 不容易壓縮
    rng2 = random.Random(7)
    for _ in range(400):
        x0 = rng2.randrange(0, size[0] - 50)
        y0 = rng2.randrange(0, size[1] - 50)
        color = (rng2.randrange(255), rng2.randrange(255), rng2.randrange(255))
        draw.rectangle([x0, y0, x0 + 50, y0 + 50], fill=color)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="JPEG", quality=95)


# ----------------------------------------------------------------------
# 精選情境資料（預設模式）
# ----------------------------------------------------------------------

def curated_rows() -> list[dict]:
    today = date.today()
    rows = [
        dict(  # row 6 -> D-001：改善前/改善後子資料夾、含 EXIF 旋轉照 + 大圖壓縮測試，狀態=待複查
            row=6, found_date=datetime.combine(today - timedelta(days=10), datetime.min.time()),
            location="3F 東側走廊", item="防火避難設施",
            defect_text="防火門閉門器失效，門扇無法自動關閉至定位；門框與牆面縫隙未填塞防火材",
            responsible="門窗_興達", deadline=datetime.combine(today + timedelta(days=5), datetime.min.time()),
            completed=datetime.combine(today - timedelta(days=1), datetime.min.time()), review=None,
        ),
        dict(  # D-002：無子資料夾，照片直接放資料夾下 -> 視為改善前，狀態=已改善
            row=7, found_date=datetime.combine(today - timedelta(days=20), datetime.min.time()),
            location="2F 消防栓室", item="消防安全設備",
            defect_text="室內消防栓箱內水帶未依規定摺疊收納，瞄子遺失",
            responsible="消防_安泰", deadline=datetime.combine(today - timedelta(days=5), datetime.min.time()),
            completed=datetime.combine(today - timedelta(days=8), datetime.min.time()), review="合格",
        ),
        dict(  # D-003：資料夾存在但空白（測試警告）
            row=8, found_date=datetime.combine(today - timedelta(days=3), datetime.min.time()),
            location="1F 大廳", item="無障礙設施",
            defect_text="無障礙坡道坡度超過規定值，扶手高度不足",
            responsible="土建_大成", deadline=datetime.combine(today + timedelta(days=14), datetime.min.time()),
            completed=None, review=None,
        ),
        dict(  # D-004：主表有缺失但完全沒有照片資料夾（測試警告）
            row=9, found_date=datetime.combine(today - timedelta(days=1), datetime.min.time()),
            location="B1 機電室", item="機電設備",
            defect_text="發電機排煙管保溫層破損",
            responsible="機電_永昌", deadline=datetime.combine(today + timedelta(days=30), datetime.min.time()),
            completed=None, review=None,
        ),
        dict(  # D-005：逾期（改善期限已過、未填改善完成日）
            row=10, found_date=datetime.combine(today - timedelta(days=40), datetime.min.time()),
            location="5F 露臺", item="外牆及帷幕牆",
            defect_text="帷幕牆矽利康填縫老化龜裂，多處有滲水痕跡",
            responsible="帷幕_明耀", deadline=datetime.combine(today - timedelta(days=10), datetime.min.time()),
            completed=None, review=None,
        ),
        dict(  # D-006：改善中（有照片，狀態一般）
            row=11, found_date=datetime.combine(today - timedelta(days=2), datetime.min.time()),
            location="屋頂水箱", item="屋頂及排水",
            defect_text="屋頂排水溝堆積雜物，排水不良",
            responsible="土建_大成", deadline=datetime.combine(today + timedelta(days=20), datetime.min.time()),
            completed=None, review=None,
        ),
    ]
    # row 12 -> E 欄留空，測試「非缺失列」不應被計入
    return rows


def build_photos_for_curated(photo_root: Path) -> None:
    # D-001：改善前/改善後 + 旋轉照 + 大圖
    make_normal_photo(photo_root / "D-001" / "改善前" / "IMG_1001.jpg", (200, 60, 60), "D-001 BEFORE 1")
    make_rotated_exif_photo(photo_root / "D-001" / "改善前" / "IMG_1002.jpg")
    make_heavy_photo(photo_root / "D-001" / "改善前" / "IMG_1003_big.jpg")
    make_normal_photo(photo_root / "D-001" / "改善後" / "IMG_1101.jpg", (60, 160, 60), "D-001 AFTER 1")

    # D-002：無子資料夾，直接放檔案
    make_normal_photo(photo_root / "D-002" / "IMG_2001.jpg", (60, 60, 200), "D-002 PHOTO 1")
    make_normal_photo(photo_root / "D-002" / "IMG_2002.png", (60, 60, 160), "D-002 PHOTO 2")

    # D-003：資料夾存在但空白
    (photo_root / "D-003").mkdir(parents=True, exist_ok=True)

    # D-004：完全不建資料夾（故意不做任何事）

    # D-005：逾期案例也放張照片
    make_normal_photo(photo_root / "D-005" / "改善前" / "IMG_5001.jpg", (200, 120, 40), "D-005 BEFORE 1")

    # D-006
    make_normal_photo(photo_root / "D-006" / "改善前" / "IMG_6001.jpg", (120, 80, 200), "D-006 BEFORE 1")
    make_normal_photo(photo_root / "D-006" / "改善後" / "IMG_6101.jpg", (80, 200, 160), "D-006 AFTER 1")

    # 孤兒資料夾：主表查無此編號
    make_normal_photo(photo_root / "D-099" / "IMG_9999.jpg", (100, 100, 100), "ORPHAN D-099")


# ----------------------------------------------------------------------
# 大量情境資料（--rows N，用於測試分組門檻 / 容量驗收）
# ----------------------------------------------------------------------

def bulk_rows(n: int) -> list[dict]:
    today = date.today()
    rows = []
    for i in range(n):
        row = 6 + i
        cycle = i % 4
        if cycle == 0:  # 已改善
            completed = datetime.combine(today - timedelta(days=5), datetime.min.time())
            review = "合格"
            deadline = datetime.combine(today + timedelta(days=5), datetime.min.time())
        elif cycle == 1:  # 待複查
            completed = datetime.combine(today - timedelta(days=1), datetime.min.time())
            review = None
            deadline = datetime.combine(today + timedelta(days=5), datetime.min.time())
        elif cycle == 2:  # 逾期
            completed = None
            review = None
            deadline = datetime.combine(today - timedelta(days=3), datetime.min.time())
        else:  # 改善中
            completed = None
            review = None
            deadline = datetime.combine(today + timedelta(days=15), datetime.min.time())

        rows.append(
            dict(
                row=row,
                found_date=datetime.combine(today - timedelta(days=i % 30), datetime.min.time()),
                location=f"{(i % 10) + 1}F 測試區",
                item=ITEMS[i % len(ITEMS)],
                defect_text=f"測試缺失內容第 {i + 1} 筆，用於驗證大量資料情境。",
                responsible=f"測試廠商_{i % 5}",
                deadline=deadline,
                completed=completed,
                review=review,
            )
        )
    return rows


def build_photos_for_bulk(photo_root: Path, rows: list[dict], photos_per: int) -> None:
    colors = [(200, 60, 60), (60, 160, 60), (60, 60, 200), (200, 160, 40), (160, 60, 200)]
    for d in rows:
        defect_id = f"D-{d['row'] - 5:03d}"
        for p in range(photos_per):
            category = "改善前" if p == 0 else "改善後"
            color = colors[(d["row"] + p) % len(colors)]
            make_normal_photo(
                photo_root / defect_id / category / f"IMG_{d['row']:03d}_{p}.jpg",
                color,
                f"{defect_id} {category} {p}",
                size=(900, 700),
            )


# ----------------------------------------------------------------------
# 主程式
# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="產生 build_photo_report.py 的測試資料")
    parser.add_argument("--out", default=None, help="輸出資料夾（預設：tests/sample_data）")
    parser.add_argument("--rows", type=int, default=None, help="產生 N 筆大量測試資料（不指定則用預設精選情境）")
    parser.add_argument("--photos-per", type=int, default=2, help="每筆缺失的照片數量（搭配 --rows 使用）")
    args = parser.parse_args()

    out_dir = Path(args.out) if args.out else Path(__file__).parent / "sample_data"
    out_dir.mkdir(parents=True, exist_ok=True)
    photo_root = out_dir / "照片"

    if args.rows:
        rows = bulk_rows(args.rows)
        wb = build_workbook(rows)
        build_photos_for_bulk(photo_root, rows, args.photos_per)
        print(f"已產生大量測試資料：{args.rows} 筆缺失 × 每筆 {args.photos_per} 張照片")
    else:
        rows = curated_rows()
        wb = build_workbook(rows)
        build_photos_for_curated(photo_root)
        print("已產生預設精選情境測試資料（涵蓋四種狀態、EXIF旋轉、壓縮、各種資料夾例外情況）")

    xlsx_path = out_dir / "使照勘驗缺失紀錄表.xlsx"
    wb.save(xlsx_path)
    print(f"Excel 測試檔：{xlsx_path}")
    print(f"照片測試資料夾：{photo_root}")


if __name__ == "__main__":
    main()
