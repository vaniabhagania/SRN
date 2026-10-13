/* ============================================================
   Everything that talks to Supabase.
   Writes only — the listener never needs to read customer data.
   ============================================================ */
"use strict";

const cfg = require("./config");

const REST = cfg.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/";
const HEAD = {
  apikey: cfg.SUPABASE_KEY,
  Authorization: "Bearer " + cfg.SUPABASE_KEY,
  "Content-Type": "application/json",
  /* return=minimal matters: a customer cannot read orders back, so asking
     for the inserted row would be refused by the security rules. */
  Prefer: "return=minimal"
};

async function get(path) {
  const r = await fetch(REST + path, {
    headers: { apikey: cfg.SUPABASE_KEY, Authorization: "Bearer " + cfg.SUPABASE_KEY }
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(table, row) {
  if (cfg.DRY_RUN) {
    console.log(`  [dry run] would write to ${table}:`, JSON.stringify(row));
    return;
  }
  const r = await fetch(REST + table, {
    method: "POST", headers: HEAD, body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`POST ${table} → ${r.status} ${await r.text()}`);
}

/* ---- the live menu, used to price what customers type ---- */
let menu = [];
let menuFetchedAt = 0;

async function refreshMenu() {
  /* cache for five minutes; a chef posting a dish shows up soon enough */
  if (Date.now() - menuFetchedAt < 5 * 60 * 1000 && menu.length) return menu;
  menu = await get("dishes?select=name,price,chef_id&available=eq.true");
  menuFetchedAt = Date.now();
  return menu;
}

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/* Edit distance, capped — we only ever care whether it's small. */
function dist(a, b, cap = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (row[j] < best) best = row[j];
    }
    if (best > cap) return cap + 1;           // whole row too far — give up early
    prev = row;
  }
  return prev[b.length];
}

/* Two words close enough to be the same word: "ladoo"/"laddoo",
   "ballavi"/"ballabhi", "biryani"/"briyani", "dryfruit"/"dryfruits". */
function sameWord(a, b) {
  if (a === b) return true;
  const cap = Math.min(2, Math.floor(Math.max(a.length, b.length) / 3));
  return cap > 0 && dist(a, b, cap) <= cap;
}

/* Words worth comparing — drops "of", "plate", weights and numbers. */
const NOISE = /^(of|the|a|an|with|and|plate|plates|pcs|pc|no|nos|gm|gms|g|kg|ml|l|packet|packets|box)$/;
function words(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) =>
      w && w.length > 1 &&
      !/^\d+$/.test(w) &&              // 250
      !/^\d+[a-z]{1,3}$/.test(w) &&    // 250g, 500ml
      !NOISE.test(w));
}

/* How much of the menu dish's name the customer actually said. */
function overlap(said, dish) {
  const A = words(said), B = words(dish);
  if (!A.length || !B.length) return 0;
  const used = new Set();
  let hit = 0;
  for (const b of B) {
    for (let i = 0; i < A.length; i++) {
      if (used.has(i)) continue;
      if (sameWord(A[i], b)) { used.add(i); hit++; break; }
    }
  }
  return hit / B.length;
}

/* Kept for the tests and for callers that want the raw comparison. */
function near(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > 4 && b.length > 4 && (a.includes(b) || b.includes(a))) return true;
  return sameWord(a, b);
}

function priceItem(name) {
  const key = squash(name);
  let best = null, bestScore = 0;

  for (const d of menu) {
    const dk = squash(d.name);
    if (dk === key) return d;                 // exact wins outright

    /* one name sitting inside the other — "biryani" vs "chicken biryani" */
    if (key.length > 4 && dk.length > 4 && (key.includes(dk) || dk.includes(key))) {
      if (bestScore < 0.95) { best = d; bestScore = 0.95; }
      continue;
    }

    /* the whole thing, spaces removed, off by a letter or two — catches
       "harabara kebab" for "Hara Bhara Kebab", where the words themselves
       don't line up because the customer ran two of them together */
    const cap = Math.max(1, Math.floor(Math.max(key.length, dk.length) / 8));
    if (dist(key, dk, cap) <= cap) {
      if (bestScore < 0.9) { best = d; bestScore = 0.9; }
      continue;
    }

    const score = overlap(name, d.name);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  /* most of the dish's words have to be there, so "mutton curry" doesn't
     quietly become "Chicken Biryani" */
  return bestScore >= 0.6 ? best : null;
}

/* ---- writes ---- */
async function saveOrder(parsed, fallbackChef) {
  await refreshMenu().catch(() => {});
  const items = parsed.items.map((it) => {
    const dish = priceItem(it.name);
    const price = dish ? Number(dish.price) : 0;
    return {
      chef_id: dish ? dish.chef_id : fallbackChef,
      name: dish ? dish.name : it.name,
      qty: it.qty,
      price,
      amount: price * it.qty
    };
  });
  const grand = items.reduce((s, i) => s + i.amount, 0);
  const unpriced = items.filter((i) => !i.price).map((i) => i.name);

  await post("orders", {
    customer_name: parsed.who,
    phone: "",
    tower: parsed.tower || "From WhatsApp",
    flat: parsed.flat || "—",
    note: "From WhatsApp" + (parsed.meal ? " · " + parsed.meal : ""),
    items,
    grand,
    paid: false,
    placed_at: parsed.at.toISOString()
  });
  return { grand, unpriced };
}

async function saveReview(r, chefId) {
  await post("reviews", {
    name: r.who,
    rating: r.rating,
    body: r.body,
    chef_id: chefId || null,
    created_at: r.at.toISOString()
  });
}

async function savePayment(p, chefId) {
  await post("pending_payments", {
    who: p.who,
    amount: p.amount || null,
    chef_id: p.toChef || chefId || null,
    source: p.source || "text",
    raw: p.text || "",
    seen_at: p.at.toISOString()
  });
}

module.exports = { saveOrder, saveReview, savePayment, refreshMenu, priceItem, near, squash };
