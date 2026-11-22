// Help screen and printable cheat sheet. Plain words for the floor. Edit the answers here; the app searches them.
// Rules: words must match what the app shows; no planning words; part-full or empty boxes are normal, never an error.
// Each entry: t = topic, q = question, k = extra search words, a = answer (simple HTML: <b>, <br>, <ul><li>).
window.HELP_TOPICS = ['Box codes and racks', 'Rack map', 'IN and OUT', 'Scan station', 'Counting', 'Mistakes', 'Stock and dashboard', 'Printing', 'Sign-in'];
window.HELP_QA = [
  // ---- box codes and racks ----
  { t: 'Box codes and racks', q: 'What does a box code like AL-C5-R3 mean?', k: 'location code address shelf label rack side column row where read',
    a: 'Read it in three parts:<ul><li><b>AL</b> = rack <b>A</b>, <b>L</b>eft side (R = right side). The big side sign at the end of each rack side shows this code.</li><li><b>C5</b> = column 5. Columns go C1 to C6, left to right as you face that side.</li><li><b>R3</b> = row 3. R1 is the floor, R5 is the top row.</li></ul>Tip: type any box code in the Help search and the app tells you what is in that box.' },
  { t: 'Box codes and racks', q: 'What is TOP?', k: 'top of the racks extra stock above r5 2f second floor overflow bulk',
    a: '<b>TOP</b> is the extra stock that sits on top of the racks, above R5. It has no fixed places. Scan the <b>TOP</b> label (on the command sheet) when nets go up there or come down from there. Old labels that say 2F still scan as TOP.' },
  { t: 'Box codes and racks', q: 'Where does each size go?', k: 'which box find size order layout rack a b c d side range where',
    a: 'Sizes run in number order: <b>185x80</b> starts on rack A right side (AR) and <b>250x150</b> ends on rack D left side (DL). Every box holds <b>one size in one color</b>. Colors are always <b>Black, Brown, Grey</b> from left to right.<br>Easiest ways to find a box: type the size here in Help, tap <b>IN</b> on the Scan station, or use <b>Find a size</b> on the Rack map.' },
  { t: 'Box codes and racks', q: 'Why are some sizes on the floor row or the top row?', k: 'r1 r5 r3 height fast slow popular waist',
    a: 'The sizes that sell most sit at easy height: <b>R3</b> first, then R4 and R2. Sizes that sell less sit on <b>R1</b> (floor) and <b>R5</b> (top row).' },
  { t: 'Box codes and racks', q: 'Where is 210x100?', k: '210 100 best seller backup three boxes ar c1 c2 c3',
    a: '210x100 is in rack A right side (<b>AR</b>), columns <b>C1 to C3</b> (Black, Brown, Grey), on rows R2, R3 and R4. Pick from <b>R3</b>. R2 and R4 are its backup boxes. Extra 210x100 goes on TOP.' },
  { t: 'Box codes and racks', q: 'Are Classic and Royal different nets?', k: 'classic royal premium same sku',
    a: 'No. Classic and Royal are the same stock. The app keeps one net per size and color.' },
  { t: 'Box codes and racks', q: 'What are PICK and BACKUP boxes?', k: 'pick backup box role label',
    a: '<b>PICK</b> boxes are where pickers take nets from. Almost every box is a PICK box. Only 210x100 has <b>BACKUP</b> boxes (AR C1-C3 on R2 and R4). Pickers only pick from PICK boxes.' },
  { t: 'Box codes and racks', q: 'Window and exhaust nets?', k: 'window exhaust rack e',
    a: 'Racks A to D are door nets. Window and exhaust nets will start at rack E.' },

  // ---- rack map ----
  { t: 'Rack map', q: 'What do the colors on the Rack map mean?', k: 'green yellow orange red dashed legend healthy low out empty color tile',
    a: '<ul><li><b>Green</b> (Pick box, healthy): this net has enough stock in total.</li><li><b>Yellow</b> (Low): the total of this net is at or below its refill level.</li><li><b>Red</b> (Out / box empty): the net has 0 in stock, or someone marked this box empty.</li><li><b>Dashed border</b>: a backup box.</li></ul>The color is about the <b>total</b> of that size and color, not how full this one box is.' },
  { t: 'Rack map', q: 'What is the small number on a box in the Rack map?', k: 'number tile count box shows',
    a: 'It is how many nets the app has in that box right now. No number means nobody has put nets in or counted that box in the app yet.' },
  { t: 'Rack map', q: 'I tapped a box. What do the numbers mean?', k: 'tap box info pop-up popup summary table in this box room on top of racks not in a box total out today boxes meaning columns',
<<<<<<< HEAD
    a: 'Tapping a box opens a summary in front of the screen. Tap <b>Close</b> (or outside it) to go back. Under the total it shows how it adds up: this box + the other boxes of the net (for 210x100 the backup boxes) + the top + not in a box. It also shows <b>Boxes on top</b> (a black square per full box of 25, a dashed square with the count for a box that is not full), <b>Out today</b> (nets that left stock today) and what is still to pick on the pick list.<br>Example: <b>9</b> in this box, holds <b>20</b>, on top of racks <b>4</b>, not in a box <b>0</b>, total <b>13</b>.<ul><li><b>In this box</b>: nets in this box now (9). A dash (—) means no number yet.</li><li><b>holds 20</b>: a full box holds 20. It is the box size, not the space left. Space left = 20 − 9 = 11.</li><li><b>On top of racks</b>: nets of this size and color on TOP (4).</li><li><b>Not in a box</b>: stock the app knows about but cannot place in a box or on TOP.</li><li><b>Total</b>: all nets of this size and color = in boxes + on top + not in a box (9 + 4 + 0 = 13).</li></ul>' },
=======
    a: 'Tapping a box opens a summary in front of the screen. Tap <b>Close</b> (or outside it) to go back. It also shows <b>Boxes on top</b> (a black square per full box of 25, a dashed square with the count for a box that is not full), <b>Out today</b> (nets that left stock today) and what is still to pick on the pick list.<br>Example: <b>9</b> in this box, holds <b>20</b>, on top of racks <b>4</b>, not in a box <b>0</b>, total <b>13</b>.<ul><li><b>In this box</b>: nets in this box now (9). A dash (—) means no number yet.</li><li><b>holds 20</b>: a full box holds 20. It is the box size, not the space left. Space left = 20 − 9 = 11.</li><li><b>On top of racks</b>: nets of this size and color on TOP (4).</li><li><b>Not in a box</b>: stock the app knows about but cannot place in a box or on TOP.</li><li><b>Total</b>: all nets of this size and color = in boxes + on top + not in a box (9 + 4 + 0 = 13).</li></ul>' },
