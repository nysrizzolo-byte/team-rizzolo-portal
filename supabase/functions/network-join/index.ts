// Supabase Edge Function: network-join
// The 203K Way → "Join the 203K Network" form. On submit it:
//   1. Creates a CONTACT on the Contacts board (Owner = Sal, Biz Dev = Matt),
//   2. Creates an item on the Realtor Partner Pipeline (Owner = Sal, Biz Dev = Matt,
//      Headway = Initial Outreach, notes = role + counties + about),
//   3. Links the pipeline item to the contact via the "Contact Link" column.
//
// Secret: MONDAY_API_TOKEN (already set). DEPLOY: new function "network-join", Verify JWT OFF.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";

const CONTACTS_BOARD = "6229246824";
const CONTACTS_GROUP = "new_group95562"; // "New Form Contacts"
const PIPELINE_BOARD = "18418461164";
const PIPELINE_GROUP = "topics";          // "🎯 Targets — Want to Work With"

const SAL = 35039487;        // Owner
const MATT = 49924676;       // Biz Dev (Matthew Porcaro)

// STATE_COUNTIES uses full state names; the Contacts State dropdown uses 2-letter labels.
const STATE_ABBR: Record<string, string> = {
  "California": "CA", "Florida": "FL", "New York": "NY", "North Carolina": "NC", "South Carolina": "SC",
};

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
function person(id: number) { return { personsAndTeams: [{ id, kind: "person" }] }; }
function phoneVal(p: string) {
  const digits = (p || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return { phone: "+1" + d, countryShortName: "US" };
}
async function createItem(board: string, group: string, name: string, cols: Record<string, unknown>) {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cols)) if (v !== null && v !== undefined && v !== "") clean[k] = v;
  const m = `mutation($b:ID!,$g:String,$n:String!,$c:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$c, create_labels_if_missing:true){ id } }`;
  const d = await mondayGQL(m, { b: board, g: group, n: name, c: JSON.stringify(clean) });
  return d.create_item.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const b = await req.json();
    const name = (b.name || "").trim();
    if (!name) return json({ error: "name required" }, 400);
    const kind = (b.kind || "").trim();                 // Realtor | Contractor | Other
    const company = (b.company || "").trim();
    const stateFull = (b.state || "").trim();
    const counties: string[] = Array.isArray(b.counties) ? b.counties : [];
    const email = (b.email || "").trim();
    const phone = phoneVal(b.phone || "");
    const notes = (b.notes || "").trim();
    const abbr = STATE_ABBR[stateFull] || "";
    const profession = kind === "Realtor" ? "Realtor" : kind === "Contractor" ? "Contractor" : "";

    // 1) Contact
    const contactCols: Record<string, unknown> = {
      contact_email: email ? { email, text: email } : null,
      contact_phone: phone,
      status: profession ? { label: profession } : null,                  // Profession
      dropdown_mky0qbch: abbr ? { labels: [abbr] } : null,                // State
      people_mkn1xw9a: person(SAL),                                       // Owner
      multiple_person_mkqcd1ke: person(MATT),                             // Biz Dev
    };
    const contactId = await createItem(CONTACTS_BOARD, CONTACTS_GROUP, name, contactCols);

    // 2) Pipeline item, linked to the contact
    const areaLine = counties.length ? `Serves ${stateFull}: ${counties.join(", ")}.` : (stateFull ? `Serves ${stateFull}.` : "");
    const noteBody = [kind ? `${kind}.` : "", areaLine, notes].filter(Boolean).join(" ");
    const pipelineCols: Record<string, unknown> = {
      email_mm4ehr8j: email ? { email, text: email } : null,
      phone_mm4ehbg2: phone,
      text_mm4ek9h2: company,                                             // Brokerage
      multiple_person_mm4gsd9k: person(MATT),                            // Biz Dev
      multiple_person_mm4ecbk5: person(SAL),                             // Owner
      color_mm4egvsp: { label: "Initial Outreach" },                     // Headway
      text_mm4erndx: "203K Network signup",                              // How We Met
      long_text_mm4e5411: noteBody,                                      // Notes
      board_relation_mm4gzscp: { item_ids: [Number(contactId)] },        // Contact Link
    };
    const pipelineId = await createItem(PIPELINE_BOARD, PIPELINE_GROUP, name, pipelineCols);

    return json({ ok: true, contactId, pipelineId });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
