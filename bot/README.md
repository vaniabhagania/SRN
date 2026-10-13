# SRN Kitchen — WhatsApp listener

Sits in the kitchen's WhatsApp groups as a linked device, reads what customers
post, and files orders, reviews and payments straight into the web app.

**It never sends anything.** No replies, no reactions, no read receipts, no
"online" status. It listens and writes to the database; that is all it can do.

---

## Read this before you run it

This uses an unofficial library that logs in the same way WhatsApp Web does.
WhatsApp's terms do not allow it. The documented consequence is suspension
without warning, and bans can extend to numbers associated with the one that
was flagged.

So:

- **Use a separate SIM.** Never Shobha's, Ramya's or Neha's number — those
  three *are* the business. Use a spare number you would not mind losing.
- That number has to be in each group you want read. Add it like any other
  member.
- If the number does get banned, the kitchen keeps running: the hourly sync
  and the Import tab both still work, and neither touches this.

Meta's official Groups API cannot do this job — it caps groups at 8
participants, and SRN Kitchen has around 250.

---

## Setting it up

**1. Get the files onto a server**

Any machine that stays on. A free Railway or Fly tier is enough; so is the
smallest VPS. It needs Node 20 or newer.

```bash
git clone https://github.com/vaniabhagania/SRN
cd SRN/bot
npm install
```

**2. Tell it which groups to read**

Open `config.js` and list them by their exact WhatsApp names:

```js
GROUPS: [
  { name: "SRN Kitchen", defaultChef: null },
  { name: "SRN Kitchen — Olive", defaultChef: "shobha" },
]
```

`defaultChef` is who gets the order when nothing else says — handy if a group
belongs to one chef. Leave it `null` to use `DEFAULT_CHEF`.

**3. Run it once to link the phone**

```bash
npm run dry
```

A QR code prints in the terminal. On the listener's phone:
**WhatsApp → Settings → Linked devices → Link a device**, then scan it.

`npm run dry` is dry-run mode: it reads and logs but writes nothing. Leave it
like this for an evening and read the output. You will see lines like:

```
19:04:12 order    SRN Kitchen  Keerthi  1×Mix Veg Paratha, 1×Hara Bhara Kebab  ₹190
19:21:40 payment  SRN Kitchen  Neelam ₹250
19:33:02 order    SRN Kitchen  Vinita  2×Chicken Biryani  ₹0  (not on the menu: Chicken Biryani)
```

That last one is the thing to watch for — ₹0 means the dish is not on the app's
menu, so it could not be priced.

**4. Let it write**

Once the log looks right:

```bash
npm start
```

On Railway or Fly, set the start command to `npm start` and keep the `auth`
folder on a persistent volume, or it will ask for the QR again every deploy.

---

## What it does with a message

| In the group | What happens |
|---|---|
| "1 chicken biryani for lunch - 2104" | Order, priced from the menu, on the matching chef's calendar |
| "2 plate radha ballavi" from a chef | Ignored — chefs post menus, not orders |
| "Is biryani available?" | Ignored — a question is not an order |
| "the biryani was delicious ❤" | Review, 5 stars |
| A WhatsApp payment, or "₹250 sent to Mom" | Lands in Payments for the chef to confirm with one tap |
| A photo with no caption | Left alone — the hourly sync can read pictures, this cannot |

Dish names are matched loosely against the live menu, so "chicken briyani",
"harabara kebab" and "250 gm fry fruit aata ladoo" all find the right dish.
Anything it cannot match comes through at ₹0 for you to price in the app.

An order it cannot price is still worth having — it has the customer, the flat
and the items. You just fill in the amount.

---

## Settings

All in `config.js`, all overridable by environment variable.

| Setting | Does what |
|---|---|
| `GROUPS` | Which groups to read, by exact name |
| `DEFAULT_CHEF` | Who gets an order when nothing identifies the chef |
| `CHEF_CHAT_NAMES` | How each chef appears in chat, so their posts are read as menus. "Mom" is Neha |
| `MAX_AGE_HOURS` | Ignore anything older than this on reconnect, so a few days offline doesn't import a backlog |
| `DRY_RUN` | `1` to read and log without writing |
| `AUTH_DIR` | Where the WhatsApp session lives. Keep it — it is what avoids re-scanning the QR |

---

## When something is wrong

**It prints a QR every restart** — the `auth` folder is not persisting. On a
host with ephemeral disk, mount a volume there.

**"none of the groups in config.js were found"** — it lists the groups the
account actually is in. Match the name exactly, em-dashes and all.

**"This device was unlinked"** — someone removed it in Linked devices, or
WhatsApp dropped it. Delete `auth/` and link again.

**Everything arrives at ₹0** — the app's menu is empty, or the dish names in it
do not resemble what customers type. Post the dishes with the names people
actually use.

**It stops seeing messages but stays connected** — restart it. WhatsApp
occasionally drops a linked device quietly.

---

## What was and wasn't tested

Checked: the dish matcher against the real typos from the group (18 cases, all
passing), the message parser, the Supabase writes, and that it installs and
starts cleanly.

Not checked: the live WhatsApp connection, QR pairing, and reading real
messages — WhatsApp is not reachable from the environment this was built in.
First run on a real server is where that gets proven, which is what dry-run
mode is for.
