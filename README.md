# ArmorX Inventory

A simple inventory and production tracker for ArmorX doornets. It runs in any browser and works with a USB barcode scanner and a thermal label printer.

## Start it

1. Open `index.html` in Chrome on the computer the scanner is plugged into (double-click the file). No install and no internet needed.
2. Or host it on GitHub Pages and open the link.

**Shared data:** connect a Google Sheet (see `google-sheet/SETUP.md`). Every scan is then saved to the sheet, and every computer sees the same stock and batches. Without a sheet, data stays in that browser only.

## Phones (each worker scans with their own phone)

1. The manager sends each worker the **setup link** once (on WhatsApp): `<app link>#setup=<access key>`. The access key is in the Apps Script code, line `ACCESS_KEY`. It is never stored in this repository.
2. The worker opens it in Chrome (Android) or Safari (iPhone), then **Add to Home screen**.
3. They pick their name under **I am**. The phone remembers it.
4. They tap **Scan with camera** and point at a label. Each scan is saved to the Google Sheet. If the network drops, scans wait on the phone and are sent when it is back.

Workers are listed in the sheet's **Workers** tab (Badge, Name, Main step). Sales per day comes from the sheet's **Nets** tab.

## Daily flow

| Step | Who | Scans |
|---|---|---|
| Create batch | Manager | Batches → pick size, color, qty → **Create & print label** (100 × 50 mm) |
| Cutting | Cutter | batch label (phone) or badge → batch label (USB scanner) |
| Stitching · base | Stitcher 1 | badge → batch label |
| Stitching · sides | Stitcher 2 | badge → batch label |
| Final finishing | Stitcher 3 | badge → batch label |
| Packing | Packer | badge → batch label |
| Rack-in | Rack person | badge → batch label → box label (system checks it is the right box) |
| Ship an order | Picker | badge → `CMD-OUT` → box label → quantity |
| FBA shipment | Picker | badge → `CMD-FBA` → box label → quantity |
| Return | Anyone | badge → `CMD-RETURN` (or `CMD-DAMAGED`) → box label → quantity |
| Fix a count | Anyone | badge → `CMD-COUNT` → box label → counted quantity |

If nets are rejected at a step, type the good count and press Enter right after the scan.

## Labels (all Code 128)

* **Batch label** 100 × 50 mm: one per batch, travels through every step.
* **Box labels** 50 × 25 mm: one per rack box, code like `AR-C1-R3` (rack A, right side, column 1, row 3). Row 6 = reserve (25 nets).
* **Worker badges** 50 × 25 mm: `EMP-01` …
* **Command sheet** 50 × 25 mm: OUT, FBA, RETURN, DAMAGED, COUNT, CANCEL, QTY-1/5/10/20/25.

Print from **Setup labels**. In the print dialog choose the thermal printer, set the paper size to the label size and margins to none.

## Files

* `index.html`, `styles.css`, `app.js`: the app.
* `data/doornets.js`: the 234 doornets (78 sizes × Black/Brown/Grey) with rack locations, box counts and refill levels, generated from Amazon sales (YTD to 20 Oct 2026, 90 and 30 days to 27 Oct). Classic and Royal share one stock.
* `google-sheet/Code.gs` and `SETUP.md`: the Google Sheet backend and how to set it up.
* `vendor/JsBarcode.all.min.js`: barcode library (MIT, JsBarcode 3.11.6).
