// Supabase Edge Function: my-stips
// The LO self-service view — "show me MY outstanding conditions." Identity is
// derived server-side from the caller's Supabase access token (userToken), so a
// user can only ever see their own stips. We map their login email (fallback:
// their profile name) to a monday user, then return that person's open/upcoming/
// in-review conditions on the Master Pipeline SUBITEMS board, grouped by deal.
//
// Secrets/env: MONDAY_API_TOKEN (set), SUPABASE_URL + SUPABASE_ANON_KEY (auto).
// DEPLOY: new function "my-stips", Verify JWT OFF (we verify userToken ourselves).

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUBITEMS_BOARD = "6229246873";
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

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

function categoryFor(groupTitle: string): "active" | "setup" | null {
  const t = (groupTitle || "").toUpperCase().trim();
  if (t === "SETUP MILESTONE" || t.startsWith("WORKING / DISCLOSURES")) return "setup";
  const m = t.match(/^([A-Z]+)\s+\d{4}$/);
  if (m && MONTHS.includes(m[1])) return "active";
  return null;
}
function bucketFor(docStatus: string): "completed" | "review" | "open" | "other" {
  const s = (docStatus || "").toLowerCase();
  if (s.includes("received") || s.includes("not required")) return "completed";
  if (s.includes("need reviewed")) return "review";
  if (s.includes("requested")) return "open";
  return "other";
}

