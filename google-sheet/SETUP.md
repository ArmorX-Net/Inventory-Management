# Connect ArmorX Inventory to a Google Sheet

This is the same method your retail shop app uses: a small Google Apps Script sits behind the sheet, and the app sends every scan to it. Takes about 10 minutes, once.

## 1. Make the sheet
1. Go to sheets.google.com and create a blank sheet. Name it **ArmorX Inventory**.
2. Menu **Extensions → Apps Script**. A code editor opens.
3. Delete what is there and paste everything from `Code.gs` (in this folder).
4. Click **Save** (disk icon). There is no password to type in the code: people sign in with their own PIN (see Version 5 below).

## 2. Create the tabs
1. In the function dropdown at the top choose **setup**, then click **Run**.
2. Google asks for permission the first time: click **Review permissions**, pick your account, **Advanced → Go to (unsafe)**, **Allow**. It is your own script.
3. Back in the sheet you now have four tabs: **Scans, Batches, Stock, Workers**.

## 3. Publish it as a web app
1. In Apps Script click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**.
4. Click **Deploy** and copy the **Web app URL** (it ends with `/exec`).

## 4. Connect each phone or computer
Open the app link and sign in with your employee number and PIN. That is all: the app already knows the sheet's web app link. The top-right badge shows **SHEET · synced**.

## What lands in the sheet
* **Scans**: every scan, one row each: time, type, worker, batch, net, qty, box, computer.
* **Batches**: one row per batch label, with who did Cutting, Base, Sides, Finish, Packing and Rack-in, and when.
* **Stock**: on-hand count per net. Changes with rack-in, OUT, FBA, RETURN and COUNT.
* **Workers**: badge codes and names.

The sheet is the master copy. Don't type into the Batches or Stock tabs by hand; use COUNT scans to correct stock so every change is recorded.

## If the internet drops
Scans are kept on the computer and sent automatically when the connection comes back. The badge shows how many are waiting.

## Version 4 (undo and box count)
Paste the new `Code.gs`, then deploy a new version as below. The **Counts** tab and the **Reason** column in Scans are added by themselves the first time the app reads the sheet (or run **setup** once). Until the new version is deployed, the app keeps Undo and Count boxes switched off.
* **Counts**: box counts in progress, one row per box and net. Rows leave this tab when the manager presses Apply.
* **Scans → Reason**: why a count was changed or a scan was undone. Undone scans get "UNDONE" at the end of their note.

## When you change Code.gs later
Use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**, so the URL stays the same.

**Version 7 (11 Nov 2026):** put away goes into stock at once (new **Put away** tab keeps the number per box), the **Owner** level, and **Reset to zero** (Owner only; a copy goes to the new **Snapshots** tab first). Paste, Save, run **setup** once (adds the two tabs), deploy a new version. Then set your own row in the Workers tab to Level **Owner**.

**Version 8 (11 Nov 2026):** number per box (the **Put away** tab is renamed **In boxes** by itself), box change, Excel upload, daily snapshot and restore. Paste, Save, run **setup** once: Google asks for one new permission ("run when you are not present"), which the daily copy at 23:00 needs. Then deploy a new version.

## Version 5 (sign-in with a PIN)
Nobody can read or change anything without signing in. The check happens in this script on every read and every scan, so the public app link alone shows nothing.

**Install (once):** paste the new `Code.gs` over the old one (the old access key line is gone, nothing to keep), click **Save**, choose **setup** in the function list and click **Run** (allow it if Google asks), then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Phones that were set up with the old setup link will show the sign-in screen.

**Workers tab columns**
* **Level**: `Worker` (scan, pick, refill, count boxes), `Manager` (+ dashboard, stock page, apply counts, COUNT, batch labels, setup labels, scan log), `Admin` (+ People page, PINs, settings). Empty = Worker.
* **Active**: `Yes` or `No`. `No` signs that person out on every phone at once and stops their sign-in.
* **New PIN**: type 4 digits here to set or reset someone's PIN. Within a minute the script moves it into **PIN hash** and clears this cell, so the PIN itself is never stored. Anything that is not 4 digits shows "PIN must be 4 digits".
* **PIN hash**, **Wrong tries**, **Locked until**, **Last sign-in**: filled by the script. Don't type in them. To unlock someone, clear **Locked until** and **Wrong tries** (or use Unlock on the People page).

**Safety rules in the script**
* 5 wrong PINs in a row lock that badge for 15 minutes; each further lock doubles (30 min, 1 h, … up to a day). A right PIN or an unlock resets it.
* A phone stays signed in for 30 days, then asks for the PIN again. A new PIN or Active = No ends the sign-in at once.
* The name on every scan is the person signed in, whatever the phone sends. Workers see only their own scans and no sales rates. Workers cannot change counts, create batch labels or change people.
* The secret used to sign the sign-ins is created by the script and kept in **Project Settings → Script Properties** (`SIGNIN_SECRET`). Deleting it signs everyone out and makes all PINs need resetting.
