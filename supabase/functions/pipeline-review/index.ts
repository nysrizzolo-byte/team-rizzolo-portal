// Supabase Edge Function: pipeline-review
// An interactive "pipeline call" for a small set of reviewers (admin + a hardcoded
// allow-list). Returns the Master Pipeline organized into review buckets —
//   Weekly Targets (stage "WKLY TARGET…")  →  This Month (closing date in the
//   current month)  →  Setup Milestone  →  Working / Disclosures  — with every
// field a reviewer changes on a call: Appraisal / HOI / Title / Locked / CD, the
// Partner Update + Team Update notes, and the deal's conditions (subitems:
// add / remove / status / note). Write actions mutate monday directly.
//
// Access is gated SERVER-SIDE: role === "admin", or the caller's monday display
// name is in ALLOW_NAMES. Removing a condition ARCHIVES the subitem (recoverable),
// never a hard delete.
//
// Secrets/env: MONDAY_API_TOKEN (set), SUPABASE_URL + SUPABASE_ANON_KEY (auto).
// DEPLOY: new function "pipeline-review", Verify JWT OFF (we verify userToken).

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const MASTER = "6229246816";
const SUBITEMS = "6229246873";
const SUB_STATUS = "color_mm4hnwb8", SUB_NOTE = "long_text_mm4hpxk0", SUB_PERSON = "person";
const SUB_LABELS = ["Requested", "Received / In One Drive", "Can't Obtain / Doesn't Exist", "Need Reviewed", "Not Required", "Not Requested"];
const SUB_DONE = ["Received / In One Drive", "Not Required"];

// Master Pipeline column ids.
const COL = {
  stage: "deal_stage", closing: "date", lo: "deal_owner", loa: "multiple_person_mkrzxq2c",
  appraisal: "status_1", hoi: "status_2", title: "status", lock: "checkbox4", cd: "status1",
  partner: "long_text_mm526jmv", team: "long_text_mm5cj2q5",
  price: "numbers6", loanAmt: "deal_actual_value", loanNo: "loan_number", address: "location9",
};
// Editable status columns exposed on the review card (field -> monday column id).
const EDIT_STATUS: Record<string, string> = { appraisal: COL.appraisal, hoi: COL.hoi, title: COL.title, cd: COL.cd };

// Reviewers besides admins. Matched against the caller's monday display name.
const ALLOW_NAMES = new Set(["matthew porcaro", "yhma karimy"]);

