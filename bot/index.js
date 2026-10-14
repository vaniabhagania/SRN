#!/usr/bin/env node
/* ============================================================
   SRN Kitchen — WhatsApp listener

   Sits in the kitchen's groups as a linked device, reads what
   customers post, and files orders, reviews and payments into the
   web app's database.

   It never sends. No replies, no reactions, no read receipts, no
   presence. The only traffic it makes is what WhatsApp needs to keep
   a linked device connected.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const P = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("baileys");

const cfg = require("./config");
const store = require("./store");
const WA = require("../whatsapp-parser.js");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- which messages we've already filed ---------- */
let seen = new Set();
try {
  seen = new Set(JSON.parse(fs.readFileSync(cfg.SEEN_FILE, "utf8")));
} catch { /* first run */ }

let seenDirty = false;
function remember(id) {
  seen.add(id);
  seenDirty = true;
  /* keep the file from growing without end */
  if (seen.size > 5000) seen = new Set([...seen].slice(-3000));
}
setInterval(() => {
  if (!seenDirty) return;
  try { fs.writeFileSync(cfg.SEEN_FILE, JSON.stringify([...seen])); seenDirty = false; }
  catch (e) { log("could not save seen list:", e.message); }
}, 20000).unref();

/* ---------- which groups we care about ---------- */
const wanted = new Map();   // jid -> { name, defaultChef }

function chefForSender(name) {
  const clean = WA.cleanName(name).toLowerCase();
  return cfg.CHEF_CHAT_NAMES[clean] || null;
}

/* Pull the readable text out of whatever shape the message is. */
function textOf(m) {
  const c = m.message || {};
  return (
    c.conversation ||
    c.extendedTextMessage?.text ||
    c.imageMessage?.caption ||
    c.videoMessage?.caption ||
    c.documentMessage?.caption ||
    ""
  ).trim();
}