// Verify the caller's Supabase access token -> { email, id } or null.
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
// Read the caller's own profile (RLS lets a user read their own row). Resilient to
// the monday_name column not existing yet (falls back to a select without it).
async function getProfile(token: string, id: string): Promise<{ name: string; role: string; mondayName: string }> {
  const base = `${SB_URL}/rest/v1/profiles?id=eq.${id}&select=`;
  for (const sel of ["first_name,last_name,role,monday_name", "first_name,last_name,role"]) {
    try {
      const r = await fetch(base + sel, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return { name: "", role: "", mondayName: "" };
      return { name: `${p.first_name || ""} ${p.last_name || ""}`.trim(), role: p.role || "", mondayName: p.monday_name || "" };
    } catch (_) { /* try next */ }
  }
  return { name: "", role: "", mondayName: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const prof = await getProfile(body.userToken, user.id);

    // Admin-only: return the monday roster for the account-linking picker.
    if (body.action === "people") {
      if (prof.role !== "admin") return json({ error: "admin only" }, 403);
      const mu = await mondayGQL(`query{ users(limit:500){ name email } }`, {});
      const people = (mu?.users || [])
        .map((u: any) => ({ name: u.name || "", email: u.email || "" }))
        .filter((u: any) => u.name)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      return json({ ok: true, people });
    }

    // Resolve the person whose conditions to show. Admins may pass viewOwner to
    // view any team member; everyone else resolves to themselves (link/email/name).
    let ownerName = ""; let matchedBy: "linked" | "email" | "name" | "admin" | null = null;
    if (body.viewOwner && prof.role === "admin") {
      ownerName = String(body.viewOwner); matchedBy = "admin";
    } else {
      if (prof.mondayName) { ownerName = prof.mondayName; matchedBy = "linked"; }
      if (!ownerName) {
        const mu = await mondayGQL(`query{ users(limit:500){ name email } }`, {});
        const users: { name: string; email: string }[] = (mu?.users || []).map((u: any) => ({ name: u.name || "", email: (u.email || "").toLowerCase() }));
        const byEmail = users.find((u) => u.email && u.email === user.email);
        if (byEmail) { ownerName = byEmail.name; matchedBy = "email"; }
        if (!ownerName && prof.name) {
          const full = prof.name.toLowerCase();
          const byName = users.find((u) => u.name.toLowerCase() === full);
          if (byName) { ownerName = byName.name; matchedBy = "name"; }
        }
      }
    }
    if (!ownerName) {
      return json({ ok: true, ownerName: null, matchedBy: null, generatedAt: new Date().toISOString(), counts: { needed: 0, upcoming: 0, review: 0, total: 0 }, deals: [], note: "We couldn't match your login to a monday user." });
    }

    // Fetch all subitems (paginated), keep this person's non-completed conditions.
    const items: any[] = [];
    let cursor: string | null = null;
    do {
      const q = `query($c:String){ boards(ids:${SUBITEMS_BOARD}){ items_page(limit:500, cursor:$c){ cursor items{ id name parent_item{ id name group{ title } column_values(ids:["deal_stage"]){ id text } } column_values(ids:["person","color_mm4hnwb8","date0"]){ id text ... on DateValue { date } } } } } }`;
      const d = await mondayGQL(q, { c: cursor });
      const page = d?.boards?.[0]?.items_page;
      if (!page) break;
      items.push(...(page.items || []));
      cursor = page.cursor;
    } while (cursor);

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const target = ownerName.toLowerCase();

    type Stip = { name: string; status: string; statusKey: string; docStatus: string; date: string; isUpcoming: boolean };
    const dealsMap: Record<string, { deal: string; group: string; category: string; stage: string; needed: number; stips: Stip[] }> = {};
    const counts = { needed: 0, upcoming: 0, review: 0, total: 0 };

    for (const it of items) {
      const cat = categoryFor(it?.parent_item?.group?.title || "");
      if (!cat) continue;
      const cv: Record<string, any> = {};
      for (const c of (it.column_values || [])) cv[c.id] = c;
      const owners = (cv.person?.text || "").split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      if (!owners.includes(target)) continue;
      const docStatus = cv.color_mm4hnwb8?.text || "";
      const bucket = bucketFor(docStatus);
      if (bucket === "completed" || bucket === "other") continue; // only what's still on their plate
      const dateStr = cv.date0?.date || "";
      const isUpcoming = dateStr ? (new Date(dateStr + "T00:00:00Z").getTime() > today.getTime()) : false;

      let statusKey = "needed", status = "Needed";
      if (bucket === "review") { statusKey = "review"; status = "In review"; counts.review++; }
      else if (isUpcoming) { statusKey = "upcoming"; status = dateStr ? `Available ${dateStr}` : "Upcoming"; counts.upcoming++; }
      else { statusKey = "needed"; status = "Needed now"; counts.needed++; }
      counts.total++;

      const dealId = String(it?.parent_item?.id || it?.parent_item?.name || "?");
      const grp = it?.parent_item?.group?.title || "";
      const stage = ((it?.parent_item?.column_values || []).find((c: any) => c.id === "deal_stage")?.text) || "";
      if (!dealsMap[dealId]) dealsMap[dealId] = { deal: it?.parent_item?.name || "(deal)", group: grp, category: cat, stage, needed: 0, stips: [] };
      dealsMap[dealId].stips.push({ name: it.name, status, statusKey, docStatus, date: dateStr, isUpcoming });
      if (statusKey === "needed") dealsMap[dealId].needed++;
    }

    const order: Record<string, number> = { needed: 0, upcoming: 1, review: 2 };
    // Deal priority: Setup first, then "weekly target" stage, then current month, then the rest.
    const nowMY = new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "long", year: "numeric" }).toUpperCase(); // e.g. "JULY 2026"
    const dealRank = (d: { category: string; stage: string; group: string }) => {
      if (d.category === "setup") return 0;
      const st = (d.stage || "").toUpperCase();
      if (st.includes("WKLY TARGET") || st.includes("WEEKLY TARGET")) return 1;
      if ((d.group || "").toUpperCase() === nowMY) return 2;
      return 3;
    };
    const deals = Object.values(dealsMap)
      .map((d) => ({ ...d, stips: d.stips.sort((a, b) => order[a.statusKey] - order[b.statusKey] || a.name.localeCompare(b.name)) }))
      .sort((a, b) => dealRank(a) - dealRank(b) || b.needed - a.needed || a.deal.localeCompare(b.deal));

    return json({ ok: true, ownerName, matchedBy, generatedAt: new Date().toISOString(), counts, deals });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
