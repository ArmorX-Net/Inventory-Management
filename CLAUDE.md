# ArmorX Inventory: rules for every change

Read this before changing the app. These are the owner's standing rules. If a change breaks one, ask the owner first.

## The app
* Static web app on GitHub Pages (`index.html`, `app.js`, `cam.js`, `styles.css`, `data/doornets.js`, `data/help.js`). No build step, no npm packages in the app.
* Help (owner, 22 Nov 2026): the Help page searches the built-in answers in `data/help.js` (no AI, no keys) and answers box codes and sizes from live data; the same file holds the one-page cheat sheet (Help and Setup labels → Print cheat sheet). When you change words on a screen, update the matching answer there.
* Shared data: Google Sheet through the Apps Script web app in `google-sheet/Code.gs`. After changing `Code.gs`, the owner must paste it into Apps Script and deploy a new version.
* Workers scan with their own phones (camera) or the USB scanner (Code 128). Everything must work on a phone screen.
* Business account is the office Google account. This repo is public: never commit a PIN, password, key, staff names, sales numbers, or customer data.
* Sign-in (owner, 11 Nov 2026): everyone signs in with employee number (badge, e.g. EMP-78) + their own 4-digit PIN; no name drop-down before sign-in (it would show staff names to anyone with the link). `Code.gs` checks the signed token on every read and write; PINs are only stored hashed in the Workers tab. Levels: Worker (floor work: scan, pick, refill, box count, own undo), Manager (+ dashboard, stock, COUNT/apply counts, batches, labels, scan log), Admin (+ People, PINs, settings), Owner (+ reset to zero; only the Owner gives or changes the Owner level). Owner 11 Nov 2026: only the Owner login (EMP-00) is above Worker for now; per-role functions come later. Roles never restrict floor work: staff rotate. A phone stays signed in 30 days. Any new server action must check the level in `Code.gs`, not only hide a button.

