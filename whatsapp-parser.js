/* ============================================================
   WhatsApp export parser for SRN Kitchen
   Shared by the in-app importer and the scraper.
   ============================================================ */

var WA = (function () {
  "use strict";

  /* Who in the chat is which chef. "Mom" is how Neha appears in the group. */
  var CHEF_BY_CHAT_NAME = {
    "mom": "neha",
    "neha": "neha",
    "shobha": "shobha",
    "ramya": "ramya"
  };

  /* People who run the kitchen. Their messages are menus and
     announcements, never customer orders. */
  var ADMINS = /^(mom|shobha|ramya|neha|deepti|vania|vinod)$/i;

  /* WhatsApp shows saved contacts as they're stored — "Shobha aunty",
     "Vinod uncle". Drop the honorific so the name reads as a name. */
  function cleanName(raw) {
    var n = String(raw || "").trim();
    n = n.replace(/\s*[\(\[].*?[\)\]]\s*$/, "");                 // "Asha (Olive)"
    n = n.replace(/\s+(aunty|auntie|aunt|uncle|anna|akka|bhaiya|didi|ji|sir|madam|ma'?am)\s*$/i, "");
    n = n.replace(/^(mr|mrs|ms|dr)\.?\s+/i, "");
    n = n.replace(/\s{2,}/g, " ").trim();
    return n || String(raw || "").trim();
  }

  /* Which chef a chat name belongs to, or null for a customer. */
  function chefFor(rawName) {
    return CHEF_BY_CHAT_NAME[cleanName(rawName).toLowerCase()] || null;
  }

  /* Lines WhatsApp itself writes. */
  var SYSTEM = /(joined using this group's invite|added you|created group|changed the subject|changed this group's icon|messages and calls are end-to-end encrypted|security code changed|deleted this message|this message was deleted|<Media omitted>|image omitted|video omitted|sticker omitted|document omitted|null)/i;

  var DISH_WORDS = /biryani|briyani|paratha|parantha|kebab|kabab|custard|puff|ladoo|laddoo|laddo|laddu|ladu|ghujiya|gujiya|radha\s*ballavi|kofta|phulka|pav|bhaji|tikki|ghugni|vada|paneer|halwa|mutton|chicken|gatte|sabzi|curry|roti|rice|dal|idli|dosa|poha|upma|samosa|cutlet|roll|thali|meal|plate/i;

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
     ...and the TIME-FIRST header WhatsApp Web uses in
     data-pre-plain-text, which both the live bot and the hourly
     sync build their lines from:
       [1:34 pm, 07/10/2026] Vinita: 250gm
       [13:34:02, 07/10/2026] Vinita: 250gm
     Both orderings must work: a line that only the other half
     understands parses as nothing at all, and an order silently
     disappears.
     Returns null for a continuation line (part of the message above). */
  var DATE_FIRST = /^‎?\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s?([\s\S]*)$/i;
  var TIME_FIRST = /^‎?\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?,?\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\]?\s*[-–]?\s*([^:]{1,60}?):\s?([\s\S]*)$/i;

  function parseLine(line) {
    var day, mon, yr, hh, mm, ss, ampm, sender, text;

    /* date-first first: a date can't start with "12:" so the two
       shapes never claim the same line. */
    var m = line.match(DATE_FIRST);
    if (m) {
      day = +m[1]; mon = +m[2]; yr = +m[3];
      hh = +m[4]; mm = +m[5]; ss = +(m[6] || 0);
      ampm = m[7]; sender = m[8]; text = m[9];
    } else {
      m = line.match(TIME_FIRST);
      if (!m) return null;
      hh = +m[1]; mm = +m[2]; ss = +(m[3] || 0); ampm = m[4];
      day = +m[5]; mon = +m[6]; yr = +m[7];
      sender = m[8]; text = m[9];
    }

    if (yr < 100) yr += 2000;
    ampm = (ampm || "").toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;

    return {
      date: new Date(yr, mon - 1, day, hh, mm, ss),
      sender: sender.trim(),
      text: (text || "").trim()
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
    t = t.replace(/\b\d{1,4}\s*(gm|gms|gram|grams|g|kg|ml|l)\b/gi, " ");// drop weights
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
      var isWeight = /^\d{1,4}\s*(gm|gms|gram|grams|g|kg|ml|l)\b/i.test(part);
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
        .replace(/\s+for\s*$/i, "")                              // "…500 gram for 1025"
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

  /* ---------- menu posts ----------
     A chef posting what's cooked, with a price:
       "Atta Dryfruits Laddoo\n250gms for 250rs"
       "Chicken Biryani - ₹180"
       "Hara Bhara Kebab 6 pcs @ 150/-"
     Returns [{ name, price, slot, diet }]. Only chefs' posts are read this
     way; a customer typing "atta laddo 500 gram for 1025" is an order. */
  var MENU_WORDS = new RegExp(DISH_WORDS.source +
    "|pulao|pulav|khichdi|naan|sandwich|burger|pizza|pasta|noodles|manchurian|cake|brownie|cookies?|chaat|dhokla|kachori|jalebi|kheer|lassi|salad|soup|sweet|namkeen|chakli|murukku|mixture|pickle|chutney|combo|box", "i");
  var NOT_A_DISH = /\b(pay|paid|payment|received|delivery\s+charges?|total|balance|upi|gpay|phonepe|collect|refund|sent to|advance|bill)\b/i;
  var NONVEG = /chicken|mutton|fish|prawn|egg|keema|lamb|beef|pork|crab|seafood/i;
  var PRICE_RES = [
    /₹\s*(\d[\d,]*(?:\.\d+)?)/,
    /\b(?:rs\.?|rupees|inr)\s*(\d[\d,]*(?:\.\d+)?)/i,
    /(\d[\d,]*(?:\.\d+)?)\s*(?:rs\.?|rupees|inr|\/-|₹)(?!\w)/i,
    /\bfor\s+(\d{2,5})\b(?!\s*(?:gm|gms|g|kg|ml|pcs?))/i
  ];

  function priceIn(line) {
    for (var i = 0; i < PRICE_RES.length; i++) {
      var m = line.match(PRICE_RES[i]);
      if (m) {
        var p = parseFloat(m[1].replace(/,/g, ""));
        if (p >= 5 && p <= 20000) return { price: p, at: m.index };
      }
    }
    /* "Chicken Biryani 180" — a bare 2-3 digit figure closing a line that
       names a dish. Four digits would be a flat number, so those don't count. */
    var b = line.match(/[a-z)]\s*[-–:@]?\s*(\d{2,3})\s*$/i);
    if (b && MENU_WORDS.test(line) && !/\b(from|to|flat|tower)\b/i.test(line)) {
      var bp = parseFloat(b[1]);
      if (bp >= 20) return { price: bp, at: line.length - b[0].length + b[0].search(/\d/) };
    }
    return null;
  }

  function tidyDish(raw) {
    var weight = "";
    var w = raw.match(/(\d+(?:\.\d+)?)\s*(gms?|grams?|g|kg|ml|l|pcs?|pieces?|nos?)\b/i);
    if (w) {
      var u = w[2].toLowerCase();
      u = /^g/.test(u) ? "g" : /^pc|^piece|^no/.test(u) ? "pcs" : u;
      weight = w[1] + " " + u;
      raw = raw.replace(w[0], " ");
    }
    var name = raw
      .replace(/[☀-➿️❤\u{1F300}-\u{1FAFF}]/gu, " ")
      .replace(/\b(price|cost|only|each|per|available|today|menu|special|new|pre-?book|pre-?order)\b\s*:?/gi, " ")
      .replace(/^\s*(breakfast|lunch|dinner|supper)\b[\s:–—-]*/i, " ")
      .replace(/[@:–—-]+\s*$/g, " ")
      .replace(/\b(for|at|is|@)\s*$/i, " ")
      .replace(/^[\s\-–—•*:.,]+|[\s\-–—•*:.,]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (name.length < 3 || !/[a-z]{3}/i.test(name)) return null;
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return { name: name, weight: weight };
  }

  function findMenu(text, atMeal) {
    var out = [];
    var body = String(text || "").replace(/\r/g, "");
    if (!body.trim() || NOT_A_DISH.test(body) || QUESTION.test(body)) return out;

    var lines = body.split(/\n+/);
    /* a line holding several prices ("Biryani 180, Pulao 120") splits at commas */
    var segs = [];
    lines.forEach(function (ln) {
      var parts = ln.split(/\s*[,;]\s*/);
      if (parts.length > 1 && parts.filter(priceIn).length > 1) {
        parts.forEach(function (x) { segs.push(x); });
      } else {
        segs.push(ln);
      }
    });

    var carry = null;           // a name on the line above its price
    segs.forEach(function (seg) {
      seg = seg.trim();
      if (!seg) return;
      var p = priceIn(seg);
      if (!p) {
        carry = /[a-z]{3}/i.test(seg) && seg.length <= 70 ? seg : null;
        return;
      }
      var left = seg.slice(0, p.at);
      var nm = tidyDish(left);
      if (!nm && carry) nm = tidyDish(carry + " " + left);   // keeps "250gms for"
      if (!nm && !carry) {
        /* "Chicken biryani for ₹180": name may also follow the price */
        nm = tidyDish(seg.slice(p.at).replace(PRICE_RES[0], " "));
      }
      carry = null;
      if (!nm) return;
      /* an ordinary sentence with a figure in it is not a dish */
      if (!DISH_WORDS.test(nm.name) && nm.name.split(/\s+/).length > 6) return;

      var slot = "all";
      var meal = atMeal || findMeal(body);
      if (meal === "breakfast" || meal === "lunch" || meal === "dinner") slot = meal;

      out.push({
        name: nm.weight ? nm.name + " (" + nm.weight + ")" : nm.name,
        price: p.price,
        slot: slot,
        diet: NONVEG.test(nm.name) ? "nonveg" : "veg"
      });
    });
    return out;
  }

  /* ---------- counter open / closed ----------
     A chef saying the kitchen has stopped (or started) taking orders:
       "Orders closed for today"   "Lunch orders are closed"   "sold out"
       "Kindly pre book your orders for tomorrow"   "Orders open"
     Returns "closed", "open" or null. null means "no change" — when in doubt
     the counter is left alone, since a wrong guess hides or shows a menu.
     Closed wins when a message says both ("orders closed, will reopen
     tomorrow"). Only chefs' own posts are read this way. */
  var CLOSED_RES = [
    /\b(orders?|bookings?|pre-?bookings?|pre-?orders?|counter|kitchen|taking orders)\b[^.\n!]{0,40}\b(closed?|closing|over|full|stopped|finished|ended|sold\s*out|not\s+(?:being\s+)?(?:taken|accepted)|no\s+more)\b/i,
    /\b(?:orders?|bookings?)\s+(?:are\s+|is\s+|now\s+|have\s+)*(?:closed?|over|full|stopped|finished)\b/i,
    /\b(?:no\s+more|not\s+taking(?:\s+any)?(?:\s+more)?|stopped\s+taking(?:\s+any)?(?:\s+more)?|stop\s+taking)\s+(?:orders?|bookings?)\b/i,
    /\b(?:we(?:'re|\s+are)\s+closed|closed\s+for\s+(?:today|the\s+day|now|lunch|dinner)|sold\s*out|all\s+(?:sold|booked)(?:\s+out)?)\b/i
  ];
  var OPEN_RES = [
    /\b(?:orders?|bookings?|counter|kitchen)\b[^.\n!]{0,30}\b(?:open(?:ed)?|re-?opened|resumed|started)\b/i,
    /\b(?:now\s+open|open\s+for\s+orders?|open\s+again|re-?open(?:ed)?|taking\s+orders|accepting\s+orders)\b/i,
    /\b(?:kindly\s+|please\s+|pls\s+)?(?:place|book|pre-?book|pre-?order|send)\b[^.\n!]{0,30}\borders?\b/i
  ];
  /* "orders will open tomorrow" is not open now */
  var NOT_YET = /\b(will|shall|tomorrow|tmrw|from\s+\d|after\s+\d|soon|later)\b[^.\n!]{0,20}\b(open|reopen|start|resume)/i;

  /* "Orders for Pav bhaji is closed", "Laddoo orders are closed": she is
     closing one dish, not the whole counter. These must not take her other
     dishes off the menu, so findCounter ignores them and findItemClosure
     reports which dish was meant. */
  var GENERIC_WORD = /^(all|the|our|these|those|today'?s?|todays|tonight'?s?|tomorrow'?s?|lunch|dinner|breakfast|snacks?|new|further|more|any|regular|daily|today|tonight|tomorrow|now|this|next|the\s+day|delivery|pre-?bookings?|pre-?orders?|bookings?|orders?|food|kitchen|counter)$/i;
  var ITEM_CLOSED = /\b(?:closed?|closing|over|full|finished|sold\s*out|ended)\b/i;
  function findItemClosure(text) {
    var t = String(text || "");
    if (!t.trim() || QUESTION.test(t)) return null;
    var out = [], m;
    function add(raw) {
      raw = String(raw || "").replace(/[^\w\s&,'\/-]/g, " ").replace(/\s+/g, " ").trim();
      /* "laddoos and gujiya", "pav bhaji, vada pav" -> separate dishes */
      raw.split(/\s*(?:,|&|\band\b|\/)\s*/i).forEach(function (w) {
        w = w.trim();
        if (w.length > 2 && !GENERIC_WORD.test(w) && out.indexOf(w.toLowerCase()) < 0) out.push(w.toLowerCase());
      });
    }
    /* "Orders for X is/are closed" */
    m = /\borders?\s+for\s+([a-z][^.\n!?]{2,50}?)\s+(?:is\s+|are\s+|has\s+|have\s+|been\s+|now\s+)*(?:closed?|over|full|finished|sold\s*out)\b/i.exec(t);
    if (m) add(m[1]);
    /* "X orders are closed" */
    m = /\b([a-z][a-z' &,\/-]{2,40}?)\s+orders?\s+(?:are\s+|is\s+|have\s+been\s+|now\s+)*(?:closed?|over|full|finished|sold\s*out)\b/i.exec(t);
    if (m) add(m[1]);
    /* "Closing X orders for tomorrow's delivery" / "Closing orders for X and Y" */
    m = /\bclosing\s+(?:the\s+)?([a-z][a-z' &,\/-]{2,40}?)\s+orders?\b/i.exec(t);
    if (m) add(m[1]);
    m = /\bclosing\s+(?:the\s+)?orders?\s+for\s+([a-z][^.\n!?]{2,50}?)(?=\s+(?:for|from|till|until|tomorrow|today)\b|[.\n!?]|$)/i.exec(t);
    if (m) add(m[1]);
    return out.length ? { state: "closed", items: out } : null;
  }

  function findCounter(text) {
    var t = String(text || "");
    if (!t.trim() || QUESTION.test(t)) return null;
    if (findItemClosure(t)) return null;
    for (var i = 0; i < CLOSED_RES.length; i++) if (CLOSED_RES[i].test(t)) return "closed";
    if (NOT_YET.test(t)) return null;
    for (var j = 0; j < OPEN_RES.length; j++) if (OPEN_RES[j].test(t)) return "open";
    return null;
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
    var orders = [], payments = [], reviews = [], menu = [], counter = [], skipped = 0;

    msgs.forEach(function (m) {
      var who = cleanName(m.sender);
      var fromAdmin = ADMINS.test(who);

      /* a chef's own post can also open or close her counter */
      if (fromAdmin && chefFor(who)) {
        var dishes = findMenu(m.text);
        var state = findCounter(m.text);
        /* a fresh menu is an invitation to order, unless the same post says otherwise */
        if (!state && dishes.length) state = "open";
        if (state) counter.push({ at: m.date, chef: chefFor(who), state: state, text: m.text.slice(0, 200) });
        if (dishes.length) {
          dishes.forEach(function (d) {
            menu.push({ at: m.date, chef: chefFor(who), name: d.name, price: d.price,
                        slot: d.slot, diet: d.diet, text: m.text.slice(0, 220) });
          });
          return;
        }
      }

      var pay = findPayment(m.text);
      if (pay && !fromAdmin) {
        /* "Sent to Mom" tells us which chef was paid */
        var toChef = null;
        var sentTo = m.text.match(/sent to\s+([A-Za-z][A-Za-z .]{1,24})/i);
        if (sentTo) toChef = chefFor(sentTo[1]);
        payments.push({
          at: m.date, who: who, amount: pay.amount, confirmed: pay.confirmed,
          toChef: toChef, text: m.text.slice(0, 200)
        });
        return;
      }
      if (fromAdmin) { skipped++; return; }

      /* praise first — "the biryani was delicious" is not an order */
      var rev = findReview(m.text);
      if (rev) {
        reviews.push({ at: m.date, who: who, rating: rev.rating, body: rev.body });
        return;
      }

      var items = findItems(m.text);
      if (items.length) {
        orders.push({
          at: m.date, who: who, items: items,
          flat: findFlat(m.text), tower: findTower(m.text),
          meal: findMeal(m.text), text: m.text.slice(0, 220)
        });
        return;
      }
      skipped++;
    });

    return { orders: orders, payments: payments, reviews: reviews, menu: menu, counter: counter,
             total: msgs.length, skipped: skipped };
  }

  return { parse: parse, parseLine: parseLine, toMessages: toMessages,
           findItems: findItems, findFlat: findFlat, findTower: findTower,
           findMeal: findMeal, findPayment: findPayment, findMenu: findMenu, findCounter: findCounter, findItemClosure: findItemClosure,
           cleanName: cleanName, chefFor: chefFor };
})();

if (typeof module !== "undefined") module.exports = WA;