>>>>>>> 1b4f99f114c3f030b38e57da25b879a16f3fd4f4
  { t: 'Rack map', q: 'What does "box holds 20" (or "room for 20") mean?', k: 'room capacity full box holds size space left 20',
    a: '<b>Box holds 20</b> means a full box holds 20 nets of this size. It is the box size, not the space left. If the box has 9, there is space for 11 more. When the box reaches 20, the app says <b>box is full</b>: put the rest on TOP.' },
  { t: 'Rack map', q: 'What does "On top of racks" mean?', k: 'on top of the rack top extra',
    a: 'How many nets of this size and color are on top of the racks (TOP), not in a box. They are part of the total.' },
  { t: 'Rack map', q: 'What does "Not in a box" mean?', k: 'not in a box unplaced missing difference',
    a: 'The total says these nets exist, but no box or TOP number holds them. It happens when stock was added as a total only, for example with COUNT or Enter counts on the Stock page, not into a box. It is not an error.<br>To place them: put them away with <b>IN</b>, or a manager sets the box number on the Rack map. Not in a box = total − in boxes − on top.' },
  { t: 'Rack map', q: 'What does "Total" mean?', k: 'total stock on hand in total master number',
    a: 'All nets of that size and color the company has ready to ship: in boxes + on top of racks + not in a box. The total is the main number. Every IN, OUT, pick, return and count changes it.' },
  { t: 'Rack map', q: 'What do "marked empty", "made 12 Nov", "has nets" and "not scanned yet" mean?', k: 'marked empty made date has nets not scanned yet box state',
    a: '<ul><li><b>marked empty</b>: someone scanned EMPTY for this box. It is on the Refill list.</li><li><b>made 12 Nov</b>: the nets in this box came from a batch made on that date.</li><li><b>has nets</b>: the box has nets, date not known.</li><li><b>not scanned yet</b>: no EMPTY, REFILL or rack-in scan for this box yet.</li></ul>' },
  { t: 'Rack map', q: 'How do I change the number in one box?', k: 'edit box number fix correct set box change new number manager',
    a: 'Managers: open the <b>Rack map</b>, tap the box, choose it under <b>Change</b> (the box or Top of racks), type the <b>New number</b>, pick a reason and tap <b>Save</b>. The total of that net moves by the same difference.' },
  { t: 'Rack map', q: 'How do I find a size on the Rack map?', k: 'find a size search highlight',
    a: 'Type the size in <b>Find a size</b> at the top (e.g. 205x90). The matching boxes light up.' },

  // ---- IN and OUT ----
  { t: 'IN and OUT', q: 'How do I put nets in a box (IN)?', k: 'in put away add nets rack fill store',
    a: '<ul><li>Scan station: tap the big <b>IN</b> button.</li><li>Type the size of the net in your hand (e.g. 210 90) and tap it.</li><li>Tap the color.</li><li>The app shows the box in big letters (e.g. AL-C5-R3) with a hint: rack, side, column, row.</li><li>Put the nets in, then tap how many (+1, +5, or type the number and tap Add).</li></ul>Stock goes up at once. Several trips and several phones add up.' },
  { t: 'IN and OUT', q: 'The box is full. Where do the rest go?', k: 'box full top + overflow extra no space',
    a: 'Put the rest on top of the rack. On top, nets sit in boxes of 25: tap <b>Full box on top (+25)</b> for each full box. A box that is not full: type how many nets are in it and tap <b>Put on top</b>. If the net has another box with room, the app shows it under "This net also has boxes".' },
  { t: 'IN and OUT', q: 'How is the top of the racks counted?', k: 'top boxes full box 25 part box count on top how many boxes',
    a: 'On top, nets sit in boxes of <b>25</b>. The app shows them as boxes, for example <b>2 full boxes + 1 box of 22 = 72</b>. The total always counts every net. The app works the boxes out from the number on top, so keep only one box that is not full per size and color.' },
  { t: 'IN and OUT', q: 'How do I take nets out (OUT)?', k: 'out take remove pick ship minus',
    a: '<ul><li>Scan station: tap the big <b>OUT</b> button.</li><li>Type the size, tap the color.</li><li>The app shows the box that has nets.</li><li>Take the nets out and tap how many (−1, −5, or type it and tap Take out).</li><li>Took a full box from the top of the rack? Tap <b>Took a full box from the top (−25)</b>, or type how many and tap <b>Take from top</b>.</li></ul>Stock goes down at once. Nets on a pick list that is final already went down: for those, OUT only ticks the list (the green line says so).' },
  { t: 'IN and OUT', q: 'Do I have to scan the shelf label?', k: 'scan shelf optional confirm warn label',
    a: 'No, it is optional. If you scan it, the app confirms it is the right box, or warns you if it is not.' },
  { t: 'IN and OUT', q: 'What is "Same net again"?', k: 'same net again repeat',
    a: 'A shortcut: tap it to put away (or take out) more of the net you just did, without typing the size again.' },
  { t: 'IN and OUT', q: 'Is a part-full or empty box a problem?', k: 'part full half empty box error wrong',
    a: 'No. Boxes hold whatever we really have: 20, 8, 5 or none. Part-full and empty boxes are normal.' },
  { t: 'IN and OUT', q: 'Can I put new nets on top of older nets?', k: 'fifo first made first shipped old new oldest',
    a: 'No. First made, first shipped. New nets never go on top of older ones. Rack-in or refill only into an <b>empty</b> box. Refills take the <b>oldest</b> batch from the top of the racks.' },
  { t: 'IN and OUT', q: 'What is the difference between OUT and "Pick for order"?', k: 'pick for order cmd-out order pick difference',
    a: 'Both take nets out of stock. <b>OUT</b> (big button): type the size and color, the app shows the box. <b>Pick for order</b>: scan the box label, then the quantity. Use the one you find easier.' },

  // ---- scan station ----
  { t: 'Scan station', q: 'How do I scan with my phone?', k: 'camera phone scan barcode usb scanner',
    a: 'Tap <b>Scan with camera</b> and point at the label. After a good scan the camera closes by itself and you are back on your screen with the details filled in (in IN and OUT: the size and color). After a wrong code it stays open: scan again. After a batch label for the rack, or a command like OUT, EMPTY or REFILL, it stays open for the box label. On a computer with the USB scanner, keep the scan box selected: the scanner types the code and presses Enter. You can also type a code and press Enter.' },
  { t: 'Scan station', q: 'What do the buttons on the Scan station do?', k: 'buttons modes what are you doing pick for order fba swap refill empty return damaged count boxes',
    a: '<ul><li><b>Pick for order</b>: take nets out for an order (scan the box, then how many).</li><li><b>Swap backup down</b>: 210x100 only, bring a backup box to the pick row.</li><li><b>Refill box</b>: fill an empty box from the top of the racks.</li><li><b>Box is empty</b>: a box just ran out. It goes on the Refill list.</li><li><b>FBA shipment</b>: nets going to Amazon FBA.</li><li><b>Customer return</b>: a good net back into stock.</li><li><b>Return, damaged</b>: a returned net that is damaged.</li><li><b>Count</b> (managers): set the total of a net.</li><li><b>Count boxes</b>: count what is in each box.</li><li><b>IN</b> and <b>OUT</b>: put nets in or take them out.</li></ul>Tap the same button again to stop.' },
  { t: 'Scan station', q: 'A box ran out. What do I do?', k: 'empty box ran out finished',
    a: 'Tap <b>Box is empty</b> (or scan EMPTY), then scan the box. It goes on the <b>Refill list</b>. For 210x100, scan <b>SWAP</b> and the backup box you bring over.' },
  { t: 'Scan station', q: 'How do I refill a box?', k: 'refill list top oldest batch',
    a: 'Open the <b>Refill list</b>. For each empty box, take the <b>oldest</b> batch from the top of the racks, fill the box, then tap <b>Refill box</b> (or scan REFILL) and scan the box.' },
  { t: 'Scan station', q: 'How does a batch label move through production?', k: 'batch label wo production cut base sides finish pack rack-in stage',
    a: 'Scan the <b>batch label</b> (WO-…) at each step: Cut → Base → Sides → Finish → Pack. Your name is saved on that step. After Pack, scan the batch, then <b>TOP</b> or an <b>empty</b> box. Stock goes up.' },
  { t: 'Scan station', q: 'Some nets were rejected. How do I record it?', k: 'rejected good nets reject damaged in production',
    a: 'Right after scanning the batch, type the number of <b>good nets</b> and tap <b>Save count</b>.' },
  { t: 'Scan station', q: 'A customer sent a net back.', k: 'return customer back damaged',
    a: 'Good net: tap <b>Customer return</b>, scan the box, then how many. Damaged net: tap <b>Return, damaged</b> instead.' },
  { t: 'Scan station', q: 'What does "SHEET · synced" or "waiting" at the top mean?', k: 'sheet synced saving waiting offline internet sync',
    a: '<b>SHEET · synced</b>: everything is saved. <b>SAVING · 3 waiting</b>: 3 scans are still being sent. <b>SHEET OFFLINE</b>: no internet; your scans wait on the phone and are sent when it is back. Do not sign out while scans are waiting.' },

  // ---- counting ----
  { t: 'Counting', q: 'How do I count boxes?', k: 'count boxes box count opening count shelf type number',
    a: 'Scan station: tap <b>Count boxes</b>. Scan each shelf label and type how many nets are in that box (0 if none). Scan <b>TOP</b> for the top of the racks. Stock does not change yet: the manager presses <b>Apply</b> on the Stock page.' },
  { t: 'Counting', q: 'Why did a box count not change the stock?', k: 'apply box count not applied waiting',
    a: 'Box counts change stock only when the manager opens <b>Stock → Box count → Review and apply</b> and presses <b>Apply</b>. A net is applied only when <b>all</b> its boxes are counted.' },
  { t: 'Counting', q: 'How do I fix the total of a net?', k: 'count correct total wrong number manager enter counts',
    a: 'Managers: on the Scan station tap <b>Count</b>, scan any box of the net and type the real total (boxes plus top of racks). Or on the <b>Stock</b> page tap <b>Enter counts</b>. To fix one box, use the Rack map instead.' },
  { t: 'Counting', q: 'Why does the app ask for a reason?', k: 'reason why count different',
    a: 'Every count that changes stock needs a reason (for example "Found extra nets" or "Picked without scanning"), so everyone can see later why the number changed.' },

  // ---- mistakes ----
  { t: 'Mistakes', q: 'I made a mistake. How do I undo it?', k: 'undo mistake wrong scanned twice wrong box wrong number cancel',
    a: 'Tap <b>Undo my last scan</b> (or scan UNDO) and pick why. You can undo only <b>your own last scan</b>, on <b>the same phone</b>, within <b>15 minutes</b>. Undo is refused if someone changed the same batch, box or count since. Older mistakes: ask a manager to fix it with COUNT or by changing the box number.' },
  { t: 'Mistakes', q: 'How do I stop what I started?', k: 'cancel stop clear',
    a: 'Tap the same button again, tap <b>Cancel</b>, or scan <b>CANCEL</b>.' },
  { t: 'Mistakes', q: 'The app says "Unknown code".', k: 'unknown code not found label',
    a: 'The label is not one the app knows. Check you scanned the right label (box, batch, badge or command). Type the code by hand if the label is damaged.' },

  // ---- stock and dashboard ----
  { t: 'Stock and dashboard', q: 'What do the columns on the Stock page mean?', k: 'stock page columns rack location in total rack space refill at sells per day days left status sku',
    a: '<ul><li><b>Rack location</b>: the pick box (and backups).</li><li><b>In total</b>: all nets of this net in stock.</li><li><b>Rack space</b>: how many fit in all its boxes when full.</li><li><b>Refill at</b>: at or below this total the net shows Low.</li><li><b>Sells / day</b> and <b>Days left</b>: how long the stock lasts.</li><li><b>Status</b>: OK, Low or Out.</li><li><b>Amazon SKUs</b>: the listings that ship this net.</li></ul>' },
  { t: 'Stock and dashboard', q: 'What do the numbers on the Dashboard mean?', k: 'dashboard doornets on racks out of stock below refill level in today out today opening count',
    a: '<ul><li><b>Doornets on racks</b>: total of all door nets in stock.</li><li><b>Nets out of stock</b>: sizes and colors at 0.</li><li><b>Below refill level</b>: running low.</li><li><b>In today</b> / <b>Out today</b>: nets in and out since this morning.</li><li><b>Opening count</b>: nets put away so far with IN, already in the totals.</li></ul>' },
  { t: 'Stock and dashboard', q: 'How do I use Excel to check or fix many numbers?', k: 'excel download upload xlsx csv spreadsheet in box column',
    a: 'Stock page → <b>Download Excel</b>: one row per net and box, plus TOP. To fix many numbers, change the <b>In box</b> column, save, and <b>Upload</b> it. You see every change first and pick a reason. The last upload can be undone.' },
  { t: 'Stock and dashboard', q: 'What is the Refill list?', k: 'refill list empty boxes low make more',
    a: 'It lists the empty boxes to fill from the top of the racks (oldest batch first), and the nets that are low in total and need to be made.' },
  { t: 'Stock and dashboard', q: 'How do I make a pick list?', k: 'pick list orders paste easyship seller flex walking order',
    a: 'Pick list page: paste the day\'s orders (SKU or size and color, and quantity), tap <b>Make pick list</b>. It comes back in walking order with the box for each line. Tap Print if you want it on paper.' },
  { t: 'Stock and dashboard', q: 'What does Final on the pick list do?', k: 'pick list final remove stock once picker check tick not picked back to stock short',
    a: 'Managers: when the list is complete, tap <b>Final</b>, then <b>Yes, remove from stock</b>. All its nets come off stock in one go. Pickers then tap <b>OUT</b> as usual: for nets on the list it only ticks them off and takes them off the box, never off stock twice. The Pick list page shows what is picked and what is left. A net not picked: tap <b>Not picked…</b>, then <b>Back to stock</b> (still on the shelf, or the order was cancelled) or <b>Not on the shelf</b> (it stays off stock).' },
  { t: 'Stock and dashboard', q: 'Is there a backup of the data?', k: 'snapshot backup restore reset zero daily',
    a: 'Yes. A copy is saved every night at 23:00 (kept 30 days), and before every reset or restore. Admins can restore one on the Settings page. Reset to zero is for the Owner only.' },

  // ---- printing ----
  { t: 'Printing', q: 'Where do I print labels and signs?', k: 'print labels setup shelf badge command sheet side sign rack layout thermal',
    a: '<b>Setup labels</b> page: worker badges, the command sheet (with the TOP label), side signs (big or small), the rack layout sheet and shelf labels. Shelf labels show the size and color of the net in big letters with the box code small underneath: stick one on the shelf and one on the front of the box. Shelf labels, badges and command labels are 50 x 25 mm thermal labels. Batch labels print from <b>Batches &amp; labels</b>. Everything prints solid black.' },
  { t: 'Printing', q: 'How do I print this cheat sheet?', k: 'cheat sheet print handbook guide pdf',
    a: 'On this Help page tap <b>Print cheat sheet</b> (one A4 page). To keep a PDF, choose "Save as PDF" in the print window.' },

  // ---- sign-in ----
  { t: 'Sign-in', q: 'How do I sign in?', k: 'sign in login pin employee number badge emp forgot locked out new pin',
    a: 'Type your employee number (e.g. EMP-78 or just 78) or tap <b>Scan my badge</b>, then your own 4-digit <b>PIN</b>. The phone stays signed in for 30 days. No PIN yet, or locked out? Ask your manager.' },
  { t: 'Sign-in', q: 'Someone else wants to use my phone.', k: 'share phone other person switch badge sign out',
    a: 'Tap <b>Sign out</b>, or let them scan their own badge and type their own PIN. Every scan is saved with the name of the person signed in.' },
  { t: 'Sign-in', q: 'Why can I not see some pages?', k: 'pages hidden level worker manager admin owner access',
    a: 'Floor pages (Scan station, Pick list, Rack map, Refill list, Help) are for everyone. Dashboard, Stock, labels and Scan log need a manager. People and Settings need an admin.' }
];

