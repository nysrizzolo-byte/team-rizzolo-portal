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

const MASTER = "6229246816";
const M_STAGE = "deal_stage";
const S_PERSON = "person", S_DOC = "color_mm4hnwb8", S_DUE = "date_mm4k7332", S_FULFILLED = "date_mm5xh3rv";
const DONE_DOC = ["Received / In One Drive", "Not Required"];
// Not counted in the live board: closed goes to Closed Loans; dead/suspended is noise.
const SKIP_STAGES = new Set(["CLOSED / FUNDED", "NOT PROCEEDING", "SUSPENDED"]);
const SKIP_GROUPS = new Set(["LOST / DEAD / LIFE SUPPORT", "LIMBO", "2025 FUNDINGS", "2024 FUNDINGS"]);

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
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    if (!(await isAdmin(body.userToken, user.id))) return json({ error: "admin only" }, 403);

    const window = ["today", "week", "month", "all"].includes(body.window) ? body.window : "month";
    const back = window === "today" ? 0 : window === "week" ? 6 : window === "month" ? 29 : 100000;
    const todayDay = Math.floor(Date.now() / 86400000);
    const winStart = todayDay - back;

    // Per-person tally.
    const people: Record<string, { name: string; late: number; completed: number; completedWindow: number; noDue: number; deals: Set<string> }> = {};
    const get = (nm: string) => (people[nm] = people[nm] || { name: nm, late: 0, completed: 0, completedWindow: 0, noDue: 0, deals: new Set() });

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
        for (const su of (it.subitems || [])) {
          const cv: Record<string, string> = {};
          for (const c of (su.column_values || [])) cv[c.id] = c.text || "";
          const persons = names(cv[S_PERSON]);
          const owners = persons.length ? persons : ["Unassigned"];
          const dueDay = toDay(cv[S_DUE]);
          const fulfilledDay = toDay(cv[S_FULFILLED]);
          const done = fulfilledDay !== null || DONE_DOC.includes((cv[S_DOC] || "").trim());
          for (const nm of owners) {
            const p = get(nm);
            p.deals.add(it.id);
            if (done) { p.completed++; if (fulfilledDay !== null && fulfilledDay >= winStart && fulfilledDay <= todayDay) p.completedWindow++; }
            if (dueDay === null) { if (!done) p.noDue++; continue; }
            // Late-day range [due+1 .. end], end = fulfilled (frozen) or today (still open).
            const lateStart = dueDay + 1;
            const endDay = fulfilledDay !== null ? fulfilledDay : todayDay;
            if (endDay < lateStart) continue; // on time / not late
            const ovStart = Math.max(lateStart, winStart);
            const ovEnd = Math.min(endDay, todayDay);
            const days = ovEnd - ovStart + 1;
            if (days > 0) p.late += days;
          }
        }
      }
      cursor = page.cursor;
    } while (cursor);

    const rows = Object.values(people)
      .map((p) => ({ name: p.name, late: p.late, completed: p.completed, completedWindow: p.completedWindow, noDue: p.noDue, deals: p.deals.size }))
      .filter((p) => p.late || p.completed || p.noDue)
      .sort((a, b) => b.late - a.late || b.completed - a.completed || a.name.localeCompare(b.name));

    const totals = rows.reduce((t, p) => ({ late: t.late + p.late, completed: t.completed + p.completed, noDue: t.noDue + p.noDue }), { late: 0, completed: 0, noDue: 0 });
    return json({ ok: true, window, rows, totals, generatedAt: new Date().toISOString() });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
