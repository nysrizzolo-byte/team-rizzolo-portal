// Supabase Edge Function: bs-income
// Reads ONE business bank statement (PDF/image) and returns a structured summary the
// portal uses to compute bank-statement-loan income. The client sends statements one at
// a time, assembles them, checks the 12/24-month window is complete, then does the math.
// We flag deposits that look like transfers / non-revenue so the processor can run a
// worst-case (transfers removed) WITHOUT hand-verifying each one.
//
// Approved STAFF only (role employee or admin — not bizdev/partner/client). Reuses ANTHROPIC_API_KEY.
// Request: { userToken, file:{dataUrl,name} }
// Reply:   { ok, statement:{...} }  |  { error }
// DEPLOY: new fn "bs-income", Verify JWT OFF (we verify userToken ourselves).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";
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

// Staff gate — approved profile whose role is employee or admin (excludes bizdev/partner/client).
async function approvedStaff(token: string): Promise<boolean> {
  if (!token || !SB_URL || !SB_ANON) return false;
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const uid = (await u.json())?.id;
    if (!uid) return false;
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=status,role`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!p.ok) return false;
    const row = (await p.json())?.[0];
    return !!row && row.status === "approved" && (row.role === "employee" || row.role === "admin");
  } catch (_) { return false; }
}

function num(x: unknown): number {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 400);
    const body = await req.json().catch(() => ({}));
    if (!(await approvedStaff(body.userToken || ""))) return json({ error: "not signed in" }, 401);

    const file = body.file; // { dataUrl, name }
    if (!file || typeof file.dataUrl !== "string") return json({ error: "No statement file provided." }, 400);
    const m = /^data:([^;]+);base64,(.*)$/s.exec(file.dataUrl);
    if (!m) return json({ error: "Could not read the file." }, 400);
    const mt = m[1], data = m[2];

    const content: any[] = [];
    if (mt === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    else if (mt.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: mt, data } });
    else return json({ error: "Attach a PDF or image bank statement." }, 400);

    content.push({ type: "text", text:
      `This is one monthly business bank statement${file.name ? ` (file: ${file.name})` : ""}. Extract the figures below and return ONLY the JSON object.` });

    const system = `You read ONE monthly U.S. business bank statement and return a precise JSON summary used to qualify a self-employed borrower for a bank-statement mortgage. Be exact with money.

Return ONLY valid minified JSON (no prose, no markdown, no code fences) with EXACTLY this shape:
{"bank":"","account_last4":"","period_start":"YYYY-MM-DD","period_end":"YYYY-MM-DD","statement_month":0,"statement_year":0,"total_deposits":0,"deposit_count":0,"beginning_balance":0,"ending_balance":0,"transfers":[{"date":"YYYY-MM-DD","description":"","amount":0}],"transfer_total":0,"confidence":"high","issues":""}

Rules:
- "bank": institution name. "account_last4": last 4 digits of the account number (digits only; "" if not shown).
- "period_start"/"period_end": the statement period dates. "statement_month" (1-12) and "statement_year" = the month/year of period_end (the month this statement represents).
- "total_deposits": the TOTAL of all deposits / credits / additions for the period. Prefer the statement's own printed "Total deposits" / "Deposits and additions" / "Total credits" figure. If no total is printed, sum every credit in the transactions. This is money IN only — never include the beginning balance, interest-only lines are fine to include. Exclude debits/withdrawals/checks.
- "deposit_count": number of individual deposit/credit transactions.
- "transfers": list EVERY deposit that is likely NOT business revenue — money that merely moved in rather than being earned. Include: transfers from another account ("Transfer from", "Online Transfer", "From Checking/Savings ####", "Internal Transfer"), owner contributions / capital injections, Zelle/Venmo/PayPal clearly from the owner or self, loan or line-of-credit advances, credit-card funding, deposit reversals / returned-item credits, refunds, and obvious one-time non-revenue. Give each a date, the statement's description, and the amount. Be reasonable, not aggressive — only flag what genuinely reads as a transfer/non-revenue. Normal customer payments, merchant/card settlements (Stripe, Square, ACH from customers), and payroll-type business income are NOT transfers.
- "transfer_total": sum of the "transfers" amounts. These amounts ARE part of total_deposits (do not subtract them from total_deposits here — the app subtracts them for the worst-case).
- "beginning_balance"/"ending_balance": from the statement; 0 if unreadable.
- "confidence": "high" if the period, account, and deposit total are all clearly legible; "medium" if you inferred the total by summing; "low" if pages look cut off or figures are unclear.
- "issues": short note on anything wrong (e.g. "summary page only — no transaction detail", "page appears cut off"); "" if clean.
All amounts are plain numbers (no $ or commas). Use 0 for anything you cannot find.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, messages: [{ role: "user", content }] }),
    });
    const j = await res.json();
    if (!res.ok) return json({ error: "AI error: " + JSON.stringify(j).slice(0, 300) }, 500);
    let txt = (j?.content?.[0]?.text || "").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    let out: any;
    try { out = JSON.parse(txt); } catch (_) {
      return json({ error: "Could not parse this statement — try re-uploading a clearer copy." }, 200);
    }

    // Normalize + sanitize so the client math is safe.
    const transfers = Array.isArray(out.transfers) ? out.transfers
      .filter((t: any) => t && (t.amount || t.description))
      .map((t: any) => ({ date: String(t.date || "").slice(0, 10), description: String(t.description || "").slice(0, 160), amount: Math.max(0, num(t.amount)) }))
      : [];
    const transferTotal = out.transfer_total != null ? Math.max(0, num(out.transfer_total)) : transfers.reduce((s: number, t: any) => s + t.amount, 0);

    const statement = {
      bank: String(out.bank || "").slice(0, 80),
      account_last4: String(out.account_last4 || "").replace(/\D/g, "").slice(-4),
      period_start: String(out.period_start || "").slice(0, 10),
      period_end: String(out.period_end || "").slice(0, 10),
      statement_month: Math.min(12, Math.max(0, Math.round(num(out.statement_month)))),
      statement_year: Math.round(num(out.statement_year)),
      total_deposits: Math.max(0, num(out.total_deposits)),
      deposit_count: Math.max(0, Math.round(num(out.deposit_count))),
      beginning_balance: num(out.beginning_balance),
      ending_balance: num(out.ending_balance),
      transfers,
      transfer_total: transferTotal,
      confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "medium",
      issues: String(out.issues || "").slice(0, 240),
    };
    return json({ ok: true, statement });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