// Printable cheat sheet: one A4 page, solid black. [term, what it means]
window.HELP_SHEET = [
  { h: 'Box code: AL-C5-R3', rows: [
    ['AL', 'Rack A, Left side (R = right side). The big side sign shows it.'],
    ['C5', 'Column 5. C1 to C6, left to right as you face the side.'],
    ['R3', 'Row 3. R1 = floor, R5 = top row.'],
    ['TOP', 'Extra stock on top of the racks, above R5. No fixed places.'],
    ['Order', 'Sizes in number order: 185x80 (AR) to 250x150 (DL). One size, one color per box.'],
    ['Colors', 'Always Black, Brown, Grey, left to right.'],
    ['210x100', 'AR C1-C3, rows R2-R4. Pick from R3. Extra on TOP.'] ] },
  { h: 'Rack map: tap a box', rows: [
    ['In this box', 'Nets in this box now. A dash (—) = no number yet.'],
    ['holds 20', 'A full box holds 20. Not the space left. Space left = 20 − in this box.'],
    ['On top of racks', 'Nets on TOP, as boxes of 25: 2 full boxes + 1 box of 22 = 72.'],
    ['Not in a box', 'Stock the app cannot place in a box or on TOP yet. Not an error: put them away with IN or set the box number.'],
    ['Total', 'All nets of this size and color: in boxes + on top + not in a box.'],
    ['Green / Yellow / Red', 'Total is healthy / low / out (red also = box marked empty). About the total, not this box.'],
    ['Number on a tile', 'How many nets the app has in that box.'],
    ['PICK / BACKUP', 'Pick from PICK boxes. Only 210x100 has BACKUP boxes.'] ] },
  { h: 'IN: put nets in', rows: [
    ['1', 'Scan station: tap IN.'],
    ['2', 'Type the size in your hand (e.g. 210 90), tap the color.'],
    ['3', 'The app shows the box in big letters. Put the nets in.'],
    ['4', 'Tap how many (+1, +5 ...). Stock goes up at once.'],
    ['Box full?', 'Rest on top: Full box on top (+25), or type the count of a part box.'] ] },
  { h: 'OUT: take nets out', rows: [
    ['1', 'Scan station: tap OUT.'],
    ['2', 'Type the size, tap the color.'],
    ['3', 'The app shows the box. Take the nets out.'],
    ['4', 'Tap how many (−1, −5 ...). From the top: a full box (−25) or type it.'] ] },
  { h: 'Other buttons', rows: [
    ['Pick for order', 'Scan the box, then how many.'],
    ['Box is empty', 'Box ran out. Scan it: it goes on the Refill list.'],
    ['Refill box', 'Fill an empty box from the oldest batch on TOP, then scan the box.'],
    ['Customer return', 'Good net back in stock. Damaged: Return, damaged.'],
    ['Count boxes', 'Scan each shelf label, type how many. Manager applies on the Stock page.'],
    ['Undo my last scan', 'Your own last scan, same phone, within 15 minutes. Pick why.'],
    ['Cancel', 'Stops what you started.'] ] },
  { h: 'Rules', rows: [
    ['First made, first shipped', 'Never put new nets on top of older ones. Refill only into an empty box.'],
    ['Part-full is fine', 'Boxes hold what we really have: 20, 8, 5 or none.'],
    ['Reason', 'Every count that changes stock needs a reason.'],
    ['Classic = Royal', 'Same stock. One net per size and color.'],
    ['Older mistakes', 'Ask a manager: COUNT, or change the box number on the Rack map.'] ] },
  { h: 'Pages', rows: [
    ['Scan station', 'IN, OUT, picks, refills, counts, undo.'],
    ['Rack map', 'Every box. Tap one for its summary. Find a size.'],
    ['Refill list', 'Empty boxes to fill, nets running low.'],
    ['Pick list', 'Paste orders, walking order. Final takes it all off stock; OUT then only ticks it.'],
    ['Stock', 'Totals, box count Apply, Excel download and upload.'],
    ['Setup labels', 'Badges, command sheet, side signs, rack layout, shelf labels.'],
    ['Help', 'Type a question or a box code or a size.'],
    ['SHEET · synced', 'All saved. "waiting" = still sending. OFFLINE = no internet, scans wait.'] ] }
];
