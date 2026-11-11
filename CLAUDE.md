# ArmorX Inventory: rules for every change

Read this before changing the app. These are the owner's standing rules. If a change breaks one, ask the owner first.

## The app
* Static web app on GitHub Pages (`index.html`, `app.js`, `cam.js`, `styles.css`, `data/doornets.js`). No build step, no npm packages in the app.
* Shared data: Google Sheet through the Apps Script web app in `google-sheet/Code.gs`. After changing `Code.gs`, the owner must paste it into Apps Script and deploy a new version.
* Workers scan with their own phones (camera) or the USB scanner (Code 128). Everything must work on a phone screen.
* Business account is the office Google account. This repo is public: never commit a PIN, password, key, staff names, sales numbers, or customer data.
* Sign-in (owner, 11 Nov 2026): everyone signs in with employee number (badge, e.g. EMP-78) + their own 4-digit PIN; no name drop-down before sign-in (it would show staff names to anyone with the link). `Code.gs` checks the signed token on every read and write; PINs are only stored hashed in the Workers tab. Levels: Worker (floor work: scan, pick, refill, box count, own undo), Manager (+ dashboard, stock, COUNT/apply counts, batches, labels, scan log), Admin (+ People, PINs, settings). Roles never restrict floor work: staff rotate. A phone stays signed in 30 days. Any new server action must check the level in `Code.gs`, not only hide a button.

## Warehouse rules the code enforces
* Location code: rack letter + side (L/R), column C1-C6, row R1-R5 (R1 = floor). Example `AL-C5-R3`. Extra stock sits on top of the racks (above R5) with no fixed places: location `TOP` (old `2F` labels still scan as TOP).
* Layout v7 (see `LAYOUT.md`): racks A-C, sizes in number order, 210x100 in AR C1-C3 picked from R3, colors always Black, Brown, Grey left to right.
* No R6 boxes for now (owner, 11 Nov 2026): `USE_R6 = false` in `app.js` hides the planned R6 boxes kept in `data/doornets.js`. Only 210x100 keeps backups (AR C1-C3, R1-R5). Pickers only pick from PICK boxes.
* The app follows the floor, not the other way round: boxes hold whatever exists (20, 8, 5 or none). Part-full or empty boxes are never errors.
* First made, first shipped: never put new nets on top of older ones. Rack-in or refill only into an empty box; refills take the oldest batch on top of the racks (`TOP`).
* Classic and Royal are the same stock: one net per size + color.
* Undo: a worker can undo only their own last scan on that device, within 15 minutes, and must pick a reason. Undo refuses if someone changed the same batch, box or count since. Older mistakes are fixed with COUNT.
* Every count that changes stock needs a reason (scan station COUNT, count sheet, box count).
* Box count (opening count, day 14 count): scan each shelf label and type how many are in that box (3-bin box: one number per color), TOP for extra stock on top of the racks. Stock changes only when the manager presses Apply on the Stock page. A net is applied only when all its boxes are counted.
* Put away (opening count, net first, owner 11 Nov 2026): the worker types the size of the net in hand, taps the color, the app shows the box in big letters with a plain hint (rack, side, column, row) and they tap how many they put in. Each tap ADDS to that box's count (event BOXADD, Code.gs v6), so several trips and several phones add up. Box full: Top +N records extra stock on top. Scanning the shelf is optional (confirms or warns). Undo takes only that add back off. Same Box count review and Apply step as Count boxes.
* `Code.gs` reports its version (`v`). Put away needs version 6. Undo and box count stay off until the sheet runs version 4 or later, so an old script never gets events it cannot apply.

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
