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
async function profileInfo(token: string, id: string): Promise<{ role: string; mondayName: string; grants: string[] }> {
  // Falls back gracefully if visible_account_ids / monday_name columns don't exist yet.
  for (const sel of ["role,monday_name,first_name,last_name,visible_account_ids", "role,monday_name,first_name,last_name", "role,first_name,last_name"]) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=${sel}`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const p = (await r.json())?.[0];
      if (!p) return { role: "", mondayName: "", grants: [] };
      const mondayName = p.monday_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
      const grants = Array.isArray(p.visible_account_ids) ? p.visible_account_ids.map(String) : [];
      return { role: p.role || "", mondayName: (mondayName || "").trim(), grants };
    } catch (_) { /* try next */ }
  }
  return { role: "", mondayName: "", grants: [] };
}

// ── Board wiring ──
type Cfg = { board: string; refCol: string; bizMirror: string; bizPeople: string; loCol: string; ownerCol: string; buyerCol: string; noteCol: string; dateCol: string; valueCol: string; stageCol: string };
const BOARDS: Record<"master" | "lead", Cfg> = {
  master: { board: "6229246816", refCol: "deal_contact", bizMirror: "lookup_mkw3g1w3", bizPeople: "multiple_person_mky8z4g3", loCol: "deal_owner", ownerCol: "lookup_mkw3b9bk", buyerCol: "dup__of_listing_agent__1", noteCol: "long_text_mm526jmv", dateCol: "date", valueCol: "deal_actual_value", stageCol: "deal_stage" },
  lead: { board: "6229246811", refCol: "board_relation_mkw34hbe", bizMirror: "lookup_mkw3ayfc", bizPeople: "multiple_person_mky660ch", loCol: "multiple_person_mky6cr94", ownerCol: "lookup_mkw39vyk", buyerCol: "board_relation_mkw3ftdg", noteCol: "long_text_mm52p1kx", dateCol: "", valueCol: "", stageCol: "" },
};

// ── Realtor-facing funnel (order matters; top → bottom) ──
const FUNNEL = ["New Leads", "Working", "Pre-Qualified", "Pre-Approved", "In Contract", "Submitted to Underwriting", "Approved", "Clear to Close", "Closed"];
// Competing pairs shown on one dashboard (each member logs in → sees both). Easy to extend.
const PAIRS: Record<string, string[]> = {
  "peter grosso": ["Peter Grosso", "Vanessa Johnson"],
  "vanessa johnson": ["Peter Grosso", "Vanessa Johnson"],
};
// LO-override tracker: a Biz Dev who earns an override on an LO they hired sees ONLY that
// LO's active pipeline + closed/funded volume (no lead flow). Keyed by the viewer's monday
// name (lowercased) → the LO names (matched against the Master "LO / Licensed" column).
const LO_OVERRIDES: Record<string, string[]> = {
  "matt porcaro": ["Felix Diaz"],
  "matthew porcaro": ["Felix Diaz"],
};
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
  const ids = [cfg.refCol, cfg.bizMirror, cfg.bizPeople, cfg.loCol, cfg.ownerCol, cfg.buyerCol, cfg.noteCol];
  if (cfg.dateCol) ids.push(cfg.dateCol);
  if (cfg.valueCol) ids.push(cfg.valueCol);
  if (cfg.stageCol) ids.push(cfg.stageCol);
  const idList = ids.map((i) => `"${i}"`).join(",");
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = `query($c:String){ boards(ids:${cfg.board}){ items_page(limit:100, cursor:$c){ cursor items{ id name created_at group{ title } column_values(ids:[${idList}]){ id text ... on MirrorValue { display_value } ... on BoardRelationValue { display_value linked_item_ids } ... on DateValue { date } } } } } }`;
    const d = await mondayGQL(q, { c: cursor });
    const page = d?.boards?.[0]?.items_page;
    if (!page) break;
    out.push(...(page.items || []));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

// ── Accounts board (the org tree) ──
// An Account (a team / brokerage / sphere) groups Contacts; a deal rolls up to an
// account when the deal's Referral Contact is one of that account's contacts.
// Owner = the account's Biz Dev; Override = the upline (e.g. Matt) who sees above it.
const ACC = { board: "6229246832", owner: "multiple_person_mm5awx00", override: "multiple_person_mm5aqfnx", contacts: "account_contact" };
async function loadAccounts(): Promise<any[]> {
  const idList = [ACC.owner, ACC.override, ACC.contacts].map((i) => `"${i}"`).join(",");
  const out: any[] = [];
  let cursor: string | null = null;
  do {
    const q = `query($c:String){ boards(ids:${ACC.board}){ items_page(limit:100, cursor:$c){ cursor items{ id name group{ title } column_values(ids:[${idList}]){ id text ... on BoardRelationValue { display_value linked_item_ids } } } } } }`;
    const d = await mondayGQL(q, { c: cursor });
    const page = d?.boards?.[0]?.items_page;
    if (!page) break;
    out.push(...(page.items || []));
    cursor = page.cursor;
  } while (cursor);
  return out;
}
const nameSet = (t: string) => new Set(String(t || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
// Build: id→account meta, and contactId→[accountIds] so a deal's referral contact maps to its account(s).
function accModel(accounts: any[]) {
  const accById: Record<string, any> = {};
  const contactToAccts: Record<string, string[]> = {};
  for (const a of accounts) {
    const cv = cvMap(a);
    const ownerText = cv[ACC.owner]?.text || "";
    const overrideText = cv[ACC.override]?.text || "";
    const contactIds = (cv[ACC.contacts]?.linked_item_ids || []).map(String);
    // Roster names (split on ", " to survive commas inside a name like "Firm, PLLC").
    const contactNames = String(cv[ACC.contacts]?.display_value || "").split(", ").map((s) => s.trim()).filter(Boolean);
    accById[a.id] = { id: String(a.id), name: a.name, group: a.group?.title || "", ownerText, overrideText, owner: nameSet(ownerText), override: nameSet(overrideText), contactIds: new Set(contactIds), contactNames };
    for (const cid of contactIds) (contactToAccts[cid] = contactToAccts[cid] || []).push(String(a.id));
  }
  return { accById, contactToAccts };
}
const r1 = (n: number) => Math.round(n * 1000) / 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!MONDAY_TOKEN) return json({ error: "MONDAY_API_TOKEN not set" }, 400);
    const body = await req.json().catch(() => ({}));
    const user = await verifyUser(body.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const info = await profileInfo(body.userToken, user.id);
    const isAdmin = info.role === "admin";

    // Roster of Biz Dev people (account owners + override people) — admin "view as" dropdown.
    if (body.action === "people") {
      if (!isAdmin) return json({ error: "admin only" }, 403);
      const names = new Set<string>();
      for (const a of await loadAccounts()) {
        const cv = cvMap(a);
        for (const t of [cv[ACC.owner]?.text || "", cv[ACC.override]?.text || ""]) {
          for (const n of String(t).split(",")) { const x = n.trim(); if (x) names.add(x); }
        }
      }
      return json({ ok: true, people: [...names].sort((a, b) => a.localeCompare(b)) });
    }

    // Whose pipeline? Admin may pass bizDev; everyone else is themselves.
    const who = (isAdmin && body.bizDev ? String(body.bizDev) : info.mondayName).trim();
    if (!who) return json({ ok: true, bizDev: "", note: "not-linked", funnel: [], groups: [], metrics: null });
    const whoLc = who.toLowerCase();

    // Book of business, ACCOUNT-based. A deal rolls up to an account when its Referral
    // Contact is one of that account's contacts. The viewer sees the accounts they OWN
    // (Biz Dev) or OVERRIDE; an admin with no override sees ALL accounts (the full sheet);
    // an admin/grant may pass accountIds to scope to specific accounts (team-leader grant).
    if (body.action === "book") {
      const accounts = await loadAccounts();
      const { accById, contactToAccts } = accModel(accounts);
      const preIdx = FUNNEL.indexOf("Pre-Approved");
      const weekAgo = Date.now() - 7 * 86400 * 1000;
      const grantIds: string[] = Array.isArray(body.accountIds) ? body.accountIds.map(String) : [];

      // Which accounts are visible, and in what scope?
      // Admin may preview specific accounts via grantIds; otherwise a viewer sees the accounts
      // they own/override (by monday name) PLUS any accounts granted to their login
      // (profiles.visible_account_ids — the referral-partner team-leader grant).
      let visibleIds: string[]; let scope: string;
      if (grantIds.length && isAdmin) {
        visibleIds = grantIds.filter((id) => accById[id]); scope = "granted";
      } else if (isAdmin && !body.bizDev) {
        visibleIds = Object.keys(accById); scope = "all";
      } else {
        const owned = Object.values(accById).filter((a: any) => a.owner.has(whoLc) || a.override.has(whoLc)).map((a: any) => a.id);
        const granted = (info.grants || []).map(String).filter((id) => accById[id]);
        visibleIds = [...new Set([...owned, ...granted])]; scope = "owned";
      }
      const acc: Record<string, any> = {};
      for (const id of visibleIds) {
        const a = accById[id];
        const role = a.owner.has(whoLc) ? "owner" : a.override.has(whoLc) ? "override" : (scope === "all" ? "all" : "granted");
        acc[id] = { id, name: a.name, group: a.group, ownerText: a.ownerText, overrideText: a.overrideText, role, contactNames: a.contactNames || [], byContact: {}, m: { closed: 0, closedVolume: 0, lost: 0, inProgress: 0, preApproved: 0, broughtThisWeek: 0 } };
      }
      // A specific viewer also sees deals where THEY are directly the Biz Dev on the lead/master
      // board (people or mirror column) — even if the deal isn't in one of their accounts.
      const directId = scope === "owned" ? "__direct__" : null;
      if (directId) acc[directId] = { id: directId, name: "Deals you're the Biz Dev on", group: "", ownerText: "", overrideText: "", role: "direct", contactNames: [], byContact: {}, m: { closed: 0, closedVolume: 0, lost: 0, inProgress: 0, preApproved: 0, broughtThisWeek: 0 } };
      const bump = (o: any, dead: boolean, bucket: string, isPre: boolean, val: number, newWk: boolean) => {
        if (dead) o.lost++; else if (bucket === "Closed") { o.closed++; if (o.closedVolume !== undefined) o.closedVolume += val; } else o.inProgress++;
        if (isPre) o.preApproved++;
        if (newWk && o.broughtThisWeek !== undefined) o.broughtThisWeek++;
      };
      // LO-override tracker (e.g. Matt overrides Felix): active pipeline + closed volume only.
      const loNames = LO_OVERRIDES[whoLc] || [];
      const loTrack: Record<string, any> = {};
      for (const n of loNames) loTrack[n] = { name: n, active: { count: 0, volume: 0 }, closed: { count: 0, volume: 0 }, deals: [] };
      for (const key of ["master", "lead"] as const) {
        const cfg = BOARDS[key];
        for (const it of await scanBoard(cfg)) {
          const cv = cvMap(it);
          const groupTitle = it.group?.title || "";
          const stageText = cfg.stageCol ? (cv[cfg.stageCol]?.text || "") : "";
          const bucket = key === "lead" ? classifyLead(groupTitle) : classifyMaster(stageText, groupTitle);
          if (bucket === "") continue; // parked
          const dead = bucket === "__dead__";
          const val = cfg.valueCol ? Number((cv[cfg.valueCol]?.text || "0").replace(/[^0-9.]/g, "")) || 0 : 0;
          // LO-override tracker — master only, this LO's active + closed deals (skip dead).
          if (key === "master" && loNames.length) {
            const loText = (cv[cfg.loCol]?.text || "").toLowerCase();
            const lo = loNames.find((n) => loText.includes(n.toLowerCase()));
            if (lo && !dead) {
              const T = loTrack[lo];
              const row = { name: it.name, stage: stageText || (bucket === "Closed" ? "Closed / Funded" : "Active"), value: val, closeDate: cfg.dateCol ? (cv[cfg.dateCol]?.date || "") : "", status: bucket === "Closed" ? "closed" : "active" };
              if (bucket === "Closed") { T.closed.count++; T.closed.volume += val; } else { T.active.count++; T.active.volume += val; }
              T.deals.push(row);
            }
          }
          const refIds = (cv[cfg.refCol]?.linked_item_ids || []).map(String);
          const hit = new Set<string>();
          for (const cid of refIds) for (const aid of (contactToAccts[cid] || [])) if (acc[aid]) hit.add(aid);
          // Direct Biz Dev: the viewer is in this deal's Biz Dev column (people or mirror).
          const direct = !!directId && bizNames(cv, cfg).some((n) => n.toLowerCase() === whoLc);
          if (!hit.size && !direct) continue;
          // Real accounts win; the "__direct__" catch-all only holds biz-dev deals not in one.
          const targets = hit.size ? [...hit] : [directId as string];
          const isPre = !dead && (key === "master" || FUNNEL.indexOf(bucket) >= preIdx);
          const created = it.created_at || "";
          const newWk = created ? (new Date(created).getTime() >= weekAgo) : false;
          const contactName = (cv[cfg.refCol]?.display_value || "").trim() || "—";
          const deal = {
            name: it.name, board: key, contact: contactName,
            stage: key === "lead" ? groupTitle : (stageText || groupTitle),
            bucket: dead ? "Dead" : bucket,
            owner: cv[cfg.ownerCol]?.display_value || cv[cfg.ownerCol]?.text || "",
            lo: cv[cfg.loCol]?.text || "",
            buyerAgent: cv[cfg.buyerCol]?.display_value || cv[cfg.buyerCol]?.text || "",
            note: cv[cfg.noteCol]?.text || "",
            closeDate: cfg.dateCol ? (cv[cfg.dateCol]?.date || "") : "",
            created, value: val, dead,
          };
          for (const aid of targets) {
            const A = acc[aid];
            bump(A.m, dead, bucket, isPre, val, newWk);
            const c = (A.byContact[contactName] = A.byContact[contactName] || { contact: contactName, deals: [], closed: 0, lost: 0, inProgress: 0, preApproved: 0 });
            bump(c, dead, bucket, isPre, 0, false);
            c.deals.push(deal);
          }
        }
      }
      const outIds = [...visibleIds];
      if (directId && Object.keys(acc[directId].byContact).length) outIds.push(directId);
      const accountsOut = outIds.map((id) => {
        const A = acc[id]; const m = A.m; const t = m.closed + m.inProgress + m.lost;
        const partners = Object.values(A.byContact).map((c: any) => {
          const ct = c.closed + c.inProgress + c.lost;
          return { ...c, count: c.deals.length, convPct: ct ? r1(c.preApproved / ct) : 0, deals: c.deals.sort((a: any, b: any) => a.name.localeCompare(b.name)) };
        }).sort((a: any, b: any) => b.count - a.count || a.contact.localeCompare(b.contact));
        // Roster = every contact under this account (from account_contact), each tagged with
        // its deal stats if any — producers first, then the quiet ones, alphabetical.
        const byName: Record<string, any> = {};
        for (const p of partners) byName[p.contact.toLowerCase()] = p;
        const seen = new Set<string>();
        const roster: any[] = [];
        for (const nm of A.contactNames) { const k = nm.toLowerCase(); if (seen.has(k)) continue; seen.add(k); const p = byName[k]; roster.push({ name: nm, deals: p ? p.count : 0, active: p ? (p.inProgress) : 0, closed: p ? p.closed : 0, preApproved: p ? p.preApproved : 0 }); }
        for (const p of partners) { const k = p.contact.toLowerCase(); if (seen.has(k)) continue; seen.add(k); roster.push({ name: p.contact, deals: p.count, active: p.inProgress, closed: p.closed, preApproved: p.preApproved }); }
        roster.sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));
        return {
          id: A.id, name: A.name, group: A.group, role: A.role, ownerText: A.ownerText, overrideText: A.overrideText, partners, roster,
          metrics: { brought: t, broughtThisWeek: m.broughtThisWeek, preApproved: m.preApproved, closed: m.closed, closedVolume: m.closedVolume, inProgress: m.inProgress, lost: m.lost, conversionPct: t ? r1(m.preApproved / t) : 0, pullThrough: t ? r1(m.closed / t) : 0 },
        };
      }).sort((a, b) => b.metrics.brought - a.metrics.brought || a.name.localeCompare(b.name));
      const T = accountsOut.reduce((o, a) => { const m = a.metrics; o.brought += m.brought; o.broughtThisWeek += m.broughtThisWeek; o.preApproved += m.preApproved; o.closed += m.closed; o.closedVolume += m.closedVolume; o.inProgress += m.inProgress; o.lost += m.lost; return o; }, { brought: 0, broughtThisWeek: 0, preApproved: 0, closed: 0, closedVolume: 0, inProgress: 0, lost: 0 });
      const totals = { ...T, accounts: accountsOut.length, conversionPct: T.brought ? r1(T.preApproved / T.brought) : 0, pullThrough: T.brought ? r1(T.closed / T.brought) : 0 };
      const loTracker = loNames.length
        ? { los: loNames.map((n) => { const t2 = loTrack[n]; t2.deals.sort((a: any, b: any) => a.status.localeCompare(b.status) || (b.closeDate || "").localeCompare(a.closeDate || "") || a.name.localeCompare(b.name)); return t2; }) }
        : null;
      return json({ ok: true, viewer: who, scope, matchedBy: isAdmin && body.bizDev ? "admin" : "self", accounts: accountsOut, totals, loTracker });
    }

    // Accounts roster (admin) — for the referral-partner "grant visibility" dropdown.
    if (body.action === "accounts") {
      if (!isAdmin) return json({ error: "admin only" }, 403);
      const list = accModel(await loadAccounts()).accById;
      const accounts = Object.values(list).map((a: any) => ({ id: a.id, name: a.name, group: a.group, owner: a.ownerText, override: a.overrideText, contacts: a.contactIds.size }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      return json({ ok: true, accounts });
    }

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
