/* ============================================================
   SRN Kitchen listener — settings
   Everything you'd want to change lives here.
   ============================================================ */

module.exports = {
  /* Which groups to listen to.
     Match by the group's exact name as it appears in WhatsApp.
     Add as many as you like — one line each.

     Each group can name the chef its orders belong to when the chat
     itself doesn't say. Use null to fall back to DEFAULT_CHEF. */
  GROUPS: [
    { name: "SRN Kitchen", defaultChef: null }
    // { name: "SRN Kitchen — Olive",   defaultChef: "shobha" },
    // { name: "SRN Kitchen — Sumadhura", defaultChef: "ramya" },
  ],

  /* Used when nothing else identifies the chef. */
  DEFAULT_CHEF: "neha",

  /* How the chefs appear in the chats, so their own messages are read as
     menus and announcements rather than customer orders.
     "Mom" is how Neha shows up in the SRN Kitchen group. */
  CHEF_CHAT_NAMES: {
    mom: "neha",
    neha: "neha",
    shobha: "shobha",
    ramya: "ramya"
  },

  /* Supabase. The publishable key belongs in client code — the row level
     security rules in schema.sql are what protect the data. Never put a
     secret or service_role key here. */
  SUPABASE_URL: process.env.SUPABASE_URL || "https://xaawulloreqdfpbzcket.supabase.co",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "sb_publishable_q5-8XsV_3jJ7RK2hTlYPLA_lUb74S1T",

  /* Lets the listener open and close a chef's counter when she posts
     "orders closed". It is a password: keep it in the environment, never in
     this file or in git. Without it the listener still files orders, but only
     logs what it would have done about the counter. */
  SYNC_SECRET: process.env.SRN_SYNC_SECRET || "",

  /* Where the WhatsApp session is kept, so it doesn't ask for the QR code
     every restart. Back this folder up and it survives a redeploy. */
  AUTH_DIR: process.env.AUTH_DIR || "./auth",

  /* Message ids already handled, so a reconnect doesn't re-import. */
  SEEN_FILE: process.env.SEEN_FILE || "./seen.json",

  /* An order older than this is ignored on startup, so reconnecting after a
     few days down doesn't suddenly import a week of history. Hours. */
  MAX_AGE_HOURS: 12,

  /* Write to the database, or just print what it would have done.
     Start with DRY_RUN=1 for the first evening and read the log. */
  DRY_RUN: process.env.DRY_RUN === "1"
};
