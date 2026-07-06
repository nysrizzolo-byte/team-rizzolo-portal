// Supabase Edge Function: render-preapproval
// Gated pre-approval letter renderer. Verifies the caller is a signed-in, APPROVED
// team member (their Supabase token), then returns a print-ready letter for the chosen
// loan officer. Generation is auth-gated — a request without a valid session gets 401.
// Image assets are served as normal site files (pa-assets/*): logos + marketing
// headshots, which appear on every issued letter anyway.
//
// Env: SUPABASE_URL + SUPABASE_ANON_KEY (auto-injected). DEPLOY: new fn
// "render-preapproval", Verify JWT OFF (we verify the userToken ourselves).

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ASSETS = "https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
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
async function profileStatus(token: string, id: string): Promise<string> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=status`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return "";
    const p = (await r.json())?.[0];
    return p?.status || "";
  } catch (_) { return ""; }
}

const NAF = `${ASSETS}/naf.png`;
const RIZ = `${ASSETS}/riz.png`;

type Officer = { id: string; name: string; title: string; nmls: string; phone: string; email: string; prep: string; headshot: string };
// ---- LOAN OFFICER ROSTER (add a teammate = append an entry; drop their headshot in pa-assets/) ----
const OFFICERS: Officer[] = [
  { id: "james", name: "James Codomo", title: "Licensed Loan Officer Assistant", nmls: "1737350", phone: "631.889.7075", email: "James.Codomo@nafinc.com", prep: "Prepared exclusively for you by Team Rizzolo", headshot: `${ASSETS}/james.png` },
  { id: "sal", name: "Salvatore Rizzolo", title: "Branch Manager", nmls: "1489171", phone: "(631) 946-0654", email: "sal.rizzolo@nafinc.com", prep: "Prepared exclusively for you by Team Rizzolo", headshot: `${ASSETS}/sal.png` },
  { id: "theresa", name: "Theresa Feehan", title: "Senior Loan Officer", nmls: "1903644", phone: "(631) 521-5667", email: "theresa.feehan@nafinc.com", prep: "Prepared exclusively for you by Team Rizzolo", headshot: `${ASSETS}/theresa.png` },
  { id: "yhma", name: "Yhma Karimy", title: "Senior Loan Officer", nmls: "2128896", phone: "631.357.0085", email: "yhma.karimy@nafinc.com", prep: "Prepared exclusively for you by Team Rizzolo", headshot: `${ASSETS}/yhma.png` },
  { id: "rich", name: "Richard Luxmore", title: "Loan Consultant", nmls: "2021785", phone: "(631) 769-2445", email: "Richard.Luxmore@nafinc.com", prep: "Prepared exclusively for you by Team Rizzolo", headshot: "" },
];

const TPL = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--navy:#161f4d;--muted:#8b90a3;--line:#e4e6ef;--ink:#1c2447}
*{box-sizing:border-box}html,body{margin:0}
body{background:#f2f3f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.letter{width:8.5in;min-height:11in;background:#fff;margin:0 auto;padding:.5in .55in .6in;color:var(--ink);font-size:11pt;line-height:1.4;display:flex;flex-direction:column}
.lhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.lhead .naf{height:78px}
.lhead .badge{background:var(--navy);color:#fff;border-radius:13px;padding:14px 28px;text-align:right;line-height:1.12}
.lhead .badge .k{font-size:12pt;letter-spacing:3px;opacity:.75}
.lhead .badge .b{font-size:26pt;font-weight:800;letter-spacing:1px}
.hr{height:2px;background:var(--navy);opacity:.12;margin:6px 0 14px}
.namerow{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px}
.namerow .nm{font-size:20pt;font-weight:800;color:var(--navy);line-height:1}
.namerow .pr{font-size:9.5pt;color:var(--muted);margin-top:4px}
.namerow .iss{text-align:right;font-size:9pt;color:var(--muted)}
.namerow .iss b{display:block;font-size:11pt;color:var(--ink);font-weight:700}
.intro{font-size:10pt;margin:0 0 24px}.intro b{color:var(--navy)}
.barbar{background:var(--navy);color:#fff;font-weight:800;font-size:10.5pt;letter-spacing:1.5px;padding:7px 12px;border-radius:6px 6px 0 0}
.grid{border:1px solid var(--line);border-top:none;border-radius:0 0 6px 6px;display:grid;grid-template-columns:1fr 1fr}
.cell{padding:11px 14px;border-top:1px solid var(--line)}
.cell:nth-child(1),.cell:nth-child(2){border-top:none}
.cell:nth-child(odd){border-right:1px solid var(--line)}
.cell .k{font-size:8pt;font-weight:700;letter-spacing:.6px;color:var(--muted);text-transform:uppercase}
.cell .v{font-size:13pt;font-weight:800;color:var(--navy);margin-top:2px}
.cell .v small{font-size:9pt;font-weight:700;color:var(--muted)}
.cell .v .dp{color:var(--muted);font-weight:700;font-size:10pt;margin-left:6px}
.condbox{background:#f4f5fa;border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:24px 0 16px}
.condbox .lead{font-size:9pt;color:var(--ink);margin:0 0 10px}
.icons{display:flex;justify-content:space-between;gap:6px;text-align:center}
.icons .i{flex:1}.icons svg{width:22px;height:22px;stroke:var(--navy);fill:none;stroke-width:1.7}
.icons .l{font-size:7.7pt;font-weight:700;color:var(--navy);margin-top:4px;line-height:1.1}
.disc{font-size:6.8pt;color:var(--muted);line-height:1.45;margin:0 0 8px}
.sig{display:flex;justify-content:space-between;align-items:center;border-top:2px solid var(--line);padding-top:24px;margin-top:auto}
.sig .who{display:flex;align-items:center;gap:16px}
.sig .who img.hs{width:104px;height:104px;border-radius:50%;object-fit:cover}
.sig .nm{font-size:15pt;font-weight:800;color:var(--navy)}
.sig .ti{font-size:9.5pt;color:var(--ink)}
.sig .co{font-size:9.5pt;color:var(--muted);margin-top:3px}.sig .co b{color:var(--ink)}
.sig .riz{height:70px}
@media print{@page{size:Letter;margin:0}body{background:#fff}.letter{margin:0;width:auto;min-height:10.7in;padding:.45in .5in .55in}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="letter">
 <div class="lhead"><img class="naf" src="%%NAF%%" alt="New American Funding"><div class="badge"><div class="k">MORTGAGE</div><div class="b">PRE-APPROVAL</div></div></div>
 <div class="hr"></div>
 <div class="namerow"><div><div class="nm">%%NAME%%</div><div class="pr">%%PREP%%</div></div><div class="iss">Issued<b>%%DATE%%</b></div></div>
 <p class="intro">Team Rizzolo at New American Funding is pleased to provide you a Pre-Approval for your purchase of the following location: <b>%%LOC%%</b>. We have determined the following loan characteristics to be the most beneficial to you, and within your optimal qualifications based on the documentation and information provided.</p>
 <div class="barbar">LOAN SUMMARY</div>
 <div class="grid">
  <div class="cell"><div class="k">LOAN PROGRAM</div><div class="v">%%PROG%%</div></div>
  <div class="cell"><div class="k">PROPERTY TYPE</div><div class="v">%%PTYPE%%</div></div>
  <div class="cell"><div class="k">PURCHASE PRICE</div><div class="v">%%PRICE%%</div></div>
  <div class="cell"><div class="k">PROPERTY USE</div><div class="v">%%USE%%</div></div>
  <div class="cell"><div class="k">DOWN PAYMENT</div><div class="v"><span>%%DPPCT%%</span><span class="dp">%%DPAMT%%</span></div></div>
  <div class="cell"><div class="k">ANNUAL TAXES</div><div class="v">%%TAX%%<small> /yr</small></div></div>
  <div class="cell"><div class="k">BASE LOAN AMOUNT</div><div class="v">%%BASE%%</div></div>
  <div class="cell"><div class="k">ANNUAL INSURANCE</div><div class="v">%%INS%%<small> /yr</small></div></div>
 </div>
 <div class="condbox"><p class="lead">Our conditional approval is based on an underwritten review and verification of the following information and documentation:</p>
  <div class="icons">
   <div class="i"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.6-2.5 1.6-2.5.7-2.5 1.7 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/></svg><div class="l">Income</div></div>
   <div class="i"><svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5M4 9v10h16V9M8 12v4M12 12v4M16 12v4M3 20h18"/></svg><div class="l">Assets</div></div>
   <div class="i"><svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5"/></svg><div class="l">Residency</div></div>
   <div class="i"><svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/></svg><div class="l">Employment History</div></div>
   <div class="i"><svg viewBox="0 0 24 24"><path d="M3 20a9 9 0 0118 0"/><path d="M12 20l4-6"/><circle cx="12" cy="20" r="1.3" fill="currentColor" stroke="none"/></svg><div class="l">Credit History / Credit Score</div></div>
  </div></div>
 <p class="disc">This Conditional Approval is not a final commitment. At this time the property appraisal has not been ordered. As long as there are no adverse changes in credit or income status, the property value and condition are acceptable, and clarifications or supporting details that may be required after receipt of the above information are found acceptable, a formal Commitment Letter will be issued following receipt of a fully executed contract of sale.</p>
 <div class="sig"><div class="who">%%HS_IMG%%<div><div class="nm">%%SNAME%%</div><div class="ti">%%STITLE%% · NMLS ID %%SNMLS%%</div><div class="co">Office <b>%%SPHONE%%</b> · Email <b>%%SEMAIL%%</b></div></div></div><img class="riz" src="%%RIZ%%" alt="Team Rizzolo"></div>
</div>
</body></html>`;