## Warehouse rules the code enforces
* Location code: rack letter + side (L/R), column C1-C6, row R1-R5 (R1 = floor). Example `AL-C5-R3`. Extra stock sits on top of the racks (above R5) with no fixed places: location `TOP` (old `2F` labels still scan as TOP).
* Layout v8 (owner, 22 Nov 2026, see `LAYOUT.md`): racks A-D (240 boxes, R1-R5), one size order from 185x80 (AR) to 250x150 (DL), every box holds one size in one colour (no 3-colour boxes), fastest sizes of each side on R3 then R4, R2, slowest on R1/R5, 210x100 in AR C1-C3 on R2-R4 picked from R3, colors always Black, Brown, Grey left to right. Window/exhaust nets start at rack E.
* No R6 boxes for now (owner, 11 Nov 2026): `data/doornets.js` has no R6 boxes (v8); `USE_R6 = false` stays in `app.js`. Only 210x100 keeps backups (AR C1-C3, R2 and R4). Pickers only pick from PICK boxes.
* The app follows the floor, not the other way round: boxes hold whatever exists (20, 8, 5 or none). Part-full or empty boxes are never errors.
* First made, first shipped: never put new nets on top of older ones. Rack-in or refill only into an empty box; refills take the oldest batch on top of the racks (`TOP`).
* Classic and Royal are the same stock: one net per size + color.
* Undo: a worker can undo only their own last scan on that device, within 15 minutes, and must pick a reason. Undo refuses if someone changed the same batch, box or count since. Older mistakes are fixed with COUNT.
* Every count that changes stock needs a reason (scan station COUNT, count sheet, box count).
* Box count (opening count, day 14 count): scan each shelf label and type how many are in that box, TOP for extra stock on top of the racks. Stock changes only when the manager presses Apply on the Stock page. A net is applied only when all its boxes are counted.
* Put away (opening count, net first, owner 11 Nov 2026): the worker types the size of the net in hand, taps the color, the app shows the box in big letters with a plain hint (rack, side, column, row) and they tap how many they put in. Each tap ADDS to stock straight away and to that box's number in the "Put away" tab (event BOXADD, Code.gs v7), so several trips and several phones add up and the dashboard shows it live. No Apply step for put away (owner 11 Nov 2026: inventory must keep updating while counting); the Box count Apply only uses Count boxes numbers, so put away can never be applied twice. Box full: the rest goes on top (owner 22 Nov 2026: stock on top sits in full boxes of 25 nets; one tap = a full box of 25, a box that is not full is typed as its real count; the app shows top stock as boxes, e.g. "2 full boxes + 1 box of 22 = 72"). Scanning the shelf is optional (confirms or warns). Undo takes only that add back off (stock and box number).
* Reset to zero (owner 11 Nov 2026): Owner level only (Settings page, type RESET; Code.gs checks it). Snapshot of Stock, Boxes, Counts and Put away goes to the Snapshots tab first; then those are cleared. Scan log and batches are kept, with a RESET line. Scans made before the reset (offline phone) and undo of older scans are refused.
* IN and OUT (owner 12 Nov 2026): the scan station shows two big buttons at the bottom, IN (put away, BOXADD) and OUT (same steps: size, color, the app shows the box with nets, tap how many; logged as an OUT event with the box, so Code.gs v8 takes it off the box). Keep worker-facing text to what the floor needs: no planning words (no "day 14", no future plans) anywhere in the app.
* Number per box (owner 11 Nov 2026, Code.gs v8): the "In boxes" tab keeps how many nets are in each box and on TOP. Put away and returns add, picks from a box take off (never below 0), rack-in adds, box count Apply sets it, a manager sets one box on the Rack map (BOXQTY, reason needed) and the total per net moves by the difference. Stock (total per net) stays the master; "Not in a box" = total minus boxes minus TOP.
* Excel (Stock page): download .xlsx (one row per net and box + TOP); upload .xlsx or .csv shows every change and refused row first, needs a reason, each row is logged as "Excel upload UP-…", and the last upload can be undone (rows changed since are kept).
* Snapshots (Code.gs v8): daily copy at 23:00 (DAY-yyyyMMdd, kept 30 days), plus before every reset and restore. Restore (Admin, Settings, preview, type RESTORE) puts Stock, Boxes, Counts and In boxes back; scan log kept.
* Pick list Final (owner 22 Nov 2026, Code.gs v9): a manager taps Final, then Yes: the whole list comes off stock once (event PICKLIST, Manager level, "Pick lists" tab; never more than is in stock). OUT of a net on an open list only ticks the list (PICKED, takes it off the box, not off stock). Not picked: a manager sends it back to stock or marks it not on the shelf (PICKBACK). Undo of a pick un-ticks it.
* Camera (owner 22 Nov 2026): after a good scan the camera closes and the screen it came from is filled in; it stays open after a wrong code or when a box label is next.
* Shelf labels (owner 22 Nov 2026): size and colour big and bold, box code small underneath, barcode = box code. Same label on the shelf and on the box front.
* `Code.gs` reports its version (`v`). Pick list Final needs version 9. Put away and reset need version 7; box change, Excel upload and restore need version 8. Undo and box count stay off until the sheet runs version 4 or later, so an old script never gets events it cannot apply.

## Printing
* Everything printed is solid black only. No color, no grey (black-and-white printer).
* All labels except the A4 rack side signs are 50 x 25 mm thermal labels, one per page. Side signs: 3 per A4.

## Before every release
1. `node tests/check-data.js` (no install needed).
2. `node tests/scan-test.js` (needs Playwright) drives the Scan station in a real browser.
3. `node tests/sheet-test.js` (no install needed) runs `Code.gs` against a fake sheet.
4. All three also run on GitHub on every push (Actions tab, "Checks").
5. For a big change, do a separate review pass of the diff before it goes live, and look at it at phone width.
6. Add a test step when you add a new scan command or rule.
