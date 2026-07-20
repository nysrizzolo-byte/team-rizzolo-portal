// Supabase Edge Function: referral-pipeline
// Look up a referral partner's pipeline across the Lead Board + Master Pipeline.
// A "referral partner" is a Contact linked via each deal's referral column
// (Master: deal_contact "Referral Source"; Lead: board_relation_mkw34hbe "Referral
// Contact"). Same Contact appears on both, and a client lives on one board at a time.
// Actions: partners (roster), pipeline (a partner's clients), setNote (Partner Update).
// Phase 1 is ADMIN-gated. Env: MONDAY_API_TOKEN, SUPABASE_URL + SUPABASE_ANON_KEY.
// DEPLOY: new fn "referral-pipeline", Verify JWT OFF (we verify userToken ourselves).

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
async function mondayGQL(query: string, variables: Record<string, unknown>) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": MONDAY_TOKEN, "API-Version": "2024-10" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error("monday: " + JSON.stringify(j.errors));
  return j.data;
}
async function verifyUser(token: string): Promise<{ email: string; id: string } | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id) return null;
    return { email: (u.email || "").toLowerCase(), id: u.id };
  } catch (_) { return null; }
}
async function profileInfo(token: string, id: string): Promise<{ role: string; contactId: string }> {
  for (const sel of ["role,referral_contact_id", "role"]) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=${sel}`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return { role: "", contactId: "" };
      return { role: p.role || "", contactId: p.referral_contact_id || "" };
    } catch (_) { /* try next */ }
  }
  return { role: "", contactId: "" };
}

type RefCfg = { board: string; refCol: string; loCol: string; dateCol: string; noteCol: string; stageMode: "status" | "group"; stageCol: string };
const BOARDS: Record<"master" | "lead", RefCfg> = {
  master: { board: "6229246816", refCol: "deal_contact", loCol: "deal_owner", dateCol: "date", noteCol: "long_text_mm526jmv", stageMode: "status", stageCol: "deal_stage" },
  lead: { board: "6229246811", refCol: "board_relation_mkw34hbe", loCol: "multiple_person_mky6cr94", dateCol: "", noteCol: "long_text_mm52p1kx", stageMode: "group", stageCol: "" },
};

function colIds(cfg: RefCfg): string {
  const ids = [cfg.refCol, cfg.loCol, cfg.noteCol];
  if (cfg.dateCol) ids.push(cfg.dateCol);
  if (cfg.stageCol) ids.push(cfg.stageCol);
  return ids.map((i) => `"${i}"`).join(",");
}
async function scanBoard(cfg: RefCfg): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = `query($c:String){ boards(ids:${cfg.board}){ items_page(limit:100, cursor:$c){ cursor items{ id name group{ title } column_values(ids:[${colIds(cfg)}]){ id text ... on BoardRelationValue { display_value linked_item_ids } ... on DateValue { date } } } } } }`;
    const d = await mondayGQL(q, { c: cursor });
    const page = d?.boards?.[0]?.items_page;
    if (!page) break;
    out.push(...(page.items || []));
    cursor = page.cursor;
  } while (cursor);
  return out;
}
// Pull a bare email address out of monday's "Label - address" text.
function pickEmail(s: unknown): string {
  const m = String(s || "").match(/[^\s,;<>()"]+@[^\s,;<>()"]+\.[A-Za-z]{2,}/);
  return m ? m[0].replace(/[.,;]+$/, "") : "";
}
function cvMap(it: any): Record<string, any> {
  const m: Record<string, any> = {};
  for (const c of (it.column_values || [])) m[c.id] = c;
  return m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const info = await profileInfo(body.userToken, user.id);

    // partners + setNote are admin-only; pipeline is admin (any partner) OR a linked
    // referral partner viewing their own.
    if (body.action === "partners") {
      if (info.role !== "admin") return json({ error: "admin only" }, 403);
      // Roster comes straight from the Contacts board (the referral-partner source of
      // truth) — id + name only. Far lighter/faster than scanning both deal boards with
      // all their columns just to collect distinct referral contacts.
      const partners: { id: string; name: string; email: string; phone: string }[] = [];
      let cursor: string | null = null;
      do {
        // monday's email column holds a LABEL + the address, and `text` glues them
        // ("John Newsom - john@x.com"). Only the address is the email of record, so take
        // the typed `email` field, falling back to pulling it out of the text.
        const q = `query($c:String){ boards(ids:6229246824){ items_page(limit:500, cursor:$c){ cursor items{ id name column_values(ids:["contact_email","contact_phone"]){ id text ... on EmailValue { email } } } } } }`;
        const d = await mondayGQL(q, { c: cursor });
        const page = d?.boards?.[0]?.items_page;
        if (!page) break;
        for (const it of (page.items || [])) {
          const col = (id: string) => (it.column_values || []).find((c: any) => c.id === id);
          const ec = col("contact_email");
          const email = String(ec?.email || pickEmail(ec?.text) || "").trim();
          partners.push({ id: String(it.id), name: it.name, email, phone: String(col("contact_phone")?.text || "").trim() });
        }
        cursor = page.cursor;
      } while (cursor);
      partners.sort((a, b) => a.name.localeCompare(b.name));
      return json({ ok: true, partners });
    }

    if (body.action === "pipeline") {
      let partnerId = "";
      if (info.role === "admin") partnerId = String(body.partnerId || "");
      else if (info.role === "partner") {
        if (!info.contactId) return json({ ok: true, rows: [], note: "not-linked" });
        partnerId = info.contactId; // a partner only ever sees their own
      } else return json({ error: "not authorized" }, 403);
      if (!partnerId) return json({ error: "partnerId required" }, 400);
      const rows: any[] = [];
      for (const key of ["master", "lead"] as const) {
        const cfg = BOARDS[key];
        for (const it of await scanBoard(cfg)) {
          const cv = cvMap(it);
          const ref = cv[cfg.refCol];
          if (!(ref?.linked_item_ids || []).map(String).includes(partnerId)) continue;
          const groupTitle = it.group?.title || "";
          const stageText = cv[cfg.stageCol]?.text || "";
          // Dead / inactive → shown collapsed at the bottom, not in the active columns.
          const dead = key === "lead"
            ? /not ready|not buying|not qualified|unresponsive|graveyard|kill|ghost|long term follow/i.test(groupTitle)
            : (/lost|dead|life support/i.test(groupTitle) || /not proceeding|suspended/i.test(stageText));
          rows.push({
            itemId: String(it.id), name: it.name, board: key,
            stage: cfg.stageMode === "group" ? groupTitle : stageText,
            lo: cv[cfg.loCol]?.text || "",
            closeDate: cfg.dateCol ? (cv[cfg.dateCol]?.date || "") : "",
            note: cv[cfg.noteCol]?.text || "",
            dead,
          });
        }
      }
      rows.sort((a, b) => (a.board === b.board ? 0 : a.board === "master" ? -1 : 1) || a.name.localeCompare(b.name));
      return json({ ok: true, partnerId, rows });
    }

    if (body.action === "setNote") {
      if (info.role !== "admin") return json({ error: "admin only" }, 403);
      const cfg = BOARDS[body.board === "lead" ? "lead" : "master"];
      const itemId = String(body.itemId || "");
      const note = String(body.note ?? "");
      if (!itemId) return json({ error: "itemId required" }, 400);
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${cfg.board}, item_id:$item, column_id:"${cfg.noteCol}", value:$val){ id } }`, { item: itemId, val: note });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