/* WhatsApp's own payment messages carry structured data rather than text. */
function nativePayment(m) {
  const c = m.message || {};
  const pm = c.paymentInviteMessage || c.requestPaymentMessage || c.sendPaymentMessage;
  if (!pm) return null;
  const raw = pm.amount?.value ?? pm.amount1000 ?? null;
  if (raw == null) return null;
  const amount = Number(raw) / (pm.amount1000 ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

async function handle(m, sock) {
  const jid = m.key.remoteJid;
  const group = wanted.get(jid);
  if (!group) return;                       // not a group we watch
  if (m.key.fromMe) return;                 // our own linked device
  const id = m.key.id;
  if (!id || seen.has(id)) return;

  const ts = Number(m.messageTimestamp) * 1000;
  if (!ts || Date.now() - ts > cfg.MAX_AGE_HOURS * 3600 * 1000) { remember(id); return; }

  const senderRaw =
    m.pushName ||
    (m.key.participant || "").split("@")[0] ||
    "Someone";
  const who = WA.cleanName(senderRaw);
  const chefSender = chefForSender(senderRaw);
  const at = new Date(ts);

  /* --- a payment WhatsApp itself recorded --- */
  const native = nativePayment(m);
  if (native) {
    remember(id);
    if (chefSender) return;                 // a chef sending money is not a customer paying
    await store.savePayment(
      { who, amount: native, at, source: "text", text: "WhatsApp payment" },
      group.defaultChef || cfg.DEFAULT_CHEF
    );
    log(`payment  ${group.name}  ${who} ₹${native}`);
    return;
  }

  const body = textOf(m);
  if (!body) {
    /* an image with no caption — most often a menu photo or a payment
       screenshot. We can't read it here, so leave it for the hourly sync,
       which can look at the picture. */
    remember(id);
    return;
  }

  /* Feed one line to the shared parser, in the shape an export uses. */
  /* date first, then time — the order the parser reads */
  /* the parser reads chat times as India time, whatever zone this server is in */
  const IST = { timeZone: "Asia/Kolkata" };
  const line = `[${at.toLocaleDateString("en-GB", IST)}, ${at.toLocaleTimeString("en-GB", { ...IST, hour12: false })}] ${who}: ${body}`;
  let res;
  try { res = WA.parse(line); }
  catch (e) { log("parse failed:", e.message); remember(id); return; }

  remember(id);

  try {
    if (res.payments.length && !chefSender) {
      for (const p of res.payments) {
        await store.savePayment({ ...p, at, who, source: "text" },
          group.defaultChef || cfg.DEFAULT_CHEF);
        log(`payment  ${group.name}  ${who} ₹${p.amount}`);
      }
      return;
    }

    /* A chef's own message is a menu or an announcement, never an order.
       When it names a dish and a price it is queued for her to put on the
       menu with one tap — this listener has no login, so it cannot add
       dishes itself. */
    if (chefSender) {
      /* "Orders closed" takes her dishes off the customer menu; a fresh menu
         or "orders open" puts them back. The last thing she said wins. */
      const last = res.counter[res.counter.length - 1];
      if (last) {
        const result = await store.setCounter(chefSender, last.state === "open", at);
        log(`counter  ${group.name}  ${chefSender}  ${last.state}  → ${result}`);
      }
      for (const d of res.menu) {
        const key = `${id}:${d.name}`.slice(0, 120);
        await store.savePendingDish({ ...d, at }, chefSender, key);
        log(`menu     ${group.name}  ${chefSender}  ${d.name}  ₹${d.price}`);
      }
      return;
    }

    if (res.reviews.length) {
      for (const r of res.reviews) {
        await store.saveReview({ ...r, at, who }, group.defaultChef || null);
        log(`review   ${group.name}  ${who} ${r.rating}★`);
      }
      return;
    }

    if (res.orders.length) {
      for (const o of res.orders) {
        const { grand, unpriced } = await store.saveOrder(
          { ...o, at, who },
          group.defaultChef || cfg.DEFAULT_CHEF
        );
        log(
          `order    ${group.name}  ${who}  ${o.items.map((i) => `${i.qty}×${i.name}`).join(", ")}` +
          `  ₹${grand}${unpriced.length ? `  (not on the menu: ${unpriced.join(", ")})` : ""}`
        );
      }
    }
  } catch (e) {
    log("could not save:", e.message);
  }
}

/* ---------- connect ---------- */
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(cfg.AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    /* stay invisible: don't take over notifications on the real phone */
    markOnlineOnConnect: false,
    syncFullHistory: false,
    logger: P({ level: "silent" }),
    browser: ["SRN Kitchen listener", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      log("Scan this from the listener's phone:");
      log("  WhatsApp → Settings → Linked devices → Link a device");
      try {
        require("qrcode-terminal").generate(qr, { small: true });
      } catch {
        log("(install qrcode-terminal to see the code here)");
      }
    }

    if (connection === "open") {
      log("connected" + (cfg.DRY_RUN ? "  — DRY RUN, nothing will be written" : ""));
      try {
        const all = await sock.groupFetchAllParticipating();
        wanted.clear();
        for (const g of Object.values(all)) {
          const match = cfg.GROUPS.find(
            (w) => w.name.trim().toLowerCase() === (g.subject || "").trim().toLowerCase()
          );
          if (match) wanted.set(g.id, { name: g.subject, defaultChef: match.defaultChef });
        }
        if (!wanted.size) {
          log("WARNING: none of the groups in config.js were found.");
          log("Groups this account is in:");
          for (const g of Object.values(all)) log("   •", g.subject);
        } else {
          log("listening to: " + [...wanted.values()].map((g) => g.name).join(", "));
        }
      } catch (e) {
        log("could not list groups:", e.message);
      }
      await store.refreshMenu()
        .then((m) => log(`menu has ${m.length} dishes to price against`))
        .catch((e) => log("could not load the menu:", e.message));
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log("This device was unlinked from WhatsApp.");
        log(`Delete ${cfg.AUTH_DIR} and start again to re-link.`);
        process.exit(1);
      }
      const wait = 5000;
      log(`disconnected (${code ?? "unknown"}), reconnecting in ${wait / 1000}s`);
      setTimeout(start, wait);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;          // ignore history backfill
    for (const m of messages) {
      try { await handle(m, sock); }
      catch (e) { log("message failed:", e.message); }
    }
  });
}

process.on("unhandledRejection", (e) => log("unhandled:", e?.message || e));

start().catch((e) => {
  log("could not start:", e.message);
  process.exit(1);
});
