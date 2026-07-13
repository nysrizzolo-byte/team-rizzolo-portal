// Supabase Edge Function: lead-intake
// Powers the "Take an Application" lead bar. Two actions:
//   search {q}  → find existing leads on the Lead Board by name (for "link existing lead").
//   create {..} → add a NEW lead, assigned to the logged-in LO (unassigned people → Carol).
// Uses the portal's MONDAY_API_TOKEN so NO team member needs a monday login.
// Auth: Verify JWT OFF; we verify the caller's Supabase token ourselves (approved users only).
// Env: MONDAY_API_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const LEAD_BOARD = "6229246811";
const NEW_GROUP = "new_group";                 // "Working On"
const COL_PHONE = "lead_phone";
const COL_EMAIL = "lead_email";
const COL_LO = "multiple_person_mky6cr94";     // L/O (Owner)
const COL_REF = "board_relation_mkw34hbe";     // Referral Contact

// Master Pipeline (main deals board) — for the My Work "Priority" section.
const MASTER_BOARD = "6229246816";
const M_PRIORITY = "numeric_mm3q3egw";         // "Priority" (numbers; Sal orders 1, 2, 3…)
const M_STAGE = "deal_stage";
const M_LOAN = "loan_number";
// The three "owner" people columns — a priority deal shows for anyone in any of them.
const M_PEOPLE: [string, string][] = [["deal_owner", "LO"], ["multiple_person_mkrzxq2c", "LOA"], ["multiple_person_mm4mbf80", "Junior"]];

