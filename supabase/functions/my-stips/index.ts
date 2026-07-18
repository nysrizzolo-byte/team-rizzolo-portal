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
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

// Two condition sources behind the Master/Lead toggle.
type BoardCfg = { subitems: string; personCol: string; statusCol: string; dateCol: string; longCol: string; parentStage: boolean; useCategories: boolean; blankIsOpen: boolean; done: string[]; review: string[]; open: string[]; labels: string[] };
const BOARDS: Record<string, BoardCfg> = {
  master: {
    subitems: "6229246873", personCol: "person", statusCol: "color_mm4hnwb8", dateCol: "date0", longCol: "long_text_mm4hpxk0",
    parentStage: true, useCategories: true, blankIsOpen: false,
    done: ["Received / In One Drive", "Not Required"], review: ["Need Reviewed"], open: ["Requested", "Not Requested"],
    labels: ["Requested", "Received / In One Drive", "Can't Obtain / Doesn't Exist", "Need Reviewed", "Not Required", "Not Requested"],
  },
  lead: {
    subitems: "6272132087", personCol: "multiple_person_mm4wgnvm", statusCol: "color_mm5167b", dateCol: "date_mm50d1r9", longCol: "long_text_mm4wgwt",
    parentStage: false, useCategories: false, blankIsOpen: true,
    done: ["Obtained", "Not Needed"], review: [], open: ["Needed", "Requested"],
    labels: ["Needed", "Requested", "Obtained", "Not Needed"],
  },
};
function boardCfg(b: unknown): BoardCfg { return BOARDS[b === "lead" ? "lead" : "master"]; }

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
function bucketForCfg(status: string, cfg: BoardCfg): "completed" | "review" | "open" | "other" {
  const s = (status || "").trim();
  if (!s) return cfg.blankIsOpen ? "open" : "other";
  if (cfg.done.includes(s)) return "completed";
  if (cfg.review.includes(s)) return "review";
  if (cfg.open.includes(s)) return "open";
  return "other";
}

