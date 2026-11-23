// Help screen and printable cheat sheet. Plain words for the floor. Edit the answers here; the app searches them.
// Rules: words must match what the app shows; no planning words; part-full or empty boxes are normal, never an error.
// Each entry: t = topic, q = question, k = extra search words, a = answer (simple HTML: <b>, <br>, <ul><li>).
window.HELP_TOPICS = ['Box codes and racks', 'Rack map', 'IN and OUT', 'Scan station', 'Counting', 'Mistakes', 'Stock and dashboard', 'Printing', 'Sign-in'];
window.HELP_QA = [
  // ---- box codes and racks ----
  { t: 'Box codes and racks', q: 'What does a box code like AL-C5-R3 mean?', k: 'location code address shelf label rack side column row where read',
    a: 'Read it in three parts:<ul><li><b>AL</b> = rack <b>A</b>, <b>L</b>eft side (R = right side). The big side sign at the end of each rack side shows this code.</li><li><b>C5</b> = column 5. Columns go C1 to C6, left to right as you face that side.</li><li><b>R3</b> = row 3. R1 is the floor, R5 is the top row.</li></ul>Tip: type any box code in the Help search and the app tells you what is in that box.' },
  { t: 'Box codes and racks', q: 'What is TOP?', k: 'top of the racks extra stock above r5 2f second floor overflow bulk',
    a: '<b>TOP</b> is the extra stock that sits on top of the racks, above R5. It has no fixed places. Nets up there sit in boxes: a <b>full box</b> holds 25, a <b>part box</b> holds fewer. There is no limit on how many boxes. Pickers never pick from the top: bring nets down to the box first. Old labels that say 2F still scan as TOP.' },
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
    a: 'Tapping a box opens a summary in front of the screen. Tap <b>Close</b> (or outside it) to go back. First the <b>Total in stock</b>, then one line for each place the nets sit. The lines always add up to the total.<br>Example: total <b>488</b>.<ul><li><b>Pick box AR-C4-R3</b> · 13: nets in that box now. "a full box holds 20" is the box size, not the space left. A dash (—) means no number yet.</li><li><b>Backup box</b> (210x100 only): nets in each backup box.</li><li><b>On top of the racks</b> · 475: "19 full boxes" means 19 boxes of 25 on top; "+ 1 part box (22)" is a box that is not full.</li><li><b>On the pick list</b> (minus): nets on a final pick list. They are already off stock but still in the box until they are picked.</li><li><b>Not in a box</b>: stock the app knows about but cannot place in a box or on top yet. Only shows when there is some.</li><li><b>Adds up to</b>: the lines added together. It is the same as the total.</li></ul>Below: <b>Ready to pick on the racks</b> (the boxes, not the top), and <b>Out today</b>.' },
  { t: 'Rack map', q: 'What does "box holds 20" (or "room for 20") mean?', k: 'room capacity full box holds size space left 20',
    a: '<b>Box holds 20</b> means a full box holds 20 nets of this size. It is the box size, not the space left. If the box has 9, there is space for 11 more. When the box reaches 20, the app says <b>box is full</b>: put the rest on TOP.' },
  { t: 'Rack map', q: 'What does "On top of the racks" mean?', k: 'on top of the rack top extra full box part box',
    a: 'How many nets of this size and color are on top of the racks (TOP), shown as boxes: for example <b>18 full boxes + 1 part box (22) = 472</b>. A full box holds 25. They are part of the total, but pickers do not pick from there.' },
  { t: 'Rack map', q: 'What does "Not in a box" mean?', k: 'not in a box unplaced missing difference',
    a: 'The total says these nets exist, but no box or TOP number holds them. It happens when stock was added as a total only, for example with COUNT or Enter counts on the Stock page, not into a box. It is not an error.<br>To place them: put them away with <b>IN</b>, or a manager sets the box number on the Rack map. Not in a box = total − in boxes − on top.' },
  { t: 'Rack map', q: 'What does "Total" mean?', k: 'total stock on hand in total master number',
    a: 'All nets of that size and color the company has ready to ship: in boxes + on top of racks + not in a box. The total is the main number. Every IN, OUT, pick, return and count changes it.' },
  { t: 'Rack map', q: 'What do "marked empty", "made 12 Nov", "has nets" and "not scanned yet" mean?', k: 'marked empty made date has nets not scanned yet box state',
    a: '<ul><li><b>marked empty</b>: someone scanned EMPTY for this box. It is on the Refill list.</li><li><b>made 12 Nov</b>: the nets in this box came from a batch made on that date.</li><li><b>has nets</b>: the box has nets, date not known.</li><li><b>not scanned yet</b>: no EMPTY, REFILL or rack-in scan for this box yet.</li></ul>' },
  { t: 'Rack map', q: 'How do I change the number in one box?', k: 'edit box number fix correct set box change new number manager',
    a: 'Managers: open the <b>Rack map</b>, tap the box, open <b>Change a number</b> and choose what to change:<ul><li><b>This box</b>: type the nets that are really in it.</li><li><b>Full boxes on top</b>: how many boxes of 25 are on top.</li><li><b>Part boxes on top</b>: add a part box with its count, or tap × to take one off.</li></ul>The line under it shows the change and the new total. Pick a reason and tap <b>Save</b>. The total of that net moves by the same difference.' },
  { t: 'Rack map', q: 'How do I find a size on the Rack map?', k: 'find a size search highlight',
    a: 'Type the size in <b>Find a size</b> at the top (e.g. 205x90). The matching boxes light up.' },

  // ---- IN and OUT ----
  { t: 'IN and OUT', q: 'How do I put nets in a box (IN)?', k: 'in put away add nets rack fill store',
    a: '<ul><li>Scan station: tap the big <b>IN</b> button.</li><li>Type the size of the net in your hand (e.g. 210 90) and tap it.</li><li>Tap the color.</li><li>The app shows the box in big letters (e.g. AL-C5-R3) with a hint: rack, side, column, row.</li><li>Put the nets in, then tap how many (+1, +5, or type the number and tap Add).</li></ul>Stock goes up at once. Several trips and several phones add up.' },
  { t: 'IN and OUT', q: 'The box is full. Where do the rest go?', k: 'box full top + overflow extra no space',
    a: 'Put the rest on top of the rack, in boxes. Under <b>Box full? Put the rest on top of the rack</b>:<ul><li><b>Full boxes</b>: set how many boxes of 25 (any number) and tap <b>Put on top</b>.</li><li><b>Part box</b>: a box that is not full. Type how many nets are in it and tap <b>Put on top</b>.</li></ul>If the net has another box with room, the app shows it under "This net also has boxes".' },
  { t: 'IN and OUT', q: 'How is the top of the racks counted?', k: 'top boxes full box 25 part box count on top how many boxes',
    a: 'On top, nets sit in boxes. A <b>full box</b> holds 25. A <b>part box</b> holds fewer, and the app keeps each part box with its own count. It shows them like <b>18 full boxes + 2 part boxes (22, 14) = 486</b>. There is no limit on how many boxes go on top.' },
  { t: 'IN and OUT', q: 'Is there a limit on how many I can put in?', k: 'limit maximum max too many big number 5000 50000 no limit',
    a: 'No. A box or the top can take any number. Only a number that looks too high (for example 80 in a box that holds 20, or 1000 nets in one go) asks <b>Are you sure?</b> first. If it is right, tap Yes.' },
  { t: 'IN and OUT', q: 'How do I take nets out (OUT)?', k: 'out take remove pick ship minus',
    a: '<ul><li>Scan station: tap the big <b>OUT</b> button.</li><li>Type the size, tap the color.</li><li>The app shows the box that has nets.</li><li>Take the nets out and tap how many (−1, −5, or type it and tap Take out).</li><li>Took it from the top of the rack? Set the <b>Full boxes</b> and tap <b>Take off top</b>, tap the <b>part box</b> you took, or type the nets you took from a box on top.</li></ul>Stock goes down at once. Nets on a pick list that is final already went down: for those, OUT only ticks the list (the green line says so).' },
  { t: 'IN and OUT', q: 'Do I have to scan the shelf label?', k: 'scan shelf optional confirm warn label',
    a: 'No, it is optional. If you scan it, the app confirms it is the right box, or warns you if it is not.' },
  { t: 'IN and OUT', q: 'What is "Same net again"?', k: 'same net again repeat',
    a: 'A shortcut: tap it to put away (or take out) more of the net you just did, without typing the size again.' },
  { t: 'IN and OUT', q: 'Is a part-full or empty box a problem?', k: 'part full half empty box error wrong',
    a: 'No. Boxes hold whatever we really have: 20, 8, 5 or none. Part-full and empty boxes are normal.' },
  { t: 'IN and OUT', q: 'Can I put new nets on top of older nets?', k: 'fifo first made first shipped old new oldest',
    a: 'No. First made, first shipped. New nets never go on top of older ones. Rack-in or refill only into an <b>empty</b> box. Refills take the <b>oldest</b> batch from the top of the racks.' },
  { t: 'IN and OUT', q: 'What does "Check before saving" do?', k: 'check before saving confirm confirmation yes save back switch on off',
    a: 'With it on, the app shows what will change before it saves, for example <b>Top of rack: 18 full boxes = 450 → 20 full boxes = 500</b> and <b>Total in stock: 538 → 588</b>. Tap <b>Yes, save</b>, or <b>Back</b> to change it. Each person can switch it on or off on the Scan station (it is kept on that phone). A number that looks too high always asks, even when it is off.' },
  { t: 'IN and OUT', q: 'What does the small "i" do?', k: 'i info information button help tip explain',
    a: 'Tap the small <b>i</b> next to a button to see in three lines what it does, what you type, and what changes in stock.' },

  // ---- scan station ----
  { t: 'Scan station', q: 'How do I scan with my phone?', k: 'camera phone scan barcode usb scanner',
    a: 'Tap <b>Scan with camera</b> and point at the label. After a good scan the camera closes by itself and you are back on your screen with the details filled in (in IN and OUT: the size and color). After a wrong code it stays open: scan again. After a batch label for the rack, or a command like OUT, EMPTY or REFILL, it stays open for the box label. On a computer with the USB scanner, keep the scan box selected: the scanner types the code and presses Enter. You can also type a code and press Enter.' },
  { t: 'Scan station', q: 'What do the buttons on the Scan station do?', k: 'buttons modes what are you doing in out box recount check before saving undo',
    a: '<ul><li><b>IN</b>: you put nets in a box, or on top of the rack.</li><li><b>OUT</b>: you took nets out of a box, or off the top of the rack.</li><li><b>Box recount</b> (managers): count what is really in each box. Stock changes only when the manager applies it.</li><li><b>Check before saving</b>: shows what will change before it saves. Switch it on or off for yourself.</li><li><b>Undo my last scan</b>: takes your last scan back.</li></ul>Tap the same button again to stop. Tap the small <b>i</b> for a short explanation.' },
  { t: 'Scan station', q: 'A box ran out. What do I do?', k: 'empty box ran out finished refill',
    a: 'Bring nets down from the top of the rack: tap <b>OUT</b>, choose the net and take them <b>off the top</b> (full box or part box). Then tap <b>IN</b> and put them in the box. Both numbers stay right. Fill an empty box only: first made, first shipped.' },
  { t: 'Scan station', q: 'How do I refill a box from the top?', k: 'refill list top oldest batch bring down',
    a: 'Take the <b>oldest</b> nets from the top of the racks. On the Scan station tap <b>OUT</b>, choose the net and take them off the top (Full boxes, or tap the part box). Then tap <b>IN</b> and put them in the box. The <b>Refill list</b> shows the boxes marked empty.' },
  { t: 'Scan station', q: 'How does a batch label move through production?', k: 'batch label wo production cut base sides finish pack rack-in stage',
    a: 'Scan the <b>batch label</b> (WO-…) at each step: Cut → Base → Sides → Finish → Pack. Your name is saved on that step. After Pack, scan the batch, then <b>TOP</b> or an <b>empty</b> box. Stock goes up.' },
  { t: 'Scan station', q: 'Some nets were rejected. How do I record it?', k: 'rejected good nets reject damaged in production',
    a: 'Right after scanning the batch, type the number of <b>good nets</b> and tap <b>Save count</b>.' },
  { t: 'Scan station', q: 'A customer sent a net back.', k: 'return customer back damaged',
    a: 'A good net goes back in stock with <b>IN</b>: type the size, tap the color, put it in the box and tap how many. A damaged net does not go back in stock: give it to the manager.' },
  { t: 'Scan station', q: 'What does "SHEET · synced" or "waiting" at the top mean?', k: 'sheet synced saving waiting offline internet sync',
    a: '<b>SHEET · synced</b>: everything is saved. <b>SAVING · 3 waiting</b>: 3 scans are still being sent. <b>SHEET OFFLINE</b>: no internet; your scans wait on the phone and are sent when it is back. Do not sign out while scans are waiting.' },

  // ---- counting ----
  { t: 'Counting', q: 'How do I recount boxes (Box recount)?', k: 'count boxes box count box recount recount opening count shelf type number',
    a: 'Managers, on the Scan station: tap <b>Box recount</b>. Scan each shelf label and type how many nets are really in that box (0 if none). For the top of the racks scan <b>TOP</b>, pick the size and color, and enter the <b>full boxes</b> and each <b>part box</b>. Stock does not change yet: the manager presses <b>Apply</b> on the Stock page.' },
  { t: 'Counting', q: 'Why did a box recount not change the stock?', k: 'apply box count recount not applied waiting',
    a: 'Box recounts change stock only when the manager opens <b>Stock → Box recount → Review and apply</b> and presses <b>Apply</b>. A net is applied only when <b>all</b> its boxes are counted.' },
  { t: 'Counting', q: 'How do I fix the total of a net?', k: 'count correct total wrong number manager enter counts',
    a: 'Managers: on the <b>Stock</b> page tap <b>Enter counts</b> and type the real numbers. To fix one box or the top, tap it on the <b>Rack map</b> and use <b>Change a number</b>.' },
  { t: 'Counting', q: 'Why does the app ask for a reason?', k: 'reason why count different',
    a: 'Every count that changes stock needs a reason (for example "Found extra nets" or "Picked without scanning"), so everyone can see later why the number changed.' },

  // ---- mistakes ----
  { t: 'Mistakes', q: 'I made a mistake. How do I undo it?', k: 'undo mistake wrong scanned twice wrong box wrong number cancel',
    a: 'Tap <b>Undo my last scan</b> (or scan UNDO) and pick why. You can undo only <b>your own last scan</b>, on <b>the same phone</b>, within <b>15 minutes</b>. Undo is refused if someone changed the same batch, box or count since. Older mistakes: ask a manager to change the box number on the Rack map.' },
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
    a: 'Pick list page: paste the day\'s orders (SKU or size and color, and quantity), tap <b>Make pick list</b>. It comes back in walking order with the box for each line and how many are in that box. Tap Print if you want it on paper.' },
  { t: 'Stock and dashboard', q: 'How do I print a pick list again?', k: 'pick list print again reprint number many lists day time',
    a: 'Every list made with <b>Final</b> gets a number for the day and its time, like <b>Pick list #3 · 23 Nov · 2:15 PM</b>. Many lists a day is fine. They all show at the top of the Pick list page: tap <b>Print</b> on any of them, any time. The number is on the printout.' },
  { t: 'Stock and dashboard', q: 'How does the picker say the list is picked?', k: 'pick list picked done confirm picker notify manager finished',
    a: 'The picker takes the nets with <b>OUT</b> as usual: each one ticks the list. When finished, open the Pick list page and tap <b>Picking done</b> on that list. If some are not picked, the app says which, so tell the manager. The manager sees who picked it, when, and what is short, on the Pick list page and the Dashboard. No number changes.' },
  { t: 'Stock and dashboard', q: 'How do I undo Final on a pick list?', k: 'pick list undo final mistake add size change list',
    a: 'Managers: on the Pick list page tap <b>Undo Final</b> on that list, then <b>Yes</b>. Its nets go back into stock and the list comes back to change: add or remove lines, then tap <b>Final</b> again. Only before anything is picked from it. After picking has started, use <b>Not picked…</b> on a line, or make a new list for anything extra.' },
  { t: 'Stock and dashboard', q: 'Why is a pick list line "short"?', k: 'pick list short not enough box top bring down keep cut remove warning',
    a: 'Pickers take nets only from the boxes on the racks, never from the top. So the list compares each line with the <b>pick box</b> (for 210x100 also its backup boxes). If the box has fewer, the line is <b>short</b> and the app says how many are on top. Choose for each short line:<ul><li><b>Keep</b>: keep the full number; bring the rest down from the top first.</li><li><b>Cut to</b> the number in the box.</li><li><b>Remove line</b>: take it off this list and check it later.</li></ul>Then tap <b>Final</b> as usual.' },
  { t: 'Stock and dashboard', q: 'What does Final on the pick list do?', k: 'pick list final remove stock once picker check tick not picked back to stock short',
    a: 'Managers: when the list is complete, tap <b>Final</b>. Both answers save the list with its number, ready to print. <b>Yes, remove from stock</b>: all its nets come off stock in one go. <b>No, don\'t remove</b>: stock stays as it is and comes off when pickers tap OUT, which also ticks the list. Pickers then tap <b>OUT</b> as usual: for nets on the list it only ticks them off and takes them off the box, never off stock twice. The Pick list page shows what is picked and what is left. A net not picked: tap <b>Not picked…</b>, then <b>Back to stock</b> (still on the shelf, or the order was cancelled) or <b>Not on the shelf</b> (it stays off stock).<br>A <b>short</b> line (fewer in the box than on the list) needs a choice first: Keep, Cut or Remove.' },
  { t: 'Stock and dashboard', q: 'Is there a backup of the data?', k: 'snapshot backup restore reset zero daily',
    a: 'Yes. A copy is saved every night at 23:00 (kept 30 days), and before every reset or restore. Admins can restore one on the Settings page. Reset to zero is for the Owner only.' },

  // ---- printing ----
  { t: 'Printing', q: 'Where do I print labels and signs?', k: 'print labels setup shelf badge command sheet side sign rack layout thermal',
    a: '<b>Setup labels</b> page: worker badges, the command sheet (with the TOP label), side signs (big or small), the rack layout sheet and shelf labels. Shelf labels show the size and color of the net in big letters with the box code small underneath: stick one on the shelf and one on the front of the box. Batch labels print from <b>Batches &amp; labels</b>. Everything prints solid black.' },
  { t: 'Printing', q: 'Small or Large label?', k: 'label size small large 50 25 4x6 101.6 152.4 thermal tiny header footer date address print',
    a: 'Every label print asks which labels are in the thermal printer: <b>Small</b> 50 x 25 mm or <b>Large</b> 101.6 x 152.4 mm (4 x 6 inch). Pick the one in the printer and the label fills it, one label per page. In the print window: the same paper size, margins <b>None</b>, scale 100, and untick <b>Headers and footers</b> (that is what prints the date and web address on the label). A tiny label in the middle of a big one means Small was picked with the large roll in the printer.' },
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
    ['Total in stock', 'First line. The lines under it always add up to it.'],
    ['Pick box / Backup', 'Nets in that box. "a full box holds 20" is the box size, not the space left.'],
    ['On top of the racks', 'As boxes: 18 full boxes (25 each) + 1 part box (22) = 472.'],
    ['Not in a box', 'Stock with no box number yet. Put it away with IN, or a manager sets the box.'],
    ['Green / Yellow / Red', 'Total is healthy / low / out (red also = box marked empty). About the total, not this box.'],
    ['Number on a tile', 'How many nets the app has in that box.'],
    ['PICK / BACKUP', 'Pick from PICK boxes. Only 210x100 has BACKUP boxes.'] ] },
  { h: 'IN: put nets in', rows: [
    ['1', 'Scan station: tap IN.'],
    ['2', 'Type the size in your hand (e.g. 210 90), tap the color.'],
    ['3', 'The app shows the box in big letters. Put the nets in.'],
    ['4', 'Tap how many (+1, +5 ...). Stock goes up at once.'],
    ['Box full?', 'Rest on top: Full boxes (25 each, any number) or a Part box (type its count).'] ] },
  { h: 'OUT: take nets out', rows: [
    ['1', 'Scan station: tap OUT.'],
    ['2', 'Type the size, tap the color.'],
    ['3', 'The app shows the box. Take the nets out.'],
    ['4', 'Tap how many (−1, −5 ...). From the top: full boxes, tap the part box, or type the nets.'],
    ['Box ran out?', 'Refill from the top: OUT off the top, then IN into the box.'] ] },
  { h: 'On the Scan station', rows: [
    ['i', 'Tap it: what this does, what you type, what changes.'],
    ['Check before saving', 'Shows the change first (e.g. Top 450 → 500). Yes saves, Back goes back. On or off for each person.'],
    ['Are you sure?', 'A number that looks too high asks once. No limits: if it is right, tap Yes.'],
    ['Undo my last scan', 'Your own last scan, same phone, within 15 minutes. Pick why.'],
    ['Box recount', 'Managers: scan each shelf, type how many. TOP: full boxes + part boxes. Apply on the Stock page.'],
    ['Cancel', 'Stops what you started.'] ] },
  { h: 'Rules', rows: [
    ['First made, first shipped', 'Never put new nets on top of older ones. Refill only into an empty box.'],
    ['Part-full is fine', 'Boxes hold what we really have: 20, 8, 5 or none.'],
    ['Reason', 'Every count that changes stock needs a reason.'],
    ['Classic = Royal', 'Same stock. One net per size and color.'],
    ['Pick from boxes', 'Never from the top. Pick list short? Keep (bring down from top), Cut to the box, or Remove.'],
    ['Older mistakes', 'Ask a manager to change the box number on the Rack map.'] ] },
  { h: 'Pages', rows: [
    ['Scan station', 'IN and OUT. Managers: Box recount.'],
    ['Rack map', 'Every box. Tap one for its summary. Find a size.'],
    ['Refill list', 'Empty boxes to fill, nets running low.'],
    ['Pick list', 'Paste orders. Final makes a numbered list (#1, #2 ...): Yes takes it off stock, No leaves stock. Print any list again. Picker taps Picking done.'],
    ['Stock', 'Totals, box recount Apply, Excel download and upload.'],
    ['Setup labels', 'Badges, command sheet, side signs, rack layout, shelf labels. Labels: Small 50x25 or Large 4x6.'],
    ['Help', 'Type a question or a box code or a size.'],
    ['SHEET · synced', 'All saved. "waiting" = still sending. OFFLINE = no internet, scans wait.'] ] }
];


