// Supabase Edge Function: Telegram ping when the other person changes the shared shortlist.
//
// Wired up by a Database Webhook on public.shortlist (INSERT, UPDATE) → this function.
// Secrets (Edge Function secrets, never in the repo):
//   TELEGRAM_BOT_TOKEN   the House Hunt bot token
//   TELEGRAM_CHAT_ID     one or more chat ids, comma-separated (private chats and/or the group)
//   HOOK_SECRET          optional but recommended: the webhook must send the same value in an
//                        "x-hook-secret" header (Database → Webhooks → HTTP headers); with "Verify JWT"
//                        off, this is what stops anyone on the internet from pinging your chats.
//   LISTINGS_URL         optional; default: the report repo's properties.json on raw.githubusercontent.com
//
// Only meaningful changes ping: favorite on/off, hidden on/off, a new or cleared note.
// Compare-set changes and no-op upserts stay quiet. The site writes one row per copy of a flat
// (re-posts, other sites) in one go; those rows share updated_by + updated_at, so only the first pings.
const SITE = "https://mkalandadze1998-max.github.io/house-hunt-report/";
const RAW = "https://raw.githubusercontent.com/mkalandadze1998-max/house-hunt-report";
const SOURCES = [`${RAW}/main/data/properties.json`, `${RAW}/geo-data/data/ss.json`, `${RAW}/geo-data/data/korter.json`];

let cache: { at: number; map: Map<string, any> } | null = null;
async function listing(id: string) {
  if (!cache || Date.now() - cache.at > 10 * 60 * 1000) {
    const map = new Map<string, any>();
    for (const url of SOURCES) {
      try {
        const j = await (await fetch(url)).json();
        for (const p of j.properties ?? []) map.set(String(p.id), p);
      } catch (_) { /* source unavailable */ }
    }
    cache = { at: Date.now(), map };
  }
  return cache.map.get(id) ?? null;
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => Number(n).toLocaleString("en-US");
// one ping per batch: rows written together carry the same author + timestamp (kept for a few minutes)
const recent = new Map<string, number>();
function seenBefore(key: string) {
  const now = Date.now();
  for (const [k, at] of recent) if (now - at > 5 * 60 * 1000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("HOOK_SECRET");
  if (secret && req.headers.get("x-hook-secret") !== secret) return new Response("forbidden", { status: 401 });
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chats = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").split(/[,\s]+/).filter(Boolean);
  if (!token || !chats.length) return new Response("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set", { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const rec = body.record ?? {}, old = body.old_record ?? {};
  const id = String(rec.listing_id ?? "");
  if (!id) return new Response("no listing_id", { status: 200 });

  let what: string | null = null;
  if (!!rec.favorite !== !!old.favorite) what = rec.favorite ? "saved" : "unsaved";
  else if (!!rec.hidden !== !!old.hidden) what = rec.hidden ? "hid" : "restored";
  else if ((rec.note ?? "") !== (old.note ?? "")) what = rec.note ? "left a note on" : "cleared the note on";
  if (!what) return new Response("no-op", { status: 200 });
  const who = esc(String(rec.updated_by || "Someone").slice(0, 40));
  if (seenBefore(`${who}|${what}|${rec.updated_at ?? ""}|${rec.note ?? ""}`)) return new Response("duplicate of a batch write", { status: 200 });

  const p = await listing(id);
  const title = p ? `${esc(p.neighborhood || p.district)} · ${money(p.price)} ₾ · ${p.size} m²` : `listing ${esc(id)}`;
  const link = `${SITE}#listing-${encodeURIComponent(id)}`;
  const lines = [`${what === "saved" ? "♥" : what === "hid" ? "🚫" : what.includes("note") ? "📝" : "↩"} <b>${who}</b> ${what} <a href="${link}">${title}</a>`];
  if (what.startsWith("left") && rec.note) lines.push(`<i>${esc(String(rec.note).slice(0, 300))}</i>`);
  if (p?.url && /^https:\/\//.test(String(p.url))) lines.push(`<a href="${esc(p.url)}">original listing ↗</a>`);
  const text = lines.join("\n");

  let sent = 0;
  for (const chat_id of chats) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (r.ok) sent++;
  }
  return new Response(`sent ${sent}/${chats.length}`, { status: 200 });
});
