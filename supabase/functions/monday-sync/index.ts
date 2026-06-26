// Supabase Edge Function: monday-sync
// Pulls deals from the Master Pipeline board and mirrors their dates onto the
// Team Calendar (public.events). Stage "SCHEDULED" -> closing; "CLOSED / FUNDED"
// -> funded. Upserts by monday item id, refreshes moved dates, and removes
// monday-sourced events that are no longer in those stages (or fell out of the
// date window). Idempotent — safe to run on a daily cron or call by hand.
//
// Secrets: MONDAY_API_TOKEN (you add this). SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are auto-injected. DEPLOY: Edge Functions -> new function "monday-sync", Verify JWT OFF.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BOARD_ID = "6229246816";          // Master Pipeline (active)
const STAGE_COL = "deal_stage";
const DATE_COL = "date";                 // "Closing Date / OOA / Funding Date"
const ADDR_COL = "location9";            // Subject Property Address
const STAGE_SCHEDULED = 10;              // label index for "SCHEDULED"
const STAGE_FUNDED = 11;                 // label index for "CLOSED / FUNDED"
const DAYS_BACK = 45;                    // ignore fundings older than this

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

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

type Deal = { id: string; name: string; date: string | null; address: string; stage: string };

async function fetchDeals(): Promise<Deal[]> {
  const cols = `column_values(ids:["${DATE_COL}","${ADDR_COL}","${STAGE_COL}"]){ id text }`;
  const first = `query($b:[ID!]){ boards(ids:$b){ items_page(limit:200, query_params:{ rules:[{column_id:"${STAGE_COL}", compare_value:[${STAGE_SCHEDULED},${STAGE_FUNDED}], operator:any_of}] }){ cursor items{ id name ${cols} } } } }`;
  const more = `query($c:String!){ next_items_page(limit:200, cursor:$c){ cursor items{ id name ${cols} } } }`;

  const out: Deal[] = [];
  const pack = (items: any[]) => {
    for (const it of items) {
      const cv: Record<string, string> = {};
      for (const c of (it.column_values || [])) cv[c.id] = c.text || "";
      out.push({ id: it.id, name: it.name, date: cv[DATE_COL] || null, address: cv[ADDR_COL] || "", stage: cv[STAGE_COL] || "" });
    }
  };

  const d0 = await mondayGQL(first, { b: [BOARD_ID] });
  const page0 = d0?.boards?.[0]?.items_page;
  if (!page0) return out;
  pack(page0.items);
  let cursor = page0.cursor;
  let guard = 0;
  while (cursor && guard++ < 10) {
    const d = await mondayGQL(more, { c: cursor });
    const p = d?.next_items_page;
    if (!p) break;
    pack(p.items);
    cursor = p.cursor;
  }
  return out;
}

function sbHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN secret is not set" }, 400);
    if (!SB_URL || !SERVICE_KEY) return json({ error: "Supabase service env missing" }, 500);

    const deals = await fetchDeals();
    const runAt = new Date().toISOString();
    const floor = new Date(Date.now() - DAYS_BACK * 864e5).toISOString().slice(0, 10);

    const rows = [] as Record<string, unknown>[];
    for (const d of deals) {
      if (!d.date || d.date < floor) continue;            // need a date, skip old fundings
      const funded = /FUNDED/i.test(d.stage);
      rows.push({
        external_id: "monday:" + d.id,
        source: "monday",
        title: d.name,
        event_date: d.date,
        category: funded ? "funded" : "closing",
        notes: [d.address, d.stage].filter(Boolean).join(" · "),
        created_by_name: "monday · Master Pipeline",
        synced_at: runAt,
      });
    }

    // Upsert by external_id (merge-duplicates)
    let upserted = 0;
    if (rows.length) {
      const r = await fetch(`${SB_URL}/rest/v1/events?on_conflict=external_id`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(rows),
      });
      if (!r.ok) return json({ error: "upsert failed", detail: await r.text() }, 502);
      upserted = rows.length;
    }

    // Remove monday-sourced events not touched this run (left the stage / aged out)
    const del = await fetch(`${SB_URL}/rest/v1/events?source=eq.monday&synced_at=lt.${runAt}`, {
      method: "DELETE",
      headers: sbHeaders({ Prefer: "return=representation" }),
    });
    const removed = del.ok ? (await del.json()).length : 0;

    return json({ ok: true, fetched: deals.length, upserted, removed, ranAt: runAt });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
