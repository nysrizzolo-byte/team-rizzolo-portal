// Supabase Edge Function: structure-stip
// Auto-creates the "Structure loan and disclose" condition on a Master Pipeline deal
// the moment its Disclosures status flips to "NEED STRUCTURE". The new subitem is
// owned by the deal's LOA, carries the standard long-text note, and is created in an
// OPEN ("Requested") state so it shows up in the owner's My Conditions list. Idempotent:
// it won't create a second copy if one already exists.
//
// TRIGGER: a monday webhook on the Master Pipeline (board 6229246816),
//   event "change_specific_column_value", config {"columnId":"color_mkr2yase"}.
//   monday sends a {challenge} handshake on webhook creation — we echo it back.
//
// DEPLOY (Supabase dashboard → Edge Functions → new function "structure-stip"):
//   - Paste this file. Set Verify JWT = OFF (monday can't send a Supabase token).
//   - Reuses the existing MONDAY_API_TOKEN secret.
//   - Optional: set STRUCTURE_WEBHOOK_SECRET; if set, the webhook URL must include
//     ?token=<that value> or the call is rejected.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("STRUCTURE_WEBHOOK_SECRET") ?? "";

// ── Board wiring (Master Pipeline) ──
const DISCLOSURES_COL = "color_mkr2yase";          // parent status column we watch
const TRIGGER_LABEL = "NEED STRUCTURE";            // the value that fires this
const TRIGGER_INDEX = 11;                          // same label, by index (belt & suspenders)
const LOA_COL = "multiple_person_mkrzxq2c";        // parent people column → subitem owner
const SUB_NAME = "Structure loan and disclose";
const SUB_LONGTEXT_COL = "long_text_mm4hpxk0";     // subitem long-text column
const SUB_STATUS_COL = "color_mm4hnwb8";           // subitem Doc Status column
const SUB_OWNER_COL = "person";                    // subitem Owner (people) column
const SUB_NOTE = "If loan isn't ready to be structured, let the LO know what we're missing and move it back.";
const SUB_OPEN_STATUS = "Requested";               // an OPEN status so it shows in the portal

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);

    const body = await req.json().catch(() => ({}));

    // 1) monday webhook handshake — echo the challenge so the subscription can be created.
    if (body && body.challenge) return json({ challenge: body.challenge });

    // 2) Optional shared-secret gate (only enforced if the secret is configured).
    if (WEBHOOK_SECRET) {
      const token = new URL(req.url).searchParams.get("token") || "";
      if (token !== WEBHOOK_SECRET) return json({ error: "bad token" }, 401);
    }

    const ev = body && body.event;
    if (!ev) return json({ ok: true, skipped: "no event" });

    // 3) Only react to the Disclosures column flipping to NEED STRUCTURE.
    if (ev.columnId && ev.columnId !== DISCLOSURES_COL) return json({ ok: true, skipped: "other column" });
    const label = ev.value && ev.value.label;
    const labelText = (label && (label.text ?? label)) ?? "";
    const labelIndex = label && typeof label === "object" ? label.index : undefined;
    const isTrigger = String(labelText).trim().toUpperCase() === TRIGGER_LABEL || labelIndex === TRIGGER_INDEX;
    if (!isTrigger) return json({ ok: true, skipped: `not the trigger value (${labelText})` });

    const itemId = String(ev.pulseId || ev.itemId || "");
    if (!itemId) return json({ ok: true, skipped: "no item id" });

    // 4) Read the deal's LOA + existing subitems (for de-dup) in one call.
    const q = `query ($ids:[ID!]) { items(ids:$ids) {
      subitems { id name }
      column_values(ids:["${LOA_COL}"]) { id ... on PeopleValue { persons_and_teams { id kind } } }
    } }`;
    const data = await mondayGQL(q, { ids: [itemId] });
    const item = data?.items?.[0];
    if (!item) return json({ ok: true, skipped: "item not found" });

    // De-dup: don't add a second structure task if one is already there.
    const exists = (item.subitems || []).some((s: { name?: string }) =>
      (s.name || "").trim().toLowerCase() === SUB_NAME.toLowerCase());
    if (exists) return json({ ok: true, skipped: "already exists", itemId });

    // 5) Build the subitem column values (owner = the LOA, note, open status).
    const people = (item.column_values?.[0]?.persons_and_teams || [])
      .filter((p: { kind?: string }) => (p.kind || "person") === "person")
      .map((p: { id: number | string }) => ({ id: Number(p.id), kind: "person" }));
    const cols: Record<string, unknown> = {
      [SUB_LONGTEXT_COL]: SUB_NOTE,
      [SUB_STATUS_COL]: { label: SUB_OPEN_STATUS },
    };
    if (people.length) cols[SUB_OWNER_COL] = { personsAndTeams: people };

    const m = `mutation ($parent:ID!, $name:String!, $cols:JSON!) {
      create_subitem(parent_item_id:$parent, item_name:$name, column_values:$cols) { id }
    }`;
    const res = await mondayGQL(m, { parent: itemId, name: SUB_NAME, cols: JSON.stringify(cols) });
    const newId = res?.create_subitem?.id;
    return json({ ok: true, created: newId, itemId, owner: people.map((p) => p.id) });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
