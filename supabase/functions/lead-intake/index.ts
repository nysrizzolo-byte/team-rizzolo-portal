// Supabase Edge Function: lead-intake
// Powers the "Take an Application" lead bar. Two actions:
//   search {q}  → find existing leads on the Lead Board by name (for "link existing lead").
//   create {..} → add a NEW lead, assigned to the logged-in LO (unassigned people → Carol).
// Uses the portal's MONDAY_API_TOKEN so NO team member needs a monday login.
// Auth: Verify JWT OFF; we verify the caller's Supabase token ourselves (approved users only).
// Env: MONDAY_API_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY.

const MONDAY_TOKEN = Deno.env.get("MONDAY_API_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const LEAD_BOARD = "6229246811";
const NEW_GROUP = "new_group";                 // "Working On"
const COL_PHONE = "lead_phone";
const COL_EMAIL = "lead_email";
const COL_LO = "multiple_person_mky6cr94";     // L/O (Owner)
const COL_REF = "board_relation_mkw34hbe";     // Referral Contact
const COL_FOLLOWUP = "date";                    // "Follow Up Date" (a monday automation moves it off Working On)
// For the full "My Leads" page — Working On + Follow Up + Pre-Approved, with Biz Dev / Junior for grouping.
const LEAD_GROUPS: [string, string][] = [["new_group", "Working On"], ["new_group46870", "Follow Up"], ["new_group59359", "Pre-Approved"]];
// COL_JUNIOR ("people_1") is already declared above (Alasia/Yhma rule) — reuse it.
const COL_BIZ_MIRROR = "lookup_mkw3ayfc";       // "Biz Dev" (mirror — reflects the referral contact's Biz Dev)
const COL_BIZ_PEOPLE = "multiple_person_mky660ch"; // "Biz Dev / Branch" (direct)
const COL_BUYER_AGENT = "board_relation_mkw3ftdg"; // "Buyer Agent" → Contacts board
// Contacts board — where referral partners AND buyer agents live; "New Contact" creates here.
const CONTACTS_BOARD = "6229246824";
const CONTACT_PHONE = "contact_phone";
const CONTACT_EMAIL = "contact_email";

// "Sal's team" rule — mirrors the monday automation (when L/O = Sal, add his LOA + Junior
// and notify them). We replicate it here because the automation's "Notify" action fails for
// leads created by the API account ("Lead Intake"): notification_target_user_unauthorized.
const SAL_ID = 35039487;                            // L/O owner value the automation keys on
const COL_LOA_REVIEW = "multiple_person_mm4jfgmq";  // "LOA / Review"
const COL_JUNIOR = "people_1";                       // "Junior"
const COL_NOTE = "long_text_mm52p1kx";               // "Partner Update" (what the referral partner sees)
const COL_DISPO = "status_12";                       // "Kill / End Dispo" (status)
const YHMA_ID = 34701120;                            // → LOA / Review
const ALASIA_ID = 73827835;                          // → Junior

// Master Pipeline (main deals board) — for the My Work "Priority" section.
const MASTER_BOARD = "6229246816";
const M_PRIORITY = "numeric_mm3q3egw";         // "Priority" (numbers; Sal orders 1, 2, 3…)
const M_STAGE = "deal_stage";
const M_LOAN = "loan_number";
// Responsibility task boxes: a person responsible for a step sees a queue of deals waiting
// on them. Keyed by monday name (lowercased) → box keys. Easy to extend (more people/boxes).
const RESPONSIBILITY: Record<string, string[]> = {
  "stephanie franco": ["appraisal"],
};
// Master status columns used by task boxes.
const M_CONTRACT = "color_mm1738qm";   // Contract: "Contract In" = in
const M_DISCLOSURES = "color_mkr2yase"; // Disclosures: "SIGNED" = signed
const M_APPRAISAL = "status_1";        // Appraisal: "" or "NOT ORDERED" = not ordered yet
const M_LOAN_AMT = "deal_actual_value";
const M_DATE = "date";
const M_REF = "deal_contact";          // Referral Source (board relation → Contacts)
// People on a deal — stage boxes show for whoever is the LO / LOA / Processor of that deal.
const M_LO = "deal_owner";
const M_LOA = "multiple_person_mkrzxq2c";
const M_PROCESSOR = "people1__1";
// Stage-driven task boxes: deal_stage label → shown to that deal's LO/LOA/Processor.
const STAGE_BOXES: { key: string; icon: string; title: string; sub: string; stage: string }[] = [
  { key: "initialsub", icon: "📤", title: "Ready for Initial Submission", sub: "Set up — ready to submit to underwriting", stage: "READY FOR INITIAL SUB" },
  { key: "cleartoclose", icon: "🏁", title: "Ready to Submit for Clear to Close", sub: "Approved & stipped — ready to submit for CTC", stage: "RDY FOR CLEAR / REVIEW" },
];
// The three "owner" people columns — a priority deal shows for anyone in any of them.
const M_PEOPLE: [string, string][] = [["deal_owner", "LO"], ["multiple_person_mkrzxq2c", "LOA"], ["multiple_person_mm4mbf80", "Junior"]];

// LOs who have their own lead form → a new lead they take is assigned to them.
const LO_MAP: Record<string, number> = {
  "sal rizzolo": 35039487, "felix diaz": 102022029, "elvis regis": 100465331,
  "theresa feehan": 38548733, "matthew porcaro": 49924676, "richard luxmore": 74046070,
  "nicholas lisi": 87449263,
};
const CAROL = 35040324; // Carolina Lopez — the unassigned fallback

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
async function verifyUser(token: string): Promise<{ id: string } | null> {
  if (!token || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id } : null;
  } catch (_) { return null; }
}
async function mondayName(token: string, id: string): Promise<string> {
  for (const sel of ["monday_name,first_name,last_name", "first_name,last_name"]) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=${sel}`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return "";
      return (p.monday_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "").trim();
    } catch (_) { /* next */ }
  }
  return "";
}
// Caller's monday name + portal role (role is used to gate the admin "view as" override).
async function nameAndRole(token: string, id: string): Promise<{ name: string; role: string }> {
  for (const sel of ["monday_name,first_name,last_name,role", "first_name,last_name,role", "first_name,last_name"]) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=${sel}`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return { name: "", role: "" };
      return { name: (p.monday_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "").trim(), role: p.role || "" };
    } catch (_) { /* next */ }
  }
  return { name: "", role: "" };
}
// Resolve whose leads to show. Admins may impersonate any monday person via viewOwner
// (the person-level simulator); everyone else is locked to their own linked name.
async function resolveWho(token: string, id: string, viewOwner?: string): Promise<string> {
  const me = await nameAndRole(token, id);
  if (viewOwner && me.role === "admin") return String(viewOwner).trim();
  return me.name;
}
const cv = (it: any, id: string) => (it.column_values || []).find((c: any) => c.id === id)?.text || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);

    // ── Search existing leads by name ──
    if (body.action === "search") {
      const q = String(body.q || "").trim();
      if (q.length < 2) return json({ ok: true, leads: [] });
      const safe = q.replace(/[\\"]/g, "");
      const query = `query { boards(ids:${LEAD_BOARD}){ items_page(limit:8, query_params:{rules:[{column_id:"name", compare_value:"${safe}", operator:contains_text}]}){ items{ id name group{ title } column_values(ids:["${COL_PHONE}","${COL_EMAIL}","${COL_LO}","${COL_REF}"]){ id text } } } } }`;
      const d = await mondayGQL(query, {});
      const items = d?.boards?.[0]?.items_page?.items || [];
      const leads = items.map((it: any) => ({
        id: String(it.id), name: it.name, stage: it.group?.title || "",
        phone: cv(it, COL_PHONE), email: cv(it, COL_EMAIL),
        lo: cv(it, COL_LO), referral: cv(it, COL_REF),
      }));
      return json({ ok: true, leads });
    }

    // ── My leads: the caller's own leads still in "Working On" ──
    if (body.action === "myleads") {
      const who = await resolveWho(body.userToken, user.id, body.viewOwner);
      if (!who) return json({ ok: true, leads: [], note: "not-linked" });
      const target = who.toLowerCase();
      const query = `query { boards(ids:${LEAD_BOARD}){ groups(ids:["${NEW_GROUP}"]){ items_page(limit:250){ items{ id name created_at column_values(ids:["${COL_PHONE}","${COL_EMAIL}","${COL_LO}","${COL_JUNIOR}","${COL_REF}","${COL_FOLLOWUP}"]){ id text ... on DateValue { date } } } } } } }`;
      const d = await mondayGQL(query, {});
      const raw = d?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
      const todayStr = new Date().toISOString().slice(0, 10);
      const dateOf = (it: any, id: string) => { const c = (it.column_values || []).find((x: any) => x.id === id); return c ? (c.date || c.text || "") : ""; };
      // Show a lead if the caller is its LO Owner OR its Junior.
      const onLeadCol = (it: any, col: string) => (cv(it, col) || "").toLowerCase().split(",").map((s: string) => s.trim()).includes(target);
      const leads = raw
        .filter((it: any) => onLeadCol(it, COL_LO) || onLeadCol(it, COL_JUNIOR))
        // Hide leads with a future follow-up date — they're "scheduled" and reappear when it arrives.
        .filter((it: any) => { const fu = dateOf(it, COL_FOLLOWUP); return !fu || fu <= todayStr; })
        .map((it: any) => ({
          id: String(it.id), name: it.name, created: it.created_at || "",
          phone: cv(it, COL_PHONE), email: cv(it, COL_EMAIL), referral: cv(it, COL_REF),
        }))
        .sort((a: any, b: any) => (b.created || "").localeCompare(a.created || ""));
      return json({ ok: true, leads, owner: who });
    }

    // ── Full My Leads page: caller's leads across Working On + Follow Up + Pre-Approved,
    //    with Biz Dev / Junior / referral so the client can group them. ──
    if (body.action === "leadsfull") {
      const who = await resolveWho(body.userToken, user.id, body.viewOwner);
      if (!who) return json({ ok: true, leads: [], note: "not-linked" });
      const target = who.toLowerCase();
      const groupIds = LEAD_GROUPS.map(([g]) => `"${g}"`).join(",");
      const colIds = [COL_PHONE, COL_EMAIL, COL_LO, COL_REF, COL_FOLLOWUP, COL_BIZ_MIRROR, COL_BIZ_PEOPLE, COL_JUNIOR, COL_NOTE, COL_DISPO].map((c) => `"${c}"`).join(",");
      const query = `query { boards(ids:${LEAD_BOARD}){ groups(ids:[${groupIds}]){ id title items_page(limit:400){ items{ id name column_values(ids:[${colIds}]){ id text ... on MirrorValue { display_value } ... on BoardRelationValue { display_value } ... on DateValue { date } } } } } } }`;
      const d = await mondayGQL(query, {});
      const groups = d?.boards?.[0]?.groups || [];
      const labelOf: Record<string, string> = Object.fromEntries(LEAD_GROUPS);
      const dv = (it: any, id: string) => { const c = (it.column_values || []).find((x: any) => x.id === id); return c ? (c.display_value || c.date || c.text || "") : ""; };
      const leads: any[] = [];
      for (const g of groups) {
        const stage = labelOf[g.id] || g.title || "";
        for (const it of (g.items_page?.items || [])) {
          // Show a lead if the caller is its LO Owner OR its Junior.
          const onCol = (col: string) => (cv(it, col) || "").toLowerCase().split(",").map((s: string) => s.trim()).includes(target);
          if (!onCol(COL_LO) && !onCol(COL_JUNIOR)) continue;
          const bizDev = [dv(it, COL_BIZ_MIRROR), cv(it, COL_BIZ_PEOPLE)].map((s) => s.trim()).filter(Boolean).join(", ");
          leads.push({
            id: String(it.id), name: it.name, stage, group: g.id,
            phone: cv(it, COL_PHONE), email: cv(it, COL_EMAIL),
            lo: cv(it, COL_LO), junior: cv(it, COL_JUNIOR),
            bizDev, referral: dv(it, COL_REF), followup: dv(it, COL_FOLLOWUP),
            note: cv(it, COL_NOTE), dispo: cv(it, COL_DISPO),
          });
        }
      }
      return json({ ok: true, leads, owner: who });
    }

    // ── Set a lead's Follow Up Date (a monday automation then moves it off Working On) ──
    if (body.action === "setFollowup") {
      const leadId = String(body.leadId || "");
      const date = String(body.date || "");
      if (!leadId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "leadId and a valid date (YYYY-MM-DD) required" }, 400);
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${LEAD_BOARD}, item_id:$item, column_id:"${COL_FOLLOWUP}", value:$val){ id } }`, { item: leadId, val: date });
      return json({ ok: true, leadId, date });
    }

    // ── Set a lead's Partner Update note (what the referral partner sees) ──
    if (body.action === "setLeadNote") {
      const leadId = String(body.leadId || "");
      if (!leadId) return json({ error: "leadId required" }, 400);
      const note = String(body.note ?? "");
      // long_text columns take a JSON value {"text": "..."}.
      await mondayGQL(`mutation($item:ID!,$val:JSON!){ change_column_value(board_id:${LEAD_BOARD}, item_id:$item, column_id:"${COL_NOTE}", value:$val){ id } }`, { item: leadId, val: JSON.stringify({ text: note }) });
      return json({ ok: true, leadId });
    }

    // ── Set a lead's Kill / End Dispo (disposition it) ──
    if (body.action === "setDispo") {
      const leadId = String(body.leadId || "");
      const dispo = String(body.dispo || "").trim();
      if (!leadId || !dispo) return json({ error: "leadId and dispo required" }, 400);
      // Status columns accept the label text via change_simple_column_value.
      await mondayGQL(`mutation($item:ID!,$val:String!){ change_simple_column_value(board_id:${LEAD_BOARD}, item_id:$item, column_id:"${COL_DISPO}", value:$val){ id } }`, { item: leadId, val: dispo });
      return json({ ok: true, leadId, dispo });
    }

    // ── Priority deals: Master Pipeline items with a Priority number, where the
    //    caller is on the LO / LOA / Junior column. Ordered by that number (1,2,3…). ──
    if (body.action === "priority") {
      const who = await resolveWho(body.userToken, user.id, body.viewOwner);
      if (!who) return json({ ok: true, items: [], note: "not-linked" });
      const target = who.toLowerCase();
      const colIds = [M_PRIORITY, M_STAGE, M_LOAN, ...M_PEOPLE.map(([c]) => c)].map((c) => `"${c}"`).join(",");
      const all: any[] = [];
      let cursor: string | null = null, pages = 0;
      do {
        const q = `query($c:String){ boards(ids:${MASTER_BOARD}){ items_page(limit:500, cursor:$c){ cursor items{ id name column_values(ids:[${colIds}]){ id text } } } } }`;
        const d = await mondayGQL(q, { c: cursor });
        const page = d?.boards?.[0]?.items_page;
        if (!page) break;
        all.push(...(page.items || []));
        cursor = page.cursor;
      } while (cursor && ++pages < 8);
      const onItem = (it: any, col: string) => (cv(it, col) || "").toLowerCase().split(",").map((s: string) => s.trim()).includes(target);
      // Drop finished/dead deals — priority is about what's still active.
      const TERMINAL = new Set(["closed / funded", "not proceeding"]);
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const items = all
        .map((it: any) => {
          const ptext = cv(it, M_PRIORITY);
          const prio = ptext === "" ? NaN : Number(ptext);
          const role = M_PEOPLE.find(([c]) => onItem(it, c))?.[1] || "";
          return { it, prio, role, stage: cv(it, M_STAGE) };
        })
        .filter((x) => !isNaN(x.prio) && x.role && !TERMINAL.has(norm(x.stage)))
        .sort((a, b) => a.prio - b.prio)
        .map((x) => ({ id: String(x.it.id), name: x.it.name, priority: x.prio, stage: x.stage, loan: cv(x.it, M_LOAN), role: x.role }));
      return json({ ok: true, items, owner: who });
    }

    // ── Task boxes: role-based action queues at the top of a person's home ──
    // Two kinds: (1) STAGE boxes — shown to whoever is the deal's LO/LOA/Processor when the
    // deal sits at a given stage (Ready for Initial Sub, Ready to Submit for CTC); everyone
    // sees only their own. (2) CONFIG boxes — a fixed person owns a step (Stephanie →
    // appraisals to order); shows ALL matching deals. One Master scan builds them all.
    if (body.action === "taskboxes") {
      const me = await nameAndRole(body.userToken, user.id);
      const isAdmin = me.role === "admin";
      const who = (body.viewOwner && isAdmin) ? String(body.viewOwner).trim() : me.name;
      const target = who.toLowerCase();
      let configKeys = RESPONSIBILITY[target] || [];
      // An admin on their own home (no simulate) can preview config boxes too.
      if (!configKeys.length && isAdmin && !body.viewOwner) configKeys = ["appraisal"];
      const wantAppraisal = configKeys.includes("appraisal");

      // Is `who` on this deal as LO / LOA / Processor?
      const onDeal = (it: any) => [M_LO, M_LOA, M_PROCESSOR].some((c) => (cv(it, c) || "").toLowerCase().split(",").map((s: string) => s.trim()).includes(target));
      const stageAcc: Record<string, any[]> = {};
      for (const b of STAGE_BOXES) stageAcc[b.key] = [];
      const stageByLabel: Record<string, typeof STAGE_BOXES[number]> = {};
      for (const b of STAGE_BOXES) stageByLabel[b.stage.toUpperCase()] = b;
      const appraisalDeals: any[] = [];

      const cols = [M_STAGE, M_CONTRACT, M_DISCLOSURES, M_APPRAISAL, M_LOAN_AMT, M_DATE, M_REF, M_LO, M_LOA, M_PROCESSOR].map((c) => `"${c}"`).join(",");
      let cursor: string | null = null, pages = 0;
      do {
        const q = `query($c:String){ boards(ids:${MASTER_BOARD}){ items_page(limit:250, cursor:$c){ cursor items{ id name group{ title } column_values(ids:[${cols}]){ id text ... on BoardRelationValue { display_value } } } } } }`;
        const d = await mondayGQL(q, { c: cursor });
        const page = d?.boards?.[0]?.items_page;
        if (!page) break;
        for (const it of (page.items || [])) {
          const g = (it.group?.title || "").toLowerCase();
          if (/lost|dead|funding|limbo|suspend|not proceed|graveyard/.test(g)) continue;
          const stageRaw = cv(it, M_STAGE) || "";
          const stage = stageRaw.toUpperCase().trim();
          if (stage === "CLOSED / FUNDED" || stage === "NOT PROCEEDING" || stage === "SUSPENDED") continue;
          const refC = (it.column_values || []).find((c: any) => c.id === M_REF);
          const row = { id: String(it.id), name: it.name, stage: stageRaw, lo: cv(it, M_LO), referral: refC?.display_value || "", loan: cv(it, M_LOAN_AMT), closeDate: cv(it, M_DATE) };
          // Stage boxes — this person's own deals at that stage.
          const sb2 = stageByLabel[stage];
          if (sb2 && onDeal(it)) stageAcc[sb2.key].push(row);
          // Appraisal config box — all deals needing an appraisal ordered.
          if (wantAppraisal) {
            const contractIn = (cv(it, M_CONTRACT) || "").trim() === "Contract In";
            const discSigned = (cv(it, M_DISCLOSURES) || "").trim() === "SIGNED";
            const apprText = (cv(it, M_APPRAISAL) || "").toUpperCase().trim();
            if (contractIn && discSigned && (apprText === "" || apprText === "NOT ORDERED")) appraisalDeals.push(row);
          }
        }
        cursor = page.cursor;
      } while (cursor && ++pages < 12);

      const boxes: any[] = [];
      // Stage boxes first (the person's own action items) — only when they have any.
      for (const b of STAGE_BOXES) {
        const deals = stageAcc[b.key].sort((a, b2) => a.name.localeCompare(b2.name));
        if (deals.length) boxes.push({ key: b.key, icon: b.icon, title: b.title, sub: b.sub, deals });
      }
      // Appraisal config box — always shown to the responsible person (even if empty).
      if (wantAppraisal) {
        appraisalDeals.sort((a, b) => a.name.localeCompare(b.name));
        boxes.push({ key: "appraisal", icon: "📐", title: "Appraisals to order", sub: "Contract in · disclosures signed · not ordered yet", deals: appraisalDeals });
      }
      return json({ ok: true, boxes, who });
    }

    // ── Create a new lead ──
    if (body.action === "create") {
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "borrower name required" }, 400);
      const who = (await mondayName(body.userToken, user.id)).toLowerCase();
      const ownerId = LO_MAP[who] || CAROL;
      const assignedName = ownerId === CAROL ? "Carolina Lopez (unassigned)" : (who.replace(/\b\w/g, (c) => c.toUpperCase()));

      const cols: Record<string, unknown> = { [COL_LO]: { personsAndTeams: [{ id: ownerId, kind: "person" }] } };
      const phone = String(body.phone || "").trim();
      const email = String(body.email || "").trim();
      if (phone) cols[COL_PHONE] = { phone: phone.replace(/[^\d+]/g, ""), countryShortName: "US" };
      if (email) cols[COL_EMAIL] = { email, text: email };
      if (body.referralId) cols[COL_REF] = { item_ids: [Number(body.referralId)] };
      if (body.buyerAgentId) cols[COL_BUYER_AGENT] = { item_ids: [Number(body.buyerAgentId)] };
      // Sal's team rule (mirrors the monday automation): L/O = Sal → assign Yhma (LOA) + Alasia (Junior).
      const salTeam = ownerId === SAL_ID;
      if (salTeam) {
        cols[COL_LOA_REVIEW] = { personsAndTeams: [{ id: YHMA_ID, kind: "person" }] };
        cols[COL_JUNIOR] = { personsAndTeams: [{ id: ALASIA_ID, kind: "person" }] };
      }

      const m = `mutation($board:ID!,$group:String!,$name:String!,$cols:JSON!){ create_item(board_id:$board, group_id:$group, item_name:$name, column_values:$cols){ id } }`;
      const res = await mondayGQL(m, { board: LEAD_BOARD, group: NEW_GROUP, name, cols: JSON.stringify(cols) });
      const itemId = res?.create_item?.id;

      const note = String(body.update || "").trim();
      if (itemId && note) {
        await mondayGQL(`mutation($item:ID!,$b:String!){ create_update(item_id:$item, body:$b){ id } }`, { item: itemId, b: note });
      }
      // Notify Yhma + Alasia directly (the automation's own notify fails for API-created items).
      if (salTeam && itemId) {
        const ntext = `New lead added: ${name}${phone ? " · " + phone : ""}`;
        for (const uid of [YHMA_ID, ALASIA_ID]) {
          try {
            await mondayGQL(`mutation($u:ID!,$t:ID!,$txt:String!){ create_notification(user_id:$u, target_id:$t, target_type:Project, text:$txt){ id } }`, { u: uid, t: itemId, txt: ntext });
          } catch (_) { /* best-effort — assignment above is the backup */ }
        }
      }
      return json({ ok: true, lead: { id: String(itemId), name, phone, email, lo: assignedName, stage: "Working On", referral: "" } });
    }

    // ── Create a new Contact (referral partner or buyer agent) on the Contacts board ──
    if (body.action === "createContact") {
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "contact name required" }, 400);
      const cols: Record<string, unknown> = {};
      const phone = String(body.phone || "").trim();
      const email = String(body.email || "").trim();
      if (phone) cols[CONTACT_PHONE] = { phone: phone.replace(/[^\d+]/g, ""), countryShortName: "US" };
      if (email) cols[CONTACT_EMAIL] = { email, text: email };
      const m = `mutation($board:ID!,$name:String!,$cols:JSON!){ create_item(board_id:$board, item_name:$name, column_values:$cols){ id name } }`;
      const res = await mondayGQL(m, { board: CONTACTS_BOARD, name, cols: JSON.stringify(cols) });
      const it = res?.create_item;
      return json({ ok: true, contact: { id: String(it?.id || ""), name: it?.name || name } });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
