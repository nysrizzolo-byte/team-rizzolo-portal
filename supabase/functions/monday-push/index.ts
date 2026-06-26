// Supabase Edge Function: monday-push
// Doc Review "Push to monday" write-back. Two actions:
//   action:"prepare" {fileBase64, mediaType} -> extracts setup fields from a purchase
//     contract (Claude) + finds matching Master Pipeline deals -> returns {fields, candidates}.
//   action:"commit"  {itemId, values}        -> writes the confirmed values onto that
//     monday item (change_multiple_column_values).
// Human-in-the-loop: the browser shows the match + editable values and only calls
// "commit" after the user confirms.
//
// Secrets: ANTHROPIC_API_KEY, MONDAY_API_TOKEN (both already set). DEPLOY: new function
// "monday-push", Verify JWT OFF.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const MODEL = "claude-sonnet-4-6";
const BOARD_ID = "6229246816"; // Master Pipeline (active)

// Master Pipeline column ids by field (writable subset).
const COLS = {
  closing_date:      { id: "date",             type: "date" },
  purchase_price:    { id: "numbers6",         type: "numbers" },
  loan_amount:       { id: "deal_actual_value", type: "numbers" },
  state:             { id: "text6",            type: "text" },
  seller_concession: { id: "numbers2",         type: "numbers" },
  loan_type:         { id: "dropdown2",        type: "dropdown" },
} as const;
const READ_COL_IDS = ["name", "deal_stage", "date", "numbers6", "deal_actual_value", "text6", "numbers2", "dropdown2"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function extractFields(fileBase64: string, mediaType: string) {
  const block = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };
  const sys = `You extract setup fields from a real-estate PURCHASE CONTRACT for a mortgage pipeline.
Return ONLY a JSON object (no prose, no code fences) with EXACTLY these keys:
"borrower_full" (full buyer name as written, or null),
"borrower_last" (buyer LAST name only, UPPERCASE, or null),
"closing_date" (settlement/closing date as YYYY-MM-DD, or null),
"purchase_price" (number only, no symbols, or null),
"loan_amount" (financing amount if stated, else null),
"state" (2-letter state from the property address, or null),
"seller_concession" (seller-paid credit as a number, 0 if none, or null),
"loan_type" (one of "Conventional","FHA","VA","USDA" inferred from financing/addenda, or null),
"address" (full subject property address, or null).
Use null when a value isn't in the contract. Output strictly valid JSON.`;
  const body = {
    model: MODEL, max_tokens: 700,
    system: sys,
    messages: [{ role: "user", content: [block, { type: "text", text: "Extract the setup fields as JSON." }] }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Claude error: " + await res.text());
  const j = await res.json();
  let txt = (j.content || []).map((c: { text?: string }) => c.text || "").join("").trim();
  txt = txt.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(txt);
}

async function findCandidates(lastName: string) {
  if (!lastName) return [];
  const q = `query($b:[ID!]){ boards(ids:$b){ items_page(limit:15, query_params:{ rules:[{column_id:"name", compare_value:${JSON.stringify(lastName)}, operator:contains_text}] }){ items{ id name group{ title } column_values(ids:${JSON.stringify(READ_COL_IDS)}){ id text } } } } }`;
  try {
    const d = await mondayGQL(q, { b: [BOARD_ID] });
    const items = d?.boards?.[0]?.items_page?.items || [];
    return items.map((it: any) => {
      const cv: Record<string, string> = {};
      for (const c of (it.column_values || [])) cv[c.id] = c.text || "";
      return { id: it.id, name: it.name, group: it.group?.title || "", current: cv };
    });
  } catch (_) {
    return [];
  }
}

function buildColumnValues(values: Record<string, unknown>) {
  const cv: Record<string, unknown> = {};
  for (const [field, meta] of Object.entries(COLS)) {
    const v = values[field];
    if (v === undefined || v === null || v === "") continue;
    if (meta.type === "date") cv[meta.id] = { date: String(v) };
    else if (meta.type === "numbers") cv[meta.id] = String(v).replace(/[^0-9.\-]/g, "");
    else if (meta.type === "dropdown") cv[meta.id] = { labels: [String(v)] };
    else cv[meta.id] = String(v);
  }
  return cv;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const { action, fileBase64, mediaType, itemId, values } = await req.json();

    if (action === "prepare") {
      if (!fileBase64) return json({ error: "fileBase64 required" }, 400);
      const fields = await extractFields(fileBase64, mediaType || "application/pdf");
      const candidates = await findCandidates(fields.borrower_last || "");
      return json({ ok: true, fields, candidates });
    }

    if (action === "commit") {
      if (!itemId || !values) return json({ error: "itemId and values required" }, 400);
      const cv = buildColumnValues(values);
      if (!Object.keys(cv).length) return json({ error: "no writable values" }, 400);
      const m = `mutation($item:ID!,$board:ID!,$vals:JSON!){ change_multiple_column_values(item_id:$item, board_id:$board, column_values:$vals){ id name } }`;
      const d = await mondayGQL(m, { item: String(itemId), board: BOARD_ID, vals: JSON.stringify(cv) });
      return json({ ok: true, item: d.change_multiple_column_values, wrote: Object.keys(cv).length });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
