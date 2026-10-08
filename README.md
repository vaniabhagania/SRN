# SRN Kitchen

A mobile ordering app for SRN Kitchen — homecooked, guilt-free food.

Three chefs post the day's dishes from the kitchen side. Customers open the app
with no login, browse what's cooking, order from any chef, and see what they owe
each chef separately.

---

## What's in here

| File | What it is |
|---|---|
| `index.html` | The whole app — markup, styles and logic in one file. No build step, no dependencies. |
| `assets/` | The SRN Kitchen seal at a few sizes. |

Open `index.html` in a browser and it runs. That's the whole deal.

---

## The two sides

**Customer side** (opens by default, no sign-in)

- Today's dishes, grouped by chef
- Filter by meal — Everything / Breakfast / Lunch / Dinner
- Filter by Veg / Non-veg, with the standard green and brown-red mark on every dish
- Add to the order, adjust quantities
- Totals split per chef, so each chef is paid her own amount
- Name, address and phone are taken at checkout
- "Delivery charges are applicable, and to be paid at Delivery receive" appears in the
  order summary, at checkout, and on the Contact tab
- Finished orders are handed to each chef over WhatsApp, pre-filled

**Chef side** (the Chef tab)

- Sign in by picking your name and entering a PIN
- Post a dish: name, description, price, meal slot, veg/non-veg, optional photo
- Photos are resized in the browser before they're stored
- Edit a price, take a dish off the menu, or remove it
- "Cooked by" defaults to your name and can be changed per dish
- One switch closes your counter — your dishes grey out and stop being orderable
- Orders recorded in the app show under Orders

**Reviews and Contact** are tabs of their own. Reviews take a 1–5 rating, an optional
note and emoji. Contact lists all three numbers; tapping one dials, and there's a copy
button beside it for phones that don't pick up `tel:` links.

---

## Chefs, numbers and PINs

The roster lives in one block at the top of the `<script>` in `index.html`:

```js
var CHEFS = [
  { id: "shobha", name: "Shobha", phone: "919800373577", pin: "1001" },
  { id: "ramya",  name: "Ramya",  phone: "918105177446", pin: "1002" },
  { id: "neha",   name: "Neha",   phone: "919962506977", pin: "1003" }
];
```

Change a name, number or PIN there. Phone numbers are country code + number, digits only.

**These PINs are not security.** They sit in the page source, so anyone who opens the
app can read them. They keep an ordinary customer out of the kitchen screens; they do
not keep out anyone determined. Treat the chef side as convenience, not a locked door,
until there's a real backend (below).

---

## Where the data goes — read this before you launch

The app stores dishes, reviews and orders in whichever of these it finds:

1. **Claude artifact database** — when the page runs as a published Claude artifact.
   Shared across everyone who opens it.
2. **`localStorage`** — the fallback everywhere else, including GitHub Pages.
   **Data stays on the one device that entered it.**

That second case is the thing to understand. If you deploy this file as-is to GitHub
Pages, a dish Shobha posts on her phone is saved *on her phone*. A customer opening the
same link sees an empty menu. The app works, but each device is its own island.

For a real launch you need a backend the devices share. The code is written so this is a
contained change — every read and write goes through the `Store` object, so a third
adapter alongside the two there is the whole job. Supabase or Firebase both fit; the
shape you'd need is:

- `chefs` — id, name, open
- `dishes` — id, chefId, chefName, name, note, price, slot, diet, available, createdAt
- `dishimages` — id (same as the dish), data
- `reviews` — id, name, rating, text, createdAt
- `orders` — id, customer {name, phone, address}, items[], grand, placedAt

Move the PIN check server-side at the same time, and the chef side becomes a real login.

---

## Deploying

**GitHub Pages** — Settings → Pages → Deploy from branch → `main` / root.
It'll be live at `https://vaniabhagania.github.io/srn/`.

**Anywhere else** — upload `index.html` and `assets/`. Any static host works:
Netlify, Vercel, Cloudflare Pages.

Add it to a phone home screen from the browser's share menu and it opens full-screen,
like an app.

---

## Design

Colours are taken from the logo: the deep forest green of the ring, the amber of the
"crafted with care" script, and a warm cream ground. Marcellus (an inscriptional roman)
sets the headings, matching the lettering on the seal; Karla carries the interface text.
Light and dark themes are both defined, and the button in the header switches between
them.

Every colour is a token in the `:root` block at the top of the stylesheet. Change them
there and the whole app follows.
