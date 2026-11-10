# ArmorX Inventory: rules for every change

Read this before changing the app. These are the owner's standing rules. If a change breaks one, ask the owner first.

## The app
* Static web app on GitHub Pages (`index.html`, `app.js`, `cam.js`, `styles.css`, `data/doornets.js`). No build step, no npm packages in the app.
* Shared data: Google Sheet through the Apps Script web app in `google-sheet/Code.gs`. After changing `Code.gs`, the owner must paste it into Apps Script and deploy a new version.
* Workers scan with their own phones (camera) or the USB scanner (Code 128). Everything must work on a phone screen.
* Business account is the office Google account. This repo is public: never commit the access key, sales numbers, or customer data.

## Warehouse rules the code enforces
* Location code: rack letter + side (L/R), column C1-C6, row R1-R5 (R1 = floor), R6 = backup on top. Example `AL-C5-R3`.
* Layout v7 (see `LAYOUT.md`): racks A-C, sizes in number order, 210x100 in AR C1-C3 picked from R3, colors always Black, Brown, Grey left to right.
* R6 is backup only and never empty. Pickers only pick from PICK boxes.
* First made, first shipped: never put new nets on top of older ones. Rack-in or refill only into an empty box; refills take the oldest second-floor (`2F`) batch.
* Classic and Royal are the same stock: one net per size + color.

## Printing
* Everything printed is solid black only. No color, no grey (black-and-white printer).
* All labels except the A4 rack side signs are 50 x 25 mm thermal labels, one per page. Side signs: 3 per A4.

## Before every release
1. `node tests/check-data.js` (no install needed).
2. `node tests/scan-test.js` (needs Playwright) drives the Scan station in a real browser.
3. Both also run on GitHub on every push (Actions tab, "Checks").
4. For a big change, do a separate review pass of the diff before it goes live, and look at it at phone width.
5. Add a test step when you add a new scan command or rule.
