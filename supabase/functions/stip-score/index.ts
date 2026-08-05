// Supabase Edge Function: stip-score
// Per-person LATENESS scoring off Master Pipeline subitems (tasks / docs to collect).
// Each subitem has an Owner (person), a Due Date, and a Date Fulfilled (auto-set when
// docs are marked collected). A person earns 1 late point per day a task is past due —
// counted only for the days that fall INSIDE the selected window (today / week / month /
// all). Fulfilled-late tasks stop accruing at their fulfillment date; open-overdue tasks
// accrue through today. Shared tasks give each owner the points. Tasks with NO due date
// are excluded from the score and surfaced in a separate "no due date" counter.
// Closed/Funded deals are excluded here (they get frozen into Closed Loans separately).
// Admin-only. Env: MONDAY_API_TOKEN, SUPABASE_URL + SUPABASE_ANON_KEY. Verify JWT OFF.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SNAPSHOT_SECRET = Deno.env.get("SNAPSHOT_SECRET") ?? "";
const CLOSED_STAGE = "CLOSED / FUNDED";

const MASTER = "6229246816";
const M_STAGE = "deal_stage";
const S_PERSON = "person", S_DOC = "color_mm4hnwb8", S_DUE = "date_mm4k7332", S_FULFILLED = "date_mm5xh3rv";
const DONE_DOC = ["Received / In One Drive", "Not Required"];
// Not counted in the live board: closed goes to Closed Loans; dead/suspended is noise.
const SKIP_STAGES = new Set(["CLOSED / FUNDED", "NOT PROCEEDING", "SUSPENDED"]);
const SKIP_GROUPS = new Set(["LOST / DEAD / LIFE SUPPORT", "LIMBO", "2025 FUNDINGS", "2024 FUNDINGS"]);
// "Prep" = not yet in underwriting (accepted offer + setup + working/disclosures/contracts).
// Everything else that's active (the closing-month groups) = "Active" = in underwriting.
const PREP_GROUPS = new Set(["ACCEPTED OFFER", "SETUP MILESTONE", "WORKING / DISCLOSURES / CONTRACTS"]);

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
    return u?.id ? { email: (u.email || "").toLowerCase(), id: u.id } : null;
  } catch (_) { return null; }
}
async function isAdmin(token: string, id: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=role,status`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const p = (await r.json())?.[0];
    return p?.role === "admin" && p?.status === "approved";
  } catch (_) { return false; }
}
// Whole-day number for a YYYY-MM-DD string (days since epoch, UTC).
function toDay(s: string): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.parse(s.slice(0, 10) + "T00:00:00Z");
  return isNaN(t) ? null : Math.floor(t / 86400000);
}
function names(text: string): string[] {
  return String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));

    // Cron-driven: freeze CLOSED/FUNDED deals' per-person scores into stip_closed (once).
    if (body.action === "snapshot") {
      if (!SNAPSHOT_SECRET || body.secret !== SNAPSHOT_SECRET) return json({ error: "forbidden" }, 403);
      const todayDay = Math.floor(Date.now() / 86400000);
      const IDS = `["${S_PERSON}","${S_DOC}","${S_DUE}","${S_FULFILLED}"]`;
      const captures: any[] = [];
      let cursor: string | null = null;
      do {
        const q = `query($c:String){ boards(ids:${MASTER}){ items_page(limit:60, cursor:$c){ cursor items{ id name column_values(ids:["${M_STAGE}","date"]){ id text } subitems{ id column_values(ids:${IDS}){ id text } } } } } }`;
        const d = await mondayGQL(q, { c: cursor });
        const page = d?.boards?.[0]?.items_page;
        if (!page) break;
        for (const it of (page.items || [])) {
          const cv: Record<string, string> = {};
          for (const c of (it.column_values || [])) cv[c.id] = c.text || "";
          if ((cv[M_STAGE] || "").toUpperCase().trim() !== CLOSED_STAGE) continue;
          const closeDate = (cv["date"] || "").slice(0, 10) || null;
          const per: Record<string, { late: number; completed: number; noDue: number }> = {};
          const get = (nm: string) => (per[nm] = per[nm] || { late: 0, completed: 0, noDue: 0 });
          for (const su of (it.subitems || [])) {
            const scv: Record<string, string> = {};
            for (const c of (su.column_values || [])) scv[c.id] = c.text || "";
            const owners = names(scv[S_PERSON]);
            const list = owners.length ? owners : ["Unassigned"];
            const dueDay = toDay(scv[S_DUE]);
            const fulfilledDay = toDay(scv[S_FULFILLED]);
            const done = fulfilledDay !== null || DONE_DOC.includes((scv[S_DOC] || "").trim());
            for (const nm of list) {
              const p = get(nm);
              if (done) p.completed++;
              if (dueDay === null) { if (!done) p.noDue++; continue; }
              const lateStart = dueDay + 1, endDay = fulfilledDay !== null ? fulfilledDay : todayDay;
              if (endDay >= lateStart) p.late += endDay - lateStart + 1;
            }
          }
          for (const [nm, s] of Object.entries(per)) {
            if (!s.late && !s.completed && !s.noDue) continue;
            captures.push({ deal_id: String(it.id), person: nm, deal_name: it.name, late_points: s.late, completed: s.completed, no_due: s.noDue, closed_at: closeDate });
          }
        }
        cursor = page.cursor;
      } while (cursor);
      let inserted = 0;
      if (captures.length && SB_SERVICE) {
        const r = await fetch(`${SB_URL}/rest/v1/stip_closed?on_conflict=deal_id,person`, {
          method: "POST",
          headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify(captures),
        });
        if (!r.ok) return json({ error: "insert failed: " + (await r.text()).slice(0, 200) }, 500);
        const rows = await r.json();
        inserted = Array.isArray(rows) ? rows.length : 0;
      }
      return json({ ok: true, closedDeals: [...new Set(captures.map((c) => c.deal_id))].length, rows: captures.length, inserted });
    }

    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    if (!(await isAdmin(body.userToken, user.id))) return json({ error: "admin only" }, 403);

    // Monday profile photos, mapped by name (for the avatar in the chart).
    const photoByName: Record<string, string> = {};
    try {
      const mu = await mondayGQL(`query{ users(limit:500, kind:all){ name photo_url { thumb_small } } }`, {});
      for (const u of (mu?.users || [])) { const nm = (u.name || "").trim().toLowerCase(); if (nm) photoByName[nm] = u.photo_url?.thumb_small || ""; }
    } catch (_) { /* avatars are best-effort */ }

    const window = ["today", "week", "month", "all"].includes(body.window) ? body.window : "month";
    const back = window === "today" ? 0 : window === "week" ? 6 : window === "month" ? 29 : 100000;
    const todayDay = Math.floor(Date.now() / 86400000);
    const winStart = todayDay - back;

    // Per-person tally, split by loan phase. Three task buckets per person:
    //   lateOpen = still-open & overdue (gap = today - due)
    //   lateDone = fulfilled but late  (gap = fulfilled - due)
    //   noDue    = open tasks with no due date (count)
    type Agg = { name: string; lateOpen: number; lateDone: number; onTime: number; noDue: number; completed: number; deals: Set<string> };
    const phases: Record<"active" | "prep", Record<string, Agg>> = { active: {}, prep: {} };
    const getP = (ph: "active" | "prep", nm: string) => (phases[ph][nm] = phases[ph][nm] || { name: nm, lateOpen: 0, lateDone: 0, onTime: 0, noDue: 0, completed: 0, deals: new Set() });

    const IDS = `["${S_PERSON}","${S_DOC}","${S_DUE}","${S_FULFILLED}"]`;
    let cursor: string | null = null;
    do {
      const q = `query($c:String){ boards(ids:${MASTER}){ items_page(limit:60, cursor:$c){ cursor items{ id name group{ title } column_values(ids:["${M_STAGE}"]){ text } subitems{ id column_values(ids:${IDS}){ id text } } } } } }`;
      const d = await mondayGQL(q, { c: cursor });
      const page = d?.boards?.[0]?.items_page;
      if (!page) break;
      for (const it of (page.items || [])) {
        const stage = (it.column_values?.[0]?.text || "").toUpperCase().trim();
        const group = (it.group?.title || "").toUpperCase().trim();
        if (SKIP_STAGES.has(stage) || SKIP_GROUPS.has(group)) continue;
        const ph: "active" | "prep" = PREP_GROUPS.has(group) ? "prep" : "active";
        for (const su of (it.subitems || [])) {
          const cv: Record<string, string> = {};
          for (const c of (su.column_values || [])) cv[c.id] = c.text || "";
          const owners = names(cv[S_PERSON]).length ? names(cv[S_PERSON]) : ["Unassigned"];
          const dueDay = toDay(cv[S_DUE]);
          const fulfilledDay = toDay(cv[S_FULFILLED]);
          const done = fulfilledDay !== null || DONE_DOC.includes((cv[S_DOC] || "").trim());
          for (const nm of owners) {
            const p = getP(ph, nm);
            p.deals.add(it.id);
            if (done) p.completed++;
            if (dueDay === null) { if (!done) p.noDue++; continue; }
            if (window === "today") {
              if (fulfilledDay !== null) continue;            // Today = overdue right now
              const g = todayDay - dueDay; if (g > 0) p.lateOpen += g;
            } else {
              if (dueDay < winStart) continue;                // due before this window
              if (fulfilledDay !== null) { const g = fulfilledDay - dueDay; if (g > 0) p.lateDone += g; else p.onTime++; }
              else { const g = todayDay - dueDay; if (g > 0) p.lateOpen += g; }
            }
          }
        }
      }
      cursor = page.cursor;
    } while (cursor);

    const mkRows = (obj: Record<string, Agg>) => Object.values(obj)
      .map((p) => ({ name: p.name, photo: photoByName[p.name.trim().toLowerCase()] || "", lateOpen: p.lateOpen, lateDone: p.lateDone, onTime: p.onTime, noDue: p.noDue, completed: p.completed, deals: p.deals.size }))
      .filter((p) => p.lateOpen || p.lateDone || p.onTime || p.noDue || p.completed)
      .sort((a, b) => (b.lateOpen + b.lateDone) - (a.lateOpen + a.lateDone) || b.noDue - a.noDue || a.name.localeCompare(b.name));
    const active = mkRows(phases.active);
    const prep = mkRows(phases.prep);
    const totals = [...active, ...prep].reduce((t, p) => ({ lateOpen: t.lateOpen + p.lateOpen, lateDone: t.lateDone + p.lateDone, onTime: t.onTime + p.onTime, noDue: t.noDue + p.noDue }), { lateOpen: 0, lateDone: 0, onTime: 0, noDue: 0 });

    // Frozen Closed-Loans history (per person, all their closed deals).
    let closed: any[] = [];
    try {
      const r = await fetch(`${SB_URL}/rest/v1/stip_closed?select=person,late_points,completed,no_due,deal_id`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } });
      if (r.ok) {
        const agg: Record<string, { name: string; late: number; completed: number; noDue: number; deals: Set<string> }> = {};
        for (const rec of (await r.json())) {
          const a = agg[rec.person] = agg[rec.person] || { name: rec.person, late: 0, completed: 0, noDue: 0, deals: new Set() };
          a.late += rec.late_points || 0; a.completed += rec.completed || 0; a.noDue += rec.no_due || 0; a.deals.add(rec.deal_id);
        }
        closed = Object.values(agg)
          .map((a) => ({ name: a.name, photo: photoByName[a.name.trim().toLowerCase()] || "", late: a.late, completed: a.completed, noDue: a.noDue, deals: a.deals.size }))
          .sort((x, y) => y.late - x.late || y.deals - x.deals);
      }
    } catch (_) { /* closed history best-effort */ }

    return json({ ok: true, window, active, prep, totals, closed, generatedAt: new Date().toISOString() });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