// Master-board subitem pulse ids whose Doc Status flipped to a "done" value (Received /
// Not Required) since `fromISO` — the real "completed this week" (mirrors stip-metrics).
async function completedSinceMaster(fromISO: string): Promise<Set<string>> {
  const set = new Set<string>();
  const doneIdx = new Set([1, 4]); // Received / In One Drive (1), Not Required (4)
  let page = 1;
  while (page <= 20) {
    const q = `query($f:ISO8601DateTime!){ boards(ids:${BOARDS.master.subitems}){ activity_logs(from:$f, column_ids:["${BOARDS.master.statusCol}"], limit:500, page:${page}){ event data } } }`;
    const d = await mondayGQL(q, { f: fromISO });
    const logs = d?.boards?.[0]?.activity_logs || [];
    for (const lg of logs) {
      let data: any; try { data = JSON.parse(lg.data); } catch (_) { continue; }
      if (lg.event === "update_column_value") {
        if (data?.value?.label?.is_done === true && data.pulse_id) set.add(String(data.pulse_id));
      } else if (lg.event === "batch_change_pulses_column_value") {
        if (doneIdx.has(data?.value?.index) && Array.isArray(data.pulse_ids)) {
          for (const pid of data.pulse_ids) set.add(String(pid));
        }
      }
    }
    if (logs.length < 500) break;
    page++;
  }
  return set;
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
async function getProfile(token: string, id: string): Promise<{ name: string; role: string; status: string; mondayName: string }> {
  const base = `${SB_URL}/rest/v1/profiles?id=eq.${id}&select=`;
  for (const sel of ["first_name,last_name,role,status,monday_name", "first_name,last_name,role,status", "first_name,last_name,role"]) {
    try {
      const r = await fetch(base + sel, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return { name: "", role: "", status: "", mondayName: "" };
      return { name: `${p.first_name || ""} ${p.last_name || ""}`.trim(), role: p.role || "", status: p.status || "", mondayName: p.monday_name || "" };
    } catch (_) { /* try next */ }
  }
  return { name: "", role: "", status: "", mondayName: "" };
}
// Resolve the caller to their monday display name: explicit link -> email -> profile name.
async function resolveSelf(user: { email: string }, prof: { name: string; mondayName: string }): Promise<string> {
  if (prof.mondayName) return prof.mondayName;
  const mu = await mondayGQL(`query{ users(limit:500){ name email } }`, {});
  const users: { name: string; email: string }[] = (mu?.users || []).map((u: any) => ({ name: u.name || "", email: (u.email || "").toLowerCase() }));
  const byEmail = users.find((u) => u.email && u.email === user.email);
  if (byEmail) return byEmail.name;
  if (prof.name) { const full = prof.name.toLowerCase(); const byName = users.find((u) => u.name.toLowerCase() === full); if (byName) return byName.name; }
  return "";
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const prof = await getProfile(body.userToken, user.id);
    const cfg = boardCfg(body.board); // master (default) or lead

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

    // Write-back: mark a condition's Doc Status on monday. Approved users only; a
    // non-admin can only touch conditions assigned to them.
    if (body.action === "setStatus") {
      if (prof.status !== "approved") return json({ error: "not an approved team member" }, 403);
      const subitemId = String(body.subitemId || "");
      const label = String(body.label || "");
      if (!subitemId || !cfg.labels.includes(label)) return json({ error: "bad request" }, 400);
      if (prof.role !== "admin") {
        const me = (await resolveSelf(user, prof)).toLowerCase();
        const d = await mondayGQL(`query($i:[ID!]){ items(ids:$i){ column_values(ids:["${cfg.personCol}"]){ text } } }`, { i: [subitemId] });
        const owners = ((d?.items?.[0]?.column_values?.[0]?.text) || "").split(",").map((s: string) => s.trim().toLowerCase());
        if (!me || !owners.includes(me)) return json({ error: "not your condition" }, 403);
      }
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${cfg.subitems}, item_id:$item, column_id:"${cfg.statusCol}", value:$val){ id } }`, { item: subitemId, val: label });
      return json({ ok: true, done: cfg.done.includes(label) });
    }

    // Write-back: save the "Condition / Task Note" (subitem Long Text). Same gate as
    // setStatus — approved users only; non-admins can only touch their own conditions.
    if (body.action === "setSubNote") {
      if (prof.status !== "approved") return json({ error: "not an approved team member" }, 403);
      const subitemId = String(body.subitemId || "");
      const note = String(body.note ?? "");
      if (!subitemId) return json({ error: "bad request" }, 400);
      if (prof.role !== "admin") {
        const me = (await resolveSelf(user, prof)).toLowerCase();
        const d = await mondayGQL(`query($i:[ID!]){ items(ids:$i){ column_values(ids:["${cfg.personCol}"]){ text } } }`, { i: [subitemId] });
        const owners = ((d?.items?.[0]?.column_values?.[0]?.text) || "").split(",").map((s: string) => s.trim().toLowerCase());
        if (!me || !owners.includes(me)) return json({ error: "not your condition" }, 403);
      }
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${cfg.subitems}, item_id:$item, column_id:"${cfg.longCol}", value:$val){ id } }`, { item: subitemId, val: note });
      return json({ ok: true });
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
      return json({ ok: true, ownerName: null, matchedBy: null, generatedAt: new Date().toISOString(), counts: { needed: 0, upcoming: 0, review: 0, total: 0, doneWeek: 0 }, deals: [], note: "We couldn't match your login to a monday user." });
    }

    // Fetch all subitems (paginated), keep this person's non-completed conditions.
    const items: any[] = [];
    let cursor: string | null = null;
    do {
      const parentStage = cfg.parentStage ? `column_values(ids:["deal_stage"]){ id text }` : "";
      const q = `query($c:String){ boards(ids:${cfg.subitems}){ items_page(limit:500, cursor:$c){ cursor items{ id name parent_item{ id name group{ title } ${parentStage} } column_values(ids:["${cfg.personCol}","${cfg.statusCol}","${cfg.dateCol}","${cfg.longCol}"]){ id text ... on DateValue { date } } } } } }`;
      const d = await mondayGQL(q, { c: cursor });
      const page = d?.boards?.[0]?.items_page;
      if (!page) break;
      items.push(...(page.items || []));
      cursor = page.cursor;
    } while (cursor);

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const target = ownerName.toLowerCase();

    // "Done this week": master-board conditions this person completed since Monday (activity log).
    // Gated behind withWeek so the My Conditions tab doesn't pay for it unless asked.
    let doneSet = new Set<string>();
    if (body.withWeek && body.board !== "lead") {
      const backToMonday = (today.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0 …
      const weekStart = new Date(today); weekStart.setUTCDate(today.getUTCDate() - backToMonday);
      try { doneSet = await completedSinceMaster(weekStart.toISOString()); } catch (_) { doneSet = new Set(); }
    }

    type Stip = { id: string; name: string; status: string; statusKey: string; docStatus: string; date: string; isUpcoming: boolean; info: string };
    const dealsMap: Record<string, { deal: string; group: string; category: string; stage: string; needed: number; stips: Stip[] }> = {};
    const counts = { needed: 0, upcoming: 0, review: 0, total: 0, doneWeek: 0 };

    for (const it of items) {
      const grp = it?.parent_item?.group?.title || "";
      let cat: string;
      if (cfg.useCategories) { const c = categoryFor(grp); if (!c) continue; cat = c; } // master: only pipeline groups
      else cat = "lead";
      const cv: Record<string, any> = {};
      for (const c of (it.column_values || [])) cv[c.id] = c;
      const owners = (cv[cfg.personCol]?.text || "").split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      if (!owners.includes(target)) continue;
      const docStatus = cv[cfg.statusCol]?.text || "";
      const bucket = bucketForCfg(docStatus, cfg);
      if (bucket === "completed") { if (doneSet.has(String(it.id))) counts.doneWeek++; continue; }
      if (bucket === "other") continue; // only what's still on their plate
      const dateStr = cv[cfg.dateCol]?.date || "";
      const isUpcoming = dateStr ? (new Date(dateStr + "T00:00:00Z").getTime() > today.getTime()) : false;

      let statusKey = "needed", status = "Needed";
      if (bucket === "review") { statusKey = "review"; status = "In review"; counts.review++; }
      else if (isUpcoming) { statusKey = "upcoming"; status = dateStr ? `Available ${dateStr}` : "Upcoming"; counts.upcoming++; }
      else { statusKey = "needed"; status = "Needed now"; counts.needed++; }
      counts.total++;

      const dealId = String(it?.parent_item?.id || it?.parent_item?.name || "?");
      const stage = ((it?.parent_item?.column_values || []).find((c: any) => c.id === "deal_stage")?.text) || "";
      if (!dealsMap[dealId]) dealsMap[dealId] = { deal: it?.parent_item?.name || "(deal)", group: grp, category: cat, stage, needed: 0, stips: [] };
      dealsMap[dealId].stips.push({ id: String(it.id), name: it.name, status, statusKey, docStatus, date: dateStr, isUpcoming, info: cv[cfg.longCol]?.text || "" });
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
    const ranked = Object.values(dealsMap)
      .map((d) => ({ ...d, stips: d.stips.sort((a, b) => order[a.statusKey] - order[b.statusKey] || a.name.localeCompare(b.name)) }))
      .sort((a, b) => cfg.useCategories
        ? (dealRank(a) - dealRank(b) || b.needed - a.needed || a.deal.localeCompare(b.deal))
        : (b.needed - a.needed || a.deal.localeCompare(b.deal))); // leads: by workload then name
    // Shape for the UI: badge = "Active deal"/"Setup" (master) or the lead's pipeline stage.
    const deals = ranked.map((d) => ({
      deal: d.deal, group: d.group, category: d.category, needed: d.needed, stips: d.stips,
      badge: cfg.useCategories ? (d.category === "active" ? "Active deal" : "Setup") : (d.group || "Lead"),
    }));

    return json({ ok: true, board: body.board === "lead" ? "lead" : "master", labels: cfg.labels, ownerName, matchedBy, generatedAt: new Date().toISOString(), counts, deals });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