// The small "i" next to an action (owner 22 Nov 2026): three short lines for the floor. a = what it does, b = what you type, c = what changes.
// Keep these short; when a screen's words change, change them here too.
window.HELP_TIPS = {
  IN: { h: 'IN · put nets in', more: 'How do I put nets in a box', lines: [
    ['What it does', 'You put nets in a box on the rack, or on top of the rack.'],
    ['What you type', 'The size, then tap the color. The app shows the box. Tap how many you put in.'],
    ['What changes', 'Stock goes up at once, and that box\'s number goes up.']] },
  OUT: { h: 'OUT · take nets out', more: 'How do I take nets out', lines: [
    ['What it does', 'You took nets out of a box, or off the top of the rack.'],
    ['What you type', 'The size, then tap the color. The app shows the box with nets. Tap how many you took.'],
    ['What changes', 'Stock goes down at once. Nets on a final pick list only tick the list.']] },
  TOP: { h: 'Top of the rack', more: 'How is the top of the racks counted', lines: [
    ['What it is', 'Extra stock above R5, in boxes. A <b>full box</b> holds 25. A <b>part box</b> holds fewer.'],
    ['What you type', '<b>Full boxes</b>: how many boxes of 25. <b>Part box</b>: the nets in that one box.'],
    ['What changes', 'The top number and the total. Pickers never pick from the top.']] },
  RECOUNT: { h: 'Box recount (managers)', more: 'How do I recount boxes', lines: [
    ['What it does', 'Counts what is really in each box, to fix the numbers.'],
    ['What you type', 'Scan the shelf label, type how many are in it (0 if none). TOP: full boxes and part boxes.'],
    ['What changes', 'Nothing yet. Stock changes when the manager presses Apply on the Stock page.']] },
  CHECK: { h: 'Check before saving', more: 'What does Check before saving do', lines: [
    ['What it does', 'Shows what will change before anything is saved, like <b>Top 450 → 500</b>.'],
    ['What you do', 'Tap <b>Yes, save</b> if it is right, or <b>Back</b> to change it.'],
    ['On or off', 'Each person chooses for themselves on this phone. A number that looks too high always asks.']] },
  EDIT: { h: 'Change a number (managers)', more: 'How do I change the number in one box', lines: [
    ['What it does', 'Sets what is really there: this box, the full boxes on top, or the part boxes on top.'],
    ['What you type', 'The real number, and a reason. The line under it shows the change.'],
    ['What changes', 'The total of this net moves by the same difference. It is in the scan log with your reason.']] },
  FINAL: { h: 'Final (managers)', more: 'What does Final on the pick list do', lines: [
    ['What it does', 'Saves the list with its number, ready to print.'],
    ['What you do', 'Choose for every short line first, then Final, then Yes or No.'],
    ['What changes', '<b>Yes</b>: stock goes down now; OUT only ticks the list. <b>No</b>: stock goes down at OUT.']] },
  SHORT: { h: 'Short in the box', more: 'Why is a pick list line short', lines: [
    ['Why', 'Pickers pick only from the boxes on the racks, never from the top.'],
    ['Keep', 'Keep the full number and bring the rest down from the top first.'],
    ['Cut or Remove', '<b>Cut</b> to what is in the box, or <b>Remove</b> the line and check it later.']] }
};
