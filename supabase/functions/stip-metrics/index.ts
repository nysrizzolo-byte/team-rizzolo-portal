// Supabase Edge Function: stip-metrics
// Reads the Master Pipeline subitems (the "stips" / conditions, board 6229246873) and
// computes per-person metrics, split into ACTIVE deals (month-named groups) vs SETUP
// loans (Setup Milestone + Working/Disclosures). Admin-only in the UI.
//
// Doc Status (color_mm4hnwb8): Received/In One Drive + Not Required = COMPLETED;
// Need Reviewed = PENDING REVIEW; Requested + Not Requested = OPEN; Can't Obtain = ignored.
// Date (date0): a future date = UPCOMING (not counted as outstanding).
//
// Secret: MONDAY_API_TOKEN. DEPLOY: new function "stip-metrics", Verify JWT OFF.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
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
  return null; // Limbo, FUNDINGS, LOST/DEAD -> ignore
}
function bucketFor(docStatus: string): "completed" | "review" | "open" | "other" {
  const s = (docStatus || "").toLowerCase();
  if (s.includes("received") || s.includes("not required")) return "completed";
  if (s.includes("need reviewed")) return "review";
  if (s.includes("requested")) return "open"; // "Requested" + "Not Requested"
  return "other"; // Can't Obtain / Doesn't Exist, or blank
}

type Row = { name: string; outstanding: number; upcoming: number; review: number; completed: number; doneWeek: number };
function ensure(map: Record<string, Row>, name: string): Row {
  if (!map[name]) map[name] = { name, outstanding: 0, upcoming: 0, review: 0, completed: 0, doneWeek: 0 };
  return map[name];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);

    // Fetch all subitems (paginated)
    const items: any[] = [];
    let cursor: string | null = null;
    do {
      const q = `query($c:String){ boards(ids:${SUBITEMS_BOARD}){ items_page(limit:500, cursor:$c){ cursor items{ id name updated_at parent_item{ name group{ title } } column_values(ids:["person","color_mm4hnwb8","date0"]){ id text ... on DateValue { date } } } } } }`;
      const d = await mondayGQL(q, { c: cursor });
      const page = d?.boards?.[0]?.items_page;
      if (!page) break;
      items.push(...(page.items || []));
      cursor = page.cursor;
    } while (cursor);

    // Time boundaries
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = now.getUTCDay(); // 0 Sun
    const backToMonday = dow === 0 ? 6 : dow - 1;
    const weekStart = new Date(today); weekStart.setUTCDate(today.getUTCDate() - backToMonday);

    const cats: Record<"active" | "setup", Record<string, Row>> = { active: {}, setup: {} };
    const pendingReview: { stip: string; deal: string; owners: string; category: string }[] = [];

    for (const it of items) {
      const cat = categoryFor(it?.parent_item?.group?.title || "");
      if (!cat) continue;
      const cv: Record<string, any> = {};
      for (const c of (it.column_values || [])) cv[c.id] = c;
      const ownersText: string = cv.person?.text || "";
      const owners = ownersText.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (!owners.length) owners.push("(unassigned)");
      const bucket = bucketFor(cv.color_mm4hnwb8?.text || "");
      const dateStr = cv.date0?.date || "";
      const isUpcoming = dateStr ? (new Date(dateStr + "T00:00:00Z").getTime() > today.getTime()) : false;
      const doneThisWeek = it.updated_at ? (new Date(it.updated_at).getTime() >= weekStart.getTime()) : false;

      if (bucket === "review") {
        pendingReview.push({ stip: it.name, deal: it?.parent_item?.name || "", owners: ownersText || "(unassigned)", category: cat });
      }
      for (const owner of owners) {
        const r = ensure(cats[cat], owner);
        if (bucket === "completed") { r.completed++; if (doneThisWeek) r.doneWeek++; }
        else if (bucket === "review") r.review++;
        else if (bucket === "open") { if (isUpcoming) r.upcoming++; else r.outstanding++; }
      }
    }

    const shape = (map: Record<string, Row>) => Object.values(map)
      .map(r => ({ ...r, closeoutPct: (r.completed + r.outstanding) ? Math.round(r.completed / (r.completed + r.outstanding) * 100) : null }))
      .sort((a, b) => b.outstanding - a.outstanding || b.completed - a.completed);

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      weekStart: weekStart.toISOString().slice(0, 10),
      active: shape(cats.active),
      setup: shape(cats.setup),
      pendingReview,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
