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

## Rack layout (v7, final for the 2-week trial)

See [LAYOUT.md](LAYOUT.md). In short: doornets on racks A–C, sizes in number order, popular sizes on R2–R4, slow sizes on R1/R5, extra stock on top of the racks (`TOP`, no R6 boxes for now), 210×100 in AR columns 1–3 (pick from R3). Colors always Black, Brown, Grey left to right. `2F` is the second floor.

## Daily flow

| Step | Who | Scans |
|---|---|---|
| Create batch | Manager | Batches → pick size, color, qty → **Create & print label** (100 × 50 mm). **Box tags** prints one copy per 20 nets, with the production date. |
| Cutting … Packing | Each worker | badge (or "I am" on the phone) → batch label |
| Rack-in | Rack person | batch label → `TOP` (extra stock on top of the racks) or an **empty** home box. A box that still has older nets is refused (first made, first shipped). |
| Ship an order | Picker | `CMD-OUT` → **pick box** (3-bin box: tap the color) → quantity. Backup boxes are refused. |
| FBA shipment | Picker | `CMD-FBA` → box label → quantity |
| Pick box empty | Picker | `CMD-EMPTY` → the box; it goes on the refill list. 210×100 only: `CMD-SWAP` → the backup box brought over. |
| Refill every 3–4 days | Rack person | **Refill list** tab → fill each empty box from the oldest batch on top of the racks → `CMD-REFILL` → the box |
| Return | Anyone | `CMD-RETURN` (or `CMD-DAMAGED`) → pick box → quantity |
| Fix a count | Anyone | `CMD-COUNT` → any box of the net → total quantity (boxes + top of racks). If it is different from the system, tap a reason. |
| Undo my last scan | The same worker | **Undo my last scan** button (or `CMD-UNDO`) within 15 minutes → tap why. Only your own last scan on that device. |
| Box count (opening count, day 14) | Anyone | **Count boxes** (or `CMD-BOXCOUNT`) → shelf label → how many in that box (3-bin box: one number per color). `TOP` → size + color → number. Then the manager opens **Stock → Box count → Review and apply**, picks a reason and presses **Apply**. |

If nets are rejected at a step, type the good count and press Enter right after the scan.

## Labels (all Code 128)

* **Batch label / box tag** 100 × 50 mm: batch number, size, color and **production date**. One goes on each box filled from the batch.
* **Shelf labels** 50 × 25 mm: one per box slot, stuck on the shelf edge and never moved. Code like `AR-C1-R3`, with size, color (or BLACK | BROWN | GREY for a 3-bin box) and PICK or BACKUP (striped).
* **Side signs** A4: side letter and size range, one at the end of each side.
* **Worker badges** 50 × 25 mm: `EMP-01` …
* **Command sheet** 50 × 25 mm: OUT, FBA, SWAP, REFILL, EMPTY, RETURN, DAMAGED, COUNT, CANCEL, UNDO, BOX COUNT, QTY-1/5/10/20/25 and the `TOP` location (extra stock on top of the racks).

Print from **Setup labels**. In the print dialog choose the thermal printer, set the paper size to the label size and margins to none (side signs: A4 landscape).

## Files

* `index.html`, `styles.css`, `app.js`: the app.
* `data/doornets.js`: layout v7. The 234 doornets (78 sizes × Black/Brown/Grey) with pick box, backup boxes and refill levels, plus every box slot (`BOXES`), side ranges and the 210×100 exception. Generated from Amazon sales (YTD to 20 Oct 2026, 90 and 30 days to 27 Oct). Classic and Royal share one stock.
* `google-sheet/Code.gs` and `SETUP.md`: the Google Sheet backend and how to set it up.
* `vendor/JsBarcode.all.min.js`: barcode library (MIT, JsBarcode 3.11.6).
* `tests/`: automatic checks (layout data, secrets, print rule, and the Scan station rules in a real browser). They run on GitHub on every push. `CLAUDE.md` lists the rules every change must follow.
