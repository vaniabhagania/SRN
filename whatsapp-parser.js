/* ============================================================
   WhatsApp export parser for SRN Kitchen
   Shared by the in-app importer and the scraper.
   ============================================================ */

var WA = (function () {
  "use strict";

  /* People who run the kitchen. Their messages are menus and
     announcements, never customer orders. */
  var ADMINS = /^(mom|shobha|ramya|neha|shobha aunty|ramya aunty|neha aunty|deepti aunty|vania|vinod uncle)$/i;

  /* Lines WhatsApp itself writes. */
  var SYSTEM = /(joined using this group's invite|added you|created group|changed the subject|changed this group's icon|messages and calls are end-to-end encrypted|security code changed|deleted this message|this message was deleted|<Media omitted>|image omitted|video omitted|sticker omitted|document omitted|null)/i;

  var DISH_WORDS = /biryani|briyani|paratha|parantha|kebab|kabab|custard|puff|ladoo|laddoo|ghujiya|gujiya|radha\s*ballavi|kofta|phulka|pav|bhaji|tikki|ghugni|vada|paneer|halwa|mutton|chicken|gatte|sabzi|curry|roti|rice|dal|idli|dosa|poha|upma|samosa|cutlet|roll|thali|meal|plate/i;

  var MEALS = [
    { re: /\bbreakfast\b/i,            slot: "breakfast" },
    { re: /\blunch\b/i,                slot: "lunch" },
    { re: /\b(dinner|supper)\b/i,      slot: "dinner" },
    { re: /\b(evening|snack|snacks)\b/i, slot: "evening" }
  ];

  /* ---------- one line of an export ----------
     Handles the shapes WhatsApp writes on iOS and Android:
       [07/10/2026, 1:34:02 pm] Vinita: 250gm
       07/10/2026, 13:34 - Vinita: 250gm
       7/10/26, 1:34 pm - Vinita: 250gm
     Returns null for a continuation line (part of the message above). */
  function parseLine(line) {
    var m = line.match(
      /^‎?\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s?([\s\S]*)$/i
    );
    if (!m) return null;

    var day = +m[1], mon = +m[2], yr = +m[3];
    if (yr < 100) yr += 2000;
    var hh = +m[4], mm = +m[5];
    var ampm = (m[7] || "").toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;

    return {
      date: new Date(yr, mon - 1, day, hh, mm, +(m[6] || 0)),
      sender: m[8].trim(),
      text: (m[9] || "").trim()
    };
  }

  /* Group an export into messages, joining wrapped continuation lines. */
  function toMessages(raw) {
    var out = [];
    String(raw).split(/\r?\n/).forEach(function (line) {
      var p = parseLine(line);
      if (p) out.push(p);
      else if (out.length && line.trim()) {
        out[out.length - 1].text += "\n" + line.trim();
      }
    });
    return out.filter(function (m) { return m.text && !SYSTEM.test(m.text); });
  }

  /* A question is someone asking, not ordering. */
  var QUESTION = /\?\s*$|^\s*(is|are|do|does|can|could|will|would|any|what|when|where|how|which|anyone|anybody)\b/i;

  /* ---------- flat number ----------
     Trailing 3-4 digits, "- 1174", "B-605", "For 1083 -", or "2012, 1 Chicken". */
  function findFlat(text) {
    var t = text.replace(/₹\s*[\d,]+/g, " ");           // drop money
    t = t.replace(/\b\d{1,3}\s*(gm|gms|g|kg|ml|l)\b/gi, " ");// drop weights
    t = t.replace(/\b[ap]\.?m\.?\b/gi, " ");

    /* "B-605", "b 605", "B605" — a lone letter then the number */
    var blk = t.match(/(?:^|\s)([A-Za-z])\s*[-–]?\s*(\d{2,4})\b/);
    if (blk) return (blk[1] + "-" + blk[2]).toUpperCase();

    var m =
      t.match(/^\s*for\s+(\d{3,4})\b/i) ||                  // For 1083 - ...
      t.match(/^\s*(\d{3,4})\s*,/) ||                       // 2012, 1 Chicken...
      t.match(/[-–]\s*(\d{3,4})\b/) ||                 // - 1174
      t.match(/\b(\d{3,4})\s*$/) ||                         // trailing 2104
      t.match(/\b(\d{3,4})\b(?=\s*[,.]?\s*(heh|gg|olive|gopalan|sumadhura|raja|five))/i);
    if (!m) return null;
    /* No year check here on purpose: real flats in these towers are 2012,
       2031, 2104 — rejecting "20xx" would throw away most of them. The
       timestamp is already stripped by the line parser. */
    return m[1].replace(/\s+/g, "").toUpperCase();
  }

  var TOWER_HINTS = [
    { re: /\bheh\b|habitat\s*eden/i,        name: "Habitat Eden Heights" },
    { re: /\bgg\b|gopalan/i,                name: "Gopalan Grandeur" },
    { re: /\bolive\b/i,                     name: "Olive apartment" },
    { re: /raja\s*ritz/i,                   name: "Raja Ritz" },
    { re: /five\s*summit/i,                 name: "The Five Summits Address" },
    { re: /sumadhura\s*nandanam|nandanam/i, name: "Sumadhura Nandanam" },
    { re: /sumadhura\s*srinivasam|srinivasam/i, name: "Sumadhura Srinivasam" },
    { re: /sumadhura/i,                     name: "Sumadhura Nandanam" }
  ];
  function findTower(text) {
    for (var i = 0; i < TOWER_HINTS.length; i++) {
      if (TOWER_HINTS[i].re.test(text)) return TOWER_HINTS[i].name;
    }
    return null;
  }

  function findMeal(text) {
    for (var i = 0; i < MEALS.length; i++) {
      if (MEALS[i].re.test(text)) return MEALS[i].slot;
    }
    return null;
  }

  /* ---------- items ----------
     "1 chicken biryani, 1 radha ballavi" -> two items
     "250 gm Ghujiya"                     -> one item, qty 1
     Returns [] when nothing dish-like is found. */
  var TOWER_NOISE = /\b(heh|gg|olive(\s*apartments?)?|gopalan(\s*grandeur)?|sumadhura(\s*nandanam|\s*srinivasam)?|nandanam|srinivasam|raja\s*ritz|five\s*summits?(\s*address)?|habitat\s*eden\s*heights?)\b/gi;

  function findItems(text) {
    if (QUESTION.test(text)) return [];

    var body = text
      .replace(/^\s*for\s+\d{3,4}\s*[-–]?\s*/i, " ")        // "For 1083 - "
      .replace(/^\s*\d{3,4}\s*,\s*/, " ")                        // "2012, "
      .replace(/\([^)]*\)/g, " ")                                // "(lunch)"
      .replace(/\bfor\s+(lunch|dinner|breakfast|evening|snacks?)\b/gi, " ")
      .replace(/\b(lunch|dinner|breakfast|evening)\b/gi, " ")
      .replace(TOWER_NOISE, " ")
      .replace(/[-–]\s*[A-Za-z]?\s?\d{2,4}\s*$/, " ")
      .replace(/\b[A-Za-z]\s?-\s?\d{2,4}\b/g, " ")               // B-605
      .replace(/\b\d{3,4}\s*$/, " ")
      .replace(/\bwill\s+porter\b/gi, " ")
      .replace(/\bkindly\b[\s\S]*$/i, " ")
      .replace(/\bplz\b|\bplease\b|\bthanks?\b|\bthank you\b/gi, " ");

    var items = [];
    body.split(/\s*(?:,|\band\b|\+|&|;|\n)\s*/i).forEach(function (part) {
      part = part.trim();
      if (!part || !DISH_WORDS.test(part)) return;

      var qty = 1;
      /* a leading number is a quantity unless it's a weight ("250 gm") */
      var isWeight = /^\d{1,4}\s*(gm|gms|g|kg|ml|l)\b/i.test(part);
      if (!isWeight) {
        var q = part.match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?/);
        if (q) { qty = parseFloat(q[1]); part = part.slice(q[0].length); }
      }
      var qe = part.match(/\s*[x×]\s*(\d+)\s*$/i);
      if (qe) { qty = parseFloat(qe[1]); part = part.slice(0, qe.index); }

      var name = part
        .replace(/^\s*(plates?|nos?|pcs?|packets?)\s+(of\s+)?/i, "")
        .replace(/\s*(plates?|pcs?)\s*$/i, "")
        .replace(/[☀-➿️❤\u{1F300}-\u{1FAFF}]/gu, " ")  // emoji
        .replace(/[.,;:–-]+\s*$/, "")                        // trailing punctuation
        .replace(/^\s*[.,;:–-]+/, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (!name || name.length < 3) return;
      if (qty <= 0 || qty > 99) qty = 1;
      name = name.charAt(0).toUpperCase() + name.slice(1);
      items.push({ name: name, qty: qty });
    });
    return items;
  }

  /* ---------- payment ---------- */
  function findPayment(text) {
    var m = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/) ||
            text.match(/\b(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (!m) return null;
    var amt = parseFloat(m[1].replace(/,/g, ""));
    if (!(amt > 0)) return null;
    var paid = /paid|sent to|upi|phonepe|gpay|google pay|paytm|transferred/i.test(text);
    return { amount: amt, confirmed: paid };
  }

  /* ---------- review ----------
     Only unmistakable praise or complaint, so the preview stays honest. */
  var PRAISE = /\b(delicious|yummy|tasty|amazing|excellent|lovely|superb|fantastic|wonderful|loved it|love it|so good|very good|too good|awesome|great food|perfect|best)\b|❤|😋|😍|👌|🤤|🔥/i;
  var GRIPE  = /\b(cold|late|soggy|bland|salty|spicy|stale|missing|wrong order|disappointed|not good|bad)\b/i;

  /* An order names a quantity up front ("2 vada pav", "250 gm ghujiya").
     Praise about food already eaten does not. */
  var ORDER_SHAPE = /(^|[,;]\s*|\band\s+)\d+(\.\d+)?\s*(x\s*)?(plates?|nos?|pcs?|gm|gms|g|kg)?\s*[a-z]/i;

  function findReview(text) {
    if (findPayment(text)) return null;
    var praise = PRAISE.test(text), gripe = GRIPE.test(text);
    if (!praise && !gripe) return null;
    /* "2 biryani please" with a heart is still an order */
    if (ORDER_SHAPE.test(text) && findItems(text).length) return null;
    return { rating: praise ? 5 : 2, body: text.slice(0, 300) };
  }

  /* ---------- the whole export ---------- */
  function parse(raw) {
    var msgs = toMessages(raw);
    var orders = [], payments = [], reviews = [], skipped = 0;

    msgs.forEach(function (m) {
      var fromAdmin = ADMINS.test(m.sender);

      var pay = findPayment(m.text);
      if (pay && !fromAdmin) {
        payments.push({
          at: m.date, who: m.sender,
          amount: pay.amount, confirmed: pay.confirmed, text: m.text.slice(0, 200)
        });
        return;
      }
      if (fromAdmin) { skipped++; return; }

      /* praise first — "the biryani was delicious" is not an order */
      var rev = findReview(m.text);
      if (rev) {
        reviews.push({ at: m.date, who: m.sender, rating: rev.rating, body: rev.body });
        return;
      }

      var items = findItems(m.text);
      if (items.length) {
        orders.push({
          at: m.date, who: m.sender, items: items,
          flat: findFlat(m.text), tower: findTower(m.text),
          meal: findMeal(m.text), text: m.text.slice(0, 220)
        });
        return;
      }
      skipped++;
    });

    return { orders: orders, payments: payments, reviews: reviews,
             total: msgs.length, skipped: skipped };
  }

  return { parse: parse, parseLine: parseLine, toMessages: toMessages,
           findItems: findItems, findFlat: findFlat, findTower: findTower,
           findMeal: findMeal, findPayment: findPayment };
})();

if (typeof module !== "undefined") module.exports = WA;
