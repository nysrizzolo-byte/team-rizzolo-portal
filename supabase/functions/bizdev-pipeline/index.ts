// Supabase Edge Function: bizdev-pipeline
// A Business Development person sees every deal tied to them as Biz Dev — across the
// Lead Board AND Master Pipeline — as a realtor-friendly funnel plus YTD metrics.
// A deal's Biz Dev is read from each board's Biz Dev columns (a mirror that reflects
// the referral CONTACT's Biz Dev, e.g. Sandy's contact → Pete, PLUS a direct people
// column for deals assigned straight to a Biz Dev). Matched by the caller's monday name
// (linked in Accounts, same as My Conditions). Admin can view any Biz Dev.
// Actions: people (roster, admin), pipeline (funnel + metrics), profileInfo.
// DEPLOY: new fn "bizdev-pipeline", Verify JWT OFF. Env: MONDAY_API_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY.

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
async function profileInfo(token: string, id: string): Promise<{ role: string; mondayName: string }> {
  for (const sel of ["role,monday_name,first_name,last_name", "role,first_name,last_name"]) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=${sel}`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return { role: "", mondayName: "" };
      const mondayName = p.monday_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
      return { role: p.role || "", mondayName: (mondayName || "").trim() };
    } catch (_) { /* try next */ }
  }
  return { role: "", mondayName: "" };
}

// ── Board wiring ──
type Cfg = { board: string; refCol: string; bizMirror: string; bizPeople: string; loCol: string; dateCol: string; valueCol: string; stageCol: string };
const BOARDS: Record<"master" | "lead", Cfg> = {
  master: { board: "6229246816", refCol: "deal_contact", bizMirror: "lookup_mkw3g1w3", bizPeople: "multiple_person_mky8z4g3", loCol: "deal_owner", dateCol: "date", valueCol: "deal_actual_value", stageCol: "deal_stage" },
  lead: { board: "6229246811", refCol: "board_relation_mkw34hbe", bizMirror: "lookup_mkw3ayfc", bizPeople: "multiple_person_mky660ch", loCol: "multiple_person_mky6cr94", dateCol: "", valueCol: "", stageCol: "" },
};

// ── Realtor-facing funnel (order matters; top → bottom) ──
const FUNNEL = ["New Leads", "Working", "Pre-Qualified", "Pre-Approved", "In Contract", "Submitted to Underwriting", "Approved", "Clear to Close", "Closed"];
// classify returns a FUNNEL stage, or "__dead__" (lost), or "" (parked/ignore)
function classifyLead(group: string): string {
  const g = (group || "").toLowerCase();
  if (/working on/.test(g)) return "Working";
  if (/pre qualif/.test(g)) return "Pre-Qualified";
  if (/pre approv/.test(g)) return "Pre-Approved";
  if (/accepted offer|in contract/.test(g)) return "In Contract";
  if (/closed/.test(g)) return "Closed";
  if (/not ready|not buying|not qualified|unresponsive|graveyard|kill/.test(g)) return "__dead__";
  if (/ghost|long term follow/.test(g)) return ""; // parked, don't count
  return "New Leads"; // New Group, Follow Up Set, anything else fresh
}
function classifyMaster(stage: string, group: string): string {
  const g = (group || "").toLowerCase();
  if (/lost|dead|life support/.test(g)) return "__dead__";
  if (/2024 funding|2025 funding|limbo/.test(g)) return ""; // old / parked
  const s = (stage || "").toUpperCase();
  if (s === "CLOSED / FUNDED") return "Closed";
  if (s === "SUSPENDED" || s === "NOT PROCEEDING") return "__dead__";
  if (["APPROVED - NEED STIPPED", "STIPPED - COLLECTING", "WKLY TARGET - COLLECTING"].includes(s)) return "Approved";
  if (["CLEARED", "RDY FOR CLEAR / REVIEW", "SUBBED FOR CLEAR", "RDY FOR MID CLEAR", "SUBBED FOR MID CLEAR", "SCHEDULED"].includes(s)) return "Clear to Close";
  // setup + submitted are folded together so outsiders don't see internal setup steps/timing
  return "Submitted to Underwriting";
}

function cvMap(it: any): Record<string, any> {
  const m: Record<string, any> = {};
  for (const c of (it.column_values || [])) m[c.id] = c;
  return m;
}
function bizNames(cv: Record<string, any>, cfg: Cfg): string[] {
  const out = new Set<string>();
  const mirror = cv[cfg.bizMirror]?.display_value || "";
  const people = cv[cfg.bizPeople]?.text || "";
  for (const raw of [mirror, people]) {
    for (const n of String(raw).split(",")) { const t = n.trim(); if (t) out.add(t); }
  }
  return [...out];
}
async function scanBoard(cfg: Cfg): Promise<any[]> {
  const ids = [cfg.refCol, cfg.bizMirror, cfg.bizPeople, cfg.loCol];
  if (cfg.dateCol) ids.push(cfg.dateCol);
  if (cfg.valueCol) ids.push(cfg.valueCol);
  if (cfg.stageCol) ids.push(cfg.stageCol);
  const idList = ids.map((i) => `"${i}"`).join(",");
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = `query($c:String){ boards(ids:${cfg.board}){ items_page(limit:100, cursor:$c){ cursor items{ id name group{ title } column_values(ids:[${idList}]){ id text ... on MirrorValue { display_value } ... on BoardRelationValue { display_value linked_item_ids } ... on DateValue { date } } } } } }`;
    const d = await mondayGQL(q, { c: cursor });
    const page = d?.boards?.[0]?.items_page;
    if (!page) break;
    out.push(...(page.items || []));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const info = await profileInfo(body.userToken, user.id);
    const isAdmin = info.role === "admin";

    // Roster of distinct Biz Dev names (admin only) — for the "view as" dropdown.
    if (body.action === "people") {
      if (!isAdmin) return json({ error: "admin only" }, 403);
      const names = new Set<string>();
      for (const key of ["master", "lead"] as const) {
        for (const it of await scanBoard(BOARDS[key])) for (const n of bizNames(cvMap(it), BOARDS[key])) names.add(n);
      }
      return json({ ok: true, people: [...names].sort((a, b) => a.localeCompare(b)) });
    }

    // Whose pipeline? Admin may pass bizDev; everyone else is themselves.
    const who = (isAdmin && body.bizDev ? String(body.bizDev) : info.mondayName).trim();
    if (!who) return json({ ok: true, bizDev: "", note: "not-linked", funnel: [], metrics: null });
    const whoLc = who.toLowerCase();

    const stages: Record<string, any[]> = {};
    for (const s of FUNNEL) stages[s] = [];
    let closed = 0, closedVol = 0, lost = 0, inProgress = 0;

    for (const key of ["master", "lead"] as const) {
      const cfg = BOARDS[key];
      for (const it of await scanBoard(cfg)) {
        const cv = cvMap(it);
        if (!bizNames(cv, cfg).some((n) => n.toLowerCase() === whoLc)) continue;
        const groupTitle = it.group?.title || "";
        const stageText = cfg.stageCol ? (cv[cfg.stageCol]?.text || "") : "";
        const bucket = key === "lead" ? classifyLead(groupTitle) : classifyMaster(stageText, groupTitle);
        if (bucket === "") continue;          // parked — ignore
        if (bucket === "__dead__") { lost++; continue; }
        const val = cfg.valueCol ? Number((cv[cfg.valueCol]?.text || "0").replace(/[^0-9.]/g, "")) || 0 : 0;
        if (bucket === "Closed") { closed++; closedVol += val; }
        else inProgress++;
        stages[bucket].push({
          name: it.name,
          board: key,
          lo: cv[cfg.loCol]?.text || "",
          closeDate: cfg.dateCol ? (cv[cfg.dateCol]?.date || "") : "",
          value: val,
        });
      }
    }

    const total = closed + lost + inProgress;
    const funnel = FUNNEL.map((s) => ({ stage: s, count: stages[s].length, deals: stages[s].sort((a, b) => a.name.localeCompare(b.name)) }));
    const metrics = {
      referred: total,
      closed,
      closedVolume: closedVol,
      lost,
      inProgress,
      pullThrough: total ? Math.round((closed / total) * 1000) / 10 : 0,
    };
    return json({ ok: true, bizDev: who, matchedBy: isAdmin && body.bizDev ? "admin" : "self", funnel, metrics });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
