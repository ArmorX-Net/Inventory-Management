# Doornet rack layout v7 (final, 9 Nov 2026)

Agreed with the owner on 9 Nov 2026 for a 2-week trial. The app (`data/doornets.js`), labels and scanning all follow this layout.

## The five rules (what a picker learns)

1. **Sizes go in number order** from 185×80 at the start of rack A to 250×150 at the end of rack C. Each side has a sign with its range.
2. **210×100 is the one exception.** It owns columns C1–C3 of side AR (Black, Brown, Grey, one column each), right at the entrance. Pick only from **R3**; the other boxes in those columns are its backups.
3. **Popular sizes sit on the middle shelves R2–R4** (knee to chest) of their side, one box per color.
4. **Slow sizes sit on the floor R1 and the top shelf R5** of their side. The 33 slowest sizes share one box with 3 bins.
5. **Colors are always Black, Brown, Grey, left to right**, in boxes and in bins. **R6 is backup only**; pickers never pick from it.

## Sides

| Side | Sizes |
|---|---|
| AR | 185×80 to 185×110 + 210×100 (C1–C3) |
| AL | 185×115 to 195×90 |
| BR | 195×95 to 200×105 |
| BL | 200×110 to 210×75 |
| CR | 210×80 to 215×105 |
| CL | 215×110 to 250×150 |

Walking order from the main entrance: AR → AL → BR → BL → CR → CL. Racks D onward are free for window and exhaust nets.

## Boxes

* 3 racks × 2 sides × 6 columns × 6 rows = **216 slots, all used**.
* Own box: 20 nets of one color. 3-bin box: 21 nets of one size (Black | Brown | Grey bins, split by sales). R6 box: 25.
* 45 sizes have one box per color (210×100 + 44). 33 slowest sizes use 3-bin boxes (about 15% of sales).
* On each side, the 6 fastest sizes of that side's range get R2–R4; the rest go to R1/R5.
* R6 holds a backup of the fastest net picked in the column below it. 210×100 has 5 backups per color in its own column.
* Days of stock on the rack: 210×100 17–20 days, everything else 14 days or more (sales include FBA, so real cover is longer).

## Refill and first made, first shipped

1. **Pick** only from the pick box.
2. **Pick box empty:** scan SWAP and bring down its backup (oldest production date first). No backup: scan EMPTY.
3. **Every 3–4 days:** the Refill list shows every empty box in walking order and the oldest second-floor batch to take. Fill it, scan REFILL and the box.
4. **New production** goes to the second floor (`2F`) or into an empty box. A box is never topped up while it still has older nets. 3-bin boxes: new nets to the back, pick from the front.
5. **Labels:** the shelf label (location, PICK/BACKUP) never moves; the box tag (batch, production date) travels with the box.

## How we got here

| Plan | Idea | Why we moved on |
|---|---|---|
| v4, 5 racks | Every net its own box, extra boxes for fast sizes | Too much rack space; racks are a pick face, bulk stays on the second floor |
| 3 racks, speed first | Fastest sizes at waist height near the entrance | Prime shelves all went to 210×100 |
| 3 racks, pairs | Every size an easy pick box plus a paired backup | Too many box types; hard for pickers to build a mental map |
| **v7, number order** | Number order, speed decides height inside each side, one exception | Chosen |


## Change 11 Nov 2026: no R6 boxes, extra stock on top
* The owner keeps R1-R5 and C1-C6 exactly as above. There is no second floor and, for now, no R6 boxes.
* Extra stock sits on a platform on top of the racks (above R5, over C4-C6). Its exact places and first-in-first-out there are decided later. In the app this is one location, `TOP`.
* The app hides the 36 planned R6 boxes (`USE_R6 = false` in `app.js`); they stay in `data/doornets.js` for later. 210x100 keeps its backups in AR C1-C3 (R1, R2, R4, R5).
* Boxes hold whatever is really there (20, 8, 5 or none). The app keeps one total per net; part-full or empty boxes are normal.
