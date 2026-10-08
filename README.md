# SRN Kitchen

A mobile ordering app for SRN Kitchen — homecooked, guilt-free food.

Three chefs post the day's dishes from the kitchen side. Customers open the app
with no login, browse what's cooking, order from any chef, and see what they owe
each chef separately. Each chef gets a calendar of what she earned, day by day.

Live at **https://vaniabhagania.github.io/SRN/**

---

## What's in here

| File | What it is |
|---|---|
| `index.html` | The whole app. One file, no build step. |
| `schema.sql` | Database tables and security rules. Run once in Supabase. |
| `assets/` | The SRN Kitchen seal at a few sizes. |

---

## Going live — about ten minutes

Until you do this, the app works but keeps everything on one device: a dish
Shobha posts on her phone won't reach a customer's. These steps give all three
chefs and every customer the same live data.

**1. Make a Supabase project.** [supabase.com](https://supabase.com) → new
project. The free tier is enough. Pick a region near Bengaluru (Mumbai or
Singapore).

**2. Create the tables.** In the project: SQL Editor → New query → paste the
whole of `schema.sql` → Run. That makes the tables, locks them down, and adds
the three chefs.

**3. Make a login for each chef.** Authentication → Users → Add user, ticking
**Auto Confirm User**:

| Email | Password |
|---|---|
| `shobha@srnkitchen.app` | Shobha's 6-digit PIN |
| `ramya@srnkitchen.app` | Ramya's 6-digit PIN |
| `neha@srnkitchen.app` | Neha's 6-digit PIN |

The chefs never type these addresses — they just tap their name and enter the
PIN. The address is only how the login is stored.

Then copy each new user's UID and link it to her chef row (SQL Editor):

```sql
update chefs set auth_uid = '<UID for shobha>' where id = 'shobha';
update chefs set auth_uid = '<UID for ramya>'  where id = 'ramya';
update chefs set auth_uid = '<UID for neha>'   where id = 'neha';
```

**4. Make a place for dish photos.** Storage → New bucket → name it
`dish-photos` → tick **Public bucket**.

**5. Point the app at it.** Settings → API gives you a Project URL and an
`anon` `public` key. Put both into the top of the `<script>` in `index.html`:

```js
var CFG = {
  SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

Commit and push. GitHub Pages redeploys in a minute or two.

The anon key is *meant* to be public — it identifies the project, it doesn't
grant anything. What protects your data is the security rules in `schema.sql`:
anyone may read the menu and place an order, but only a signed-in chef can post
dishes or read a customer's name, phone and flat number.

---

## The two sides

**Customer side** — opens by default, no sign-in

- Today's dishes grouped by chef, with the standard veg / non-veg mark
- Filter by meal, and by veg or non-veg
- Totals split per chef, so each chef is paid her own amount
- Checkout asks for name, phone, **apartment complex and flat number** — which
  is how SRN actually delivers
- "Delivery charges are applicable, and to be paid at Delivery receive" appears
  in the order summary, at checkout, and on the Contact tab
- The finished order goes to each chef on WhatsApp, pre-filled, as well as into
  the app

**Chef side** — tap Chef, pick your name, enter your PIN

- **Dishes** — edit a price, take a dish off the menu, remove it
- **Add** — name, description, price, meal, veg or non-veg, optional photo
- **Orders** — who ordered what, with their flat number and a tap-to-call number
- **Earnings** — a month calendar. Each day shows what *you* earned; tap a date
  for that day's total and the orders behind it. A shared order counts only your
  share, never the whole bill.

The switch at the top of the chef screen closes your counter: your dishes grey
out for customers and stop being orderable, without deleting anything.

---

## Changing things

**Chefs, phone numbers, delivery complexes** — the three config blocks at the
top of the `<script>` in `index.html`:

```js
var CHEFS  = [...];   // name and WhatsApp number per chef
var TOWERS = [...];   // the complexes that appear in checkout
```

Changing a chef's name here also means updating her row in the `chefs` table.

**Colours and type** — every colour is a token in the `:root` block at the top
of the stylesheet. They come from the logo: the forest green of the ring, the
amber of the "crafted with care" script, and a warm cream ground. Marcellus sets
the headings to match the lettering on the seal; Karla carries the interface.
Light and dark are both defined, and the button in the header switches them.

---

## Known limits

- **Anyone can place an order**, including a bot, since customers don't log in.
  Fine at this size; if it ever gets abused, add a captcha or require a phone
  confirmation.
- **The calendar only knows about orders placed in the app.** Anything that came
  through WhatsApp has to go in by hand, with the "Add earnings for a past day"
  button.
- **Payments aren't tracked.** Each chef collects her own, as now. The app shows
  what is owed, not what has been received.