// LOs who have their own lead form → a new lead they take is assigned to them.
const LO_MAP: Record<string, number> = {
  "sal rizzolo": 35039487, "felix diaz": 102022029, "elvis regis": 100465331,
  "theresa feehan": 38548733, "matthew porcaro": 49924676, "richard luxmore": 74046070,
  "nicholas lisi": 87449263,
};
const CAROL = 35040324; // Carolina Lopez — the unassigned fallback

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
async function verifyUser(token: string): Promise<{ id: string } | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id } : null;
  } catch (_) { return null; }
}
async function mondayName(token: string, id: string): Promise<string> {
  for (const sel of ["monday_name,first_name,last_name", "first_name,last_name"]) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=${sel}`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return "";
      return (p.monday_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "").trim();
    } catch (_) { /* next */ }
  }
  return "";
}
const cv = (it: any, id: string) => (it.column_values || []).find((c: any) => c.id === id)?.text || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);

    // ── Search existing leads by name ──
    if (body.action === "search") {
      const q = String(body.q || "").trim();
      if (q.length < 2) return json({ ok: true, leads: [] });
      const safe = q.replace(/[\\"]/g, "");
      const query = `query { boards(ids:${LEAD_BOARD}){ items_page(limit:8, query_params:{rules:[{column_id:"name", compare_value:"${safe}", operator:contains_text}]}){ items{ id name group{ title } column_values(ids:["${COL_PHONE}","${COL_EMAIL}","${COL_LO}","${COL_REF}"]){ id text } } } } }`;
      const d = await mondayGQL(query, {});
      const items = d?.boards?.[0]?.items_page?.items || [];
      const leads = items.map((it: any) => ({
        id: String(it.id), name: it.name, stage: it.group?.title || "",
        phone: cv(it, COL_PHONE), email: cv(it, COL_EMAIL),
        lo: cv(it, COL_LO), referral: cv(it, COL_REF),
      }));
      return json({ ok: true, leads });
    }

    // ── My leads: the caller's own leads still in "Working On" ──
    if (body.action === "myleads") {
      const who = (await mondayName(body.userToken, user.id)).trim();
      if (!who) return json({ ok: true, leads: [], note: "not-linked" });
      const target = who.toLowerCase();
      const query = `query { boards(ids:${LEAD_BOARD}){ groups(ids:["${NEW_GROUP}"]){ items_page(limit:250){ items{ id name created_at column_values(ids:["${COL_PHONE}","${COL_EMAIL}","${COL_LO}","${COL_REF}"]){ id text } } } } } }`;
      const d = await mondayGQL(query, {});
      const raw = d?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
      const leads = raw
        .filter((it: any) => (cv(it, COL_LO) || "").toLowerCase().split(",").map((s: string) => s.trim()).includes(target))
        .map((it: any) => ({
          id: String(it.id), name: it.name, created: it.created_at || "",
          phone: cv(it, COL_PHONE), email: cv(it, COL_EMAIL), referral: cv(it, COL_REF),
        }))
        .sort((a: any, b: any) => (b.created || "").localeCompare(a.created || ""));
      return json({ ok: true, leads, owner: who });
    }

    // ── Priority deals: Master Pipeline items with a Priority number, where the
    //    caller is on the LO / LOA / Junior column. Ordered by that number (1,2,3…). ──
    if (body.action === "priority") {
      const who = (await mondayName(body.userToken, user.id)).trim();
      if (!who) return json({ ok: true, items: [], note: "not-linked" });
      const target = who.toLowerCase();
      const colIds = [M_PRIORITY, M_STAGE, M_LOAN, ...M_PEOPLE.map(([c]) => c)].map((c) => `"${c}"`).join(",");
      const all: any[] = [];
      let cursor: string | null = null, pages = 0;
      do {
        const q = `query($c:String){ boards(ids:${MASTER_BOARD}){ items_page(limit:500, cursor:$c){ cursor items{ id name column_values(ids:[${colIds}]){ id text } } } } }`;
        const d = await mondayGQL(q, { c: cursor });
        const page = d?.boards?.[0]?.items_page;
        if (!page) break;
        all.push(...(page.items || []));
        cursor = page.cursor;
      } while (cursor && ++pages < 8);
      const onItem = (it: any, col: string) => (cv(it, col) || "").toLowerCase().split(",").map((s: string) => s.trim()).includes(target);
      // Drop finished/dead deals — priority is about what's still active.
      const TERMINAL = new Set(["closed / funded", "not proceeding"]);
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const items = all
        .map((it: any) => {
          const ptext = cv(it, M_PRIORITY);
          const prio = ptext === "" ? NaN : Number(ptext);
          const role = M_PEOPLE.find(([c]) => onItem(it, c))?.[1] || "";
          return { it, prio, role, stage: cv(it, M_STAGE) };
        })
        .filter((x) => !isNaN(x.prio) && x.role && !TERMINAL.has(norm(x.stage)))
        .sort((a, b) => a.prio - b.prio)
        .map((x) => ({ id: String(x.it.id), name: x.it.name, priority: x.prio, stage: x.stage, loan: cv(x.it, M_LOAN), role: x.role }));
      return json({ ok: true, items, owner: who });
    }

    // ── Create a new lead ──
    if (body.action === "create") {
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "borrower name required" }, 400);
      const who = (await mondayName(body.userToken, user.id)).toLowerCase();
      const ownerId = LO_MAP[who] || CAROL;
      const assignedName = ownerId === CAROL ? "Carolina Lopez (unassigned)" : (who.replace(/\b\w/g, (c) => c.toUpperCase()));

      const cols: Record<string, unknown> = { [COL_LO]: { personsAndTeams: [{ id: ownerId, kind: "person" }] } };
      const phone = String(body.phone || "").trim();
      const email = String(body.email || "").trim();
      if (phone) cols[COL_PHONE] = { phone: phone.replace(/[^\d+]/g, ""), countryShortName: "US" };
      if (email) cols[COL_EMAIL] = { email, text: email };
      if (body.referralId) cols[COL_REF] = { item_ids: [Number(body.referralId)] };

      const m = `mutation($board:ID!,$group:String!,$name:String!,$cols:JSON!){ create_item(board_id:$board, group_id:$group, item_name:$name, column_values:$cols){ id } }`;
      const res = await mondayGQL(m, { board: LEAD_BOARD, group: NEW_GROUP, name, cols: JSON.stringify(cols) });
      const itemId = res?.create_item?.id;

      const note = String(body.update || "").trim();
      if (itemId && note) {
        await mondayGQL(`mutation($item:ID!,$b:String!){ create_update(item_id:$item, body:$b){ id } }`, { item: itemId, b: note });
      }
      return json({ ok: true, lead: { id: String(itemId), name, phone, email, lo: assignedName, stage: "Working On", referral: "" } });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