// Deals in these groups / stages are done or dead — never surfaced for review.
const DEAD_GROUPS = new Set(["LOST / DEAD / LIFE SUPPORT", "LIMBO", "2025 FUNDINGS", "2024 FUNDINGS"]);
const DEAD_STAGES = new Set(["CLOSED / FUNDED", "NOT PROCEEDING", "SUSPENDED"]);

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
async function getProfile(token: string, id: string): Promise<{ name: string; role: string; status: string; mondayName: string }> {
  const base = `${SB_URL}/rest/v1/profiles?id=eq.${id}&select=`;
  for (const sel of ["first_name,last_name,role,status,monday_name", "first_name,last_name,role,status"]) {
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
async function resolveSelf(user: { email: string }, prof: { name: string; mondayName: string }): Promise<string> {
  if (prof.mondayName) return prof.mondayName;
  const mu = await mondayGQL(`query{ users(limit:500){ name email } }`, {});
  const users: { name: string; email: string }[] = (mu?.users || []).map((u: any) => ({ name: u.name || "", email: (u.email || "").toLowerCase() }));
  const byEmail = users.find((u) => u.email && u.email === user.email);
  if (byEmail) return byEmail.name;
  if (prof.name) { const full = prof.name.toLowerCase(); const byName = users.find((u) => u.name.toLowerCase() === full); if (byName) return byName.name; }
  return "";
}

function cvMap(it: any): Record<string, { text: string; value: string }> {
  const m: Record<string, { text: string; value: string }> = {};
  for (const c of (it.column_values || [])) m[c.id] = { text: c.text || "", value: c.value || "" };
  return m;
}
function isChecked(cv: { value: string } | undefined): boolean {
  if (!cv?.value) return false;
  try { return JSON.parse(cv.value)?.checked === true || JSON.parse(cv.value)?.checked === "true"; } catch (_) { return false; }
}
// Parse a status column's labels {index: label} from its settings_str.
function parseLabels(settingsStr: string): string[] {
  try {
    const s = JSON.parse(settingsStr || "{}");
    const labels = s.labels || {};
    if (Array.isArray(labels)) return labels.map((l: any) => l?.name || l?.label).filter(Boolean);
    return Object.values(labels).filter((v) => typeof v === "string" && v) as string[];
  } catch (_) { return []; }
}

// Bucket a deal, first match wins; null = not part of this review.
function bucketFor(stage: string, closing: string, group: string, curYM: string): string | null {
  const st = (stage || "").toUpperCase().trim(), gr = (group || "").toUpperCase().trim();
  if (DEAD_STAGES.has(st) || DEAD_GROUPS.has(gr)) return null;
  if (st.startsWith("WKLY TARGET")) return "weekly";
  if (closing && closing.slice(0, 7) === curYM) return "monthly";
  if (gr === "SETUP MILESTONE") return "setup";
  if (gr.startsWith("WORKING / DISCLOSURES")) return "working";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const prof = await getProfile(body.userToken, user.id);
    if (prof.status && prof.status !== "approved" && prof.role !== "admin") return json({ error: "not approved" }, 403);
    const myName = await resolveSelf(user, prof);
    const allowed = prof.role === "admin" || ALLOW_NAMES.has((myName || "").trim().toLowerCase());
    if (!allowed) return json({ error: "not authorized" }, 403);

    // ── Write: a status column (appraisal/hoi/title/cd) or the Locked checkbox ──
    if (body.action === "setColumn") {
      const itemId = String(body.itemId || "");
      const field = String(body.field || "");
      if (!itemId) return json({ error: "itemId required" }, 400);
      if (field === "lock") {
        const on = body.value === true || body.value === "true";
        await mondayGQL(`mutation($item:ID!,$val:JSON!){ change_column_value(board_id:${MASTER}, item_id:$item, column_id:"${COL.lock}", value:$val){ id } }`, { item: itemId, val: JSON.stringify({ checked: on ? "true" : "false" }) });
        return json({ ok: true });
      }
      const colId = EDIT_STATUS[field];
      if (!colId) return json({ error: "bad field" }, 400);
      const label = String(body.value ?? "");
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${MASTER}, item_id:$item, column_id:"${colId}", value:$val){ id } }`, { item: itemId, val: label });
      return json({ ok: true });
    }

    // ── Write: Partner Update or Team Update (item long-text) ──
    if (body.action === "setNote") {
      const itemId = String(body.itemId || "");
      const which = body.which === "team" ? "team" : "partner";
      const colId = which === "team" ? COL.team : COL.partner;
      if (!itemId) return json({ error: "itemId required" }, 400);
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${MASTER}, item_id:$item, column_id:"${colId}", value:$val){ id } }`, { item: itemId, val: String(body.note ?? "") });
      return json({ ok: true });
    }

    // ── Write: a condition's status and/or note (subitem) ──
    if (body.action === "setCondition") {
      const subId = String(body.subitemId || "");
      if (!subId) return json({ error: "subitemId required" }, 400);
      if (typeof body.status === "string" && body.status) {
        if (!SUB_LABELS.includes(body.status)) return json({ error: "bad status" }, 400);
        await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${SUBITEMS}, item_id:$item, column_id:"${SUB_STATUS}", value:$val){ id } }`, { item: subId, val: body.status });
      }
      if (typeof body.note === "string") {
        await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${SUBITEMS}, item_id:$item, column_id:"${SUB_NOTE}", value:$val){ id } }`, { item: subId, val: body.note });
      }
      return json({ ok: true });
    }

    // ── Write: add a condition (subitem) under a deal ──
    if (body.action === "addCondition") {
      const itemId = String(body.itemId || "");
      const name = String(body.name || "").trim();
      if (!itemId || !name) return json({ error: "itemId and name required" }, 400);
      const d = await mondayGQL(`mutation($p:ID!,$n:String!){ create_subitem(parent_item_id:$p, item_name:$n){ id } }`, { p: itemId, n: name });
      const newId = String(d?.create_subitem?.id || "");
      // Start it as an open condition so it shows up as outstanding.
      if (newId) { try { await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${SUBITEMS}, item_id:$item, column_id:"${SUB_STATUS}", value:$val){ id } }`, { item: newId, val: "Requested" }); } catch (_) { /* label may differ; leave blank */ } }
      return json({ ok: true, condition: { id: newId, name, status: "Requested", note: "" } });
    }

    // ── Write: remove a condition — ARCHIVE (recoverable), not delete ──
    if (body.action === "removeCondition") {
      const subId = String(body.subitemId || "");
      if (!subId) return json({ error: "subitemId required" }, 400);
      await mondayGQL(`mutation($item:ID!){ archive_item(item_id:$item){ id } }`, { item: subId });
      return json({ ok: true });
    }

    // ── Read: the whole review (default action) ──
    const now = new Date();
    const curYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

    // Label sets for the editable status columns (kept in sync with monday live).
    const labelSets: Record<string, string[]> = { conditions: SUB_LABELS };
    try {
      const lc = await mondayGQL(`query{ boards(ids:${MASTER}){ columns(ids:["${COL.appraisal}","${COL.hoi}","${COL.title}","${COL.cd}"]){ id settings_str } } }`, {});
      for (const c of (lc?.boards?.[0]?.columns || [])) {
        const key = Object.keys(EDIT_STATUS).find((k) => EDIT_STATUS[k] === c.id);
        if (key) labelSets[key] = parseLabels(c.settings_str);
      }
    } catch (_) { /* dropdowns fall back to current value only */ }

    // Pass 1: scan the board, keep only deals that belong to a review bucket.
    const IDS = [COL.stage, COL.closing, COL.lo, COL.loa, COL.appraisal, COL.hoi, COL.title, COL.lock, COL.cd, COL.partner, COL.team, COL.price, COL.loanAmt, COL.loanNo, COL.address].map((i) => `"${i}"`).join(",");
    const kept: any[] = [];
    let cursor: string | null = null;
    do {
      const q = `query($c:String){ boards(ids:${MASTER}){ items_page(limit:100, cursor:$c){ cursor items{ id name group{ title } column_values(ids:[${IDS}]){ id text value } } } } }`;
      const d = await mondayGQL(q, { c: cursor });
      const page = d?.boards?.[0]?.items_page;
      if (!page) break;
      for (const it of (page.items || [])) {
        const cv = cvMap(it);
        const bucket = bucketFor(cv[COL.stage]?.text || "", cv[COL.closing]?.text || "", it.group?.title || "", curYM);
        if (!bucket) continue;
        kept.push({
          itemId: String(it.id), name: it.name, bucket,
          stage: cv[COL.stage]?.text || "", closingDate: cv[COL.closing]?.text || "", group: it.group?.title || "",
          lo: cv[COL.lo]?.text || "", loa: cv[COL.loa]?.text || "",
          cols: {
            appraisal: cv[COL.appraisal]?.text || "", hoi: cv[COL.hoi]?.text || "",
            title: cv[COL.title]?.text || "", cd: cv[COL.cd]?.text || "", lock: isChecked(cv[COL.lock]),
          },
          partner: cv[COL.partner]?.text || "", team: cv[COL.team]?.text || "",
          price: cv[COL.price]?.text || "", loanAmt: cv[COL.loanAmt]?.text || "",
          loanNo: cv[COL.loanNo]?.text || "", address: cv[COL.address]?.text || "",
          conditions: [] as any[],
        });
      }
      cursor = page.cursor;
    } while (cursor);

    // Pass 2: pull conditions (subitems) for the kept deals only, in id batches.
    const byId: Record<string, any> = {};
    for (const k of kept) byId[k.itemId] = k;
    const ids = kept.map((k) => k.itemId);
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const q = `query($ids:[ID!]){ items(ids:$ids){ id subitems{ id name column_values(ids:["${SUB_STATUS}","${SUB_NOTE}","${SUB_PERSON}"]){ id text } } } }`;
      const d = await mondayGQL(q, { ids: batch });
      for (const it of (d?.items || [])) {
        const parent = byId[String(it.id)];
        if (!parent) continue;
        for (const su of (it.subitems || [])) {
          const scv: Record<string, string> = {};
          for (const c of (su.column_values || [])) scv[c.id] = c.text || "";
          const status = scv[SUB_STATUS] || "";
          if (SUB_DONE.includes(status)) continue; // only outstanding conditions
          parent.conditions.push({ id: String(su.id), name: su.name, status, note: scv[SUB_NOTE] || "", person: scv[SUB_PERSON] || "" });
        }
      }
    }

    return json({ ok: true, generatedAt: now.toISOString(), monthLabel, labelSets, deals: kept });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