function render(f: Record<string, string>, o: Officer): string {
  const map: Record<string, string> = {
    "%%NAME%%": esc(f.name || "Borrower Name"),
    "%%PREP%%": esc(o.prep),
    "%%DATE%%": esc(f.date || ""),
    "%%LOC%%": esc(f.loc || "To Be Determined"),
    "%%PROG%%": esc(f.prog || ""),
    "%%PTYPE%%": esc(f.ptype || ""),
    "%%USE%%": esc(f.use || ""),
    "%%PRICE%%": esc(f.price || ""),
    "%%DPPCT%%": esc(f.dppct || ""),
    "%%DPAMT%%": esc(f.dpamt || ""),
    "%%BASE%%": esc(f.base || ""),
    "%%TAX%%": esc(f.tax || ""),
    "%%INS%%": esc(f.ins || ""),
    "%%SNAME%%": esc(o.name),
    "%%STITLE%%": esc(o.title),
    "%%SNMLS%%": esc(o.nmls),
    "%%SPHONE%%": esc(o.phone),
    "%%SEMAIL%%": esc(o.email),
    "%%HS_IMG%%": o.headshot ? `<img class="hs" src="${o.headshot}" alt="">` : "",
    "%%NAF%%": NAF,
    "%%RIZ%%": RIZ,
  };
  let h = TPL;
  for (const k in map) h = h.split(k).join(map[k]);
  return h;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const user = await verifyUser(b.userToken || "");
    if (!user) return json({ error: "not signed in" }, 401);
    const status = await profileStatus(b.userToken, user.id);
    if (status !== "approved") return json({ error: "not an approved team member" }, 403);
    if (b.action === "officers") {
      return json({ ok: true, officers: OFFICERS.map((o) => ({ id: o.id, name: o.name, title: o.title })) });
    }
    const o = OFFICERS.find((x) => x.id === b.officerId) || OFFICERS[0];
    return json({ ok: true, html: render(b.fields || {}, o) });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
