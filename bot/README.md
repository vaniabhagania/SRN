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

Any machine that stays on, running Node 20 or newer. See
[Putting it on Oracle Cloud](#putting-it-on-oracle-cloud) below for a free
one that doesn't sleep or expire.

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

That runs it in your terminal, which stops the moment you close it. See
[Keeping it running](#keeping-it-running) for making it survive a logout
and a reboot.

---

## Putting it on Oracle Cloud

Oracle's Always Free tier suits this well: it doesn't sleep, doesn't expire,
and needs no card charge. It was cut back in 2026 — the free ARM allowance
dropped from 4 cores / 24GB to around **2 vCPU / 12GB**, and going over can
now be billed rather than simply refused. Still far more than this needs; the
listener is one Node process holding a websocket and is happy on 1 core and
512MB.

**Make the machine**

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com). Pick a region near
   you (Mumbai or Hyderabad for India) — you cannot change it later.
2. **Set a budget alert first.** Billing → Budgets → create one for ₹1 so you
   hear about it immediately if anything ever falls outside the free
   allowance. Do this before creating the instance.
3. Compute → Instances → Create instance.
   - Image: **Ubuntu 22.04** or newer
   - Shape: **VM.Standard.A1.Flex** with 1 OCPU and 6GB — well inside the free
     allowance. If it says *out of capacity*, which is common for ARM, use
     **VM.Standard.E2.1.Micro** instead; 1GB is plenty here.
   - Save the SSH key it offers. You cannot get it again.
4. Connect: `ssh ubuntu@<the public IP>`

**No firewall holes needed.** The listener only makes outbound connections —
to WhatsApp and to Supabase. Leave the ingress rules alone; it needs nothing
open.

**Install and set up**

```bash
sudo apt update && sudo apt install -y nodejs npm git
sudo npm install -g n && sudo n 20          # Ubuntu ships an older Node
hash -r

git clone https://github.com/vaniabhagania/SRN
cd SRN/bot
npm install
nano config.js                               # list your groups
npm run dry                                  # scan the QR, watch the log
```

Scan the QR from the listener's phone, leave it an evening, read the output.

---

## Keeping it running

`npm start` dies when you close the terminal. `systemd` keeps it alive through
logouts, crashes and reboots. A unit file is included:

```bash
sudo cp srn-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now srn-listener
```

Then:

```bash
journalctl -u srn-listener -f        # watch it live
sudo systemctl restart srn-listener  # after changing config.js
sudo systemctl stop srn-listener     # turn it off
sudo systemctl status srn-listener   # is it alive?
```

Edit the paths in the unit file if you cloned somewhere other than
`/home/ubuntu/SRN/bot`. To run in dry-run under systemd, uncomment the
`DRY_RUN` line in it and restart.

**Link the phone before enabling the service.** The QR appears in the journal
rather than your terminal, which is awkward to scan. Run `npm run dry` once by
hand, scan it, confirm it connects, then hand over to systemd — the session in
`auth/` carries across.

---

## Looking after it

**Back up `auth/`.** It is the linked-device session. Lose it and you re-scan
the QR; leak it and someone else is signed in as that WhatsApp account. Treat
it like a password:

```bash
tar czf ~/srn-auth-backup.tgz auth/
```

**Supabase pauses free projects after a stretch of no activity.** With the
listener writing daily that will not come up, but if the kitchen goes quiet for
a couple of weeks, check the project is awake before assuming something broke.

**Updating:**

```bash
cd ~/SRN && git pull && cd bot && npm install
sudo systemctl restart srn-listener
```

---

## What it does with a message

| In the group | What happens |
|---|---|
| "1 chicken biryani for lunch - 2104" | Order, priced from the menu, on the matching chef's calendar |
| "Atta Laddoo 250g for 250rs" from a chef | Queued under *Dishes* in her Chef tab as a card — one tap to add it to the menu |
| Anything else from a chef | Ignored — chefs post menus and announcements, not orders |
| "Is biryani available?" | Ignored — a question is not an order |
| "the biryani was delicious ❤" | Review, 5 stars |
| A WhatsApp payment, or "₹250 sent to Mom" | Lands in Payments for the chef to confirm with one tap |
| A photo with no caption | Left alone — the hourly sync can read pictures (a menu poster, a payment screenshot), this cannot |

Dish names are matched loosely against the live menu, so "chicken briyani",
"harabara kebab" and "250 gm fry fruit aata ladoo" all find the right dish.
Anything it cannot match comes through at ₹0 for you to price in the app.

Weights are understood: "500 gram" of a dish the menu sells as "(250 g)" is filed
as two of them.

A menu post never goes straight onto the public menu. The listener has no login
and the security rules only let the chef write her own dishes, so it queues the
dish in `pending_dishes` and the chef confirms. Nothing a stranger posts can
reach the menu.

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

**Oracle says "out of capacity"** — the free ARM shapes are heavily contended.
Either try a different availability domain in the same region, or take
`VM.Standard.E2.1.Micro` instead, which is almost always free to create and
quite enough for this.

**It was running and now isn't** — `journalctl -u srn-listener -n 50` shows the
last 50 lines, which usually says why.

---

## What was and wasn't tested

Checked: the dish matcher against the real typos from the group (18 cases, all
passing), the message parser, the Supabase writes, and that it installs and
starts cleanly.

Not checked: the live WhatsApp connection, QR pairing, and reading real
messages — WhatsApp is not reachable from the environment this was built in.
First run on a real server is where that gets proven, which is what dry-run
mode is for.
