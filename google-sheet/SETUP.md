# Connect ArmorX Inventory to a Google Sheet

This is the same method your retail shop app uses: a small Google Apps Script sits behind the sheet, and the app sends every scan to it. Takes about 10 minutes, once.

## 1. Make the sheet
1. Go to sheets.google.com and create a blank sheet. Name it **ArmorX Inventory**.
2. Menu **Extensions → Apps Script**. A code editor opens.
3. Delete what is there and paste everything from `Code.gs` (in this folder).
4. On line 11, change `change-me` to your own secret word, for example `armorx-2026-net`. Keep the quotes.
5. Click **Save** (disk icon).

## 2. Create the tabs
1. In the function dropdown at the top choose **setup**, then click **Run**.
2. Google asks for permission the first time: click **Review permissions**, pick your account, **Advanced → Go to (unsafe)**, **Allow**. It is your own script.
3. Back in the sheet you now have four tabs: **Scans, Batches, Stock, Workers**.

## 3. Publish it as a web app
1. In Apps Script click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**.
4. Click **Deploy** and copy the **Web app URL** (it ends with `/exec`).

## 4. Connect each computer
1. Open the app (`index.html`), go to **Settings → Google Sheet**.
2. Paste the web app URL, type the same secret word as the access key, and give the computer a name (e.g. "Stitching PC").
3. Click **Connect**. The top-right badge turns to **SHEET · synced**.
4. On the first computer, click **Send workers to sheet** so badges are shared.

## What lands in the sheet
* **Scans**: every scan, one row each: time, type, worker, batch, net, qty, box, computer.
* **Batches**: one row per batch label, with who did Cutting, Base, Sides, Finish, Packing and Rack-in, and when.
* **Stock**: on-hand count per net. Changes with rack-in, OUT, FBA, RETURN and COUNT.
* **Workers**: badge codes and names.

The sheet is the master copy. Don't type into the Batches or Stock tabs by hand; use COUNT scans to correct stock so every change is recorded.

## If the internet drops
Scans are kept on the computer and sent automatically when the connection comes back. The badge shows how many are waiting.

## When you change Code.gs later
Use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**, so the URL stays the same.
