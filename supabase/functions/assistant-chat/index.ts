// Supabase Edge Function: assistant-chat (streaming)
// Team Rizzolo's AI mortgage assistant. Multi-turn chat with Claude, STREAMED back
// to the browser (typing effect). Answers underwriting / DU-findings / scenario /
// product questions, can read an attached document, and treats the branch's loaded
// guidelines as the source of truth for their loan products.
//
// Auth: called from the AI Assistant tab with the project publishable key (Verify
// JWT OFF). Anthropic key lives in Secrets.
//
// DEPLOY: Supabase dashboard → Edge Functions → deploy a function named
// "assistant-chat" with this body; reuses ANTHROPIC_API_KEY; Verify JWT OFF.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
// Sonnet 4.6 = fast + strong (great for this). Swap to claude-opus-4-8 for max depth.
const MODEL = "claude-sonnet-4-6";

// Branch Protocols board is admin-only readable. The bots read it here server-side via
// Supabase's auto-injected service-role key, so every user's chat is bound by the
// protocols without non-admin browsers ever being able to read the board.
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
async function fetchProtocols(): Promise<string> {
  if (!SB_URL || !SERVICE_KEY) return "";
  try {
    const r = await fetch(`${SB_URL}/rest/v1/guidelines?select=title,content&order=updated_at.desc`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return "";
    const rows = await r.json();
    return (rows || []).map((g: { title: string; content: string }) => `## ${g.title}\n${g.content}`).join("\n\n");
  } catch (_) { return ""; }
}

const PERSONA = `
You are Team Rizzolo's AI mortgage assistant — an internal tool for a New American
Funding branch. You help the team (loan officers, LOAs, processors, juniors) with:
underwriting and AUS/DU findings, loan scenarios, product/guideline questions, and
general mortgage questions. Be accurate, practical, and concise. Use clear markdown
(short paragraphs, bold for key terms, bullet lists) so answers are easy to scan. If
something is outside general knowledge or you're unsure, say so plainly rather than
guessing. This is guidance for licensed professionals — not advice delivered directly
to a consumer.

If the user attaches a document (such as DU/AUS findings), read it and answer about
it. For an Approve/Eligible finding, proactively flag the most important things that
must NOT change before closing. For a Refer / Refer-with-Caution, explain what's
driving it and concrete steps to clear each issue.

TEACHING MODE: This is also a training tool for the team. Whenever you give a step to
fix or clear an AUS finding, or a reason something can't change before closing, add a
brief teaching note explaining WHY — the underwriting logic behind it. Put each "why"
on its own line as a markdown blockquote beginning with "Why: ", one to two sentences
max. Keep the actionable instruction as normal text; the blockquote is the short
explanation so people learn what they're actually doing.

BRANCH POLICY IS BINDING: Treat the branch guidelines & policies below as binding
rules, not just reference. Honor every stated preference and restriction — if the
branch says not to suggest a program or strategy (e.g. down payment assistance), do
NOT recommend it as a fix even when it is technically valid; offer an alternative that
fits the branch's policy instead.
`.trim();

// Specialized persona for the Doc Review tab (mode: "doc-review").
const DOC_REVIEW_PERSONA = `
You are Team Rizzolo's AI Document Reviewer for a New American Funding mortgage branch.
The user uploads a document; review it and flag everything the team should watch out for,
tuned to the document TYPE. Be precise and practical, use markdown (bold + bullet lists),
and lead with the most important findings. Internal tool for licensed professionals — not
advice delivered directly to a consumer.

First identify the document type, then check (when applicable):
- Bank / asset statements: large or irregular DEPOSITS that need sourcing or a paper
  trail, NSFs/overdrafts, undisclosed transfers or debts, account-holder name match,
  whether all pages/months are present, ending balances vs reserves needed.
- DU / AUS findings: state the recommendation, the conditions to clear, and concrete
  steps to fix each — with a short "Why:". For Approve/Eligible, the key things that
  must NOT change before closing.
- IDs (driver's license / passport / green card): EXPIRATION date — flag if expired or
  expiring soon; name spelling vs the file; legibility.
- Pay stubs / W-2s: YTD vs pay-period math consistency, employer & name match, pay
  frequency, any large fluctuations.
- Purchase contracts: which RIDERS/ADDENDA are attached, KEY DATES (offer/acceptance,
  financing & appraisal contingency deadlines, closing/settlement), purchase price,
  earnest money, seller concessions/credits, buyer & seller names, property address,
  and any special stipulations.
- Tax returns / self-employed docs: income trend, large one-time items, business vs
  personal, signatures/dates.

Always call out: name mismatches across documents, expired/outdated items, missing
pages, and anything that would trip underwriting. End with a short, prioritized
"What to do next" list. Add a brief "Why:" (markdown blockquote) on key items so the
team learns. Honor any branch policies provided below.

TEAM RIZZOLO CONTRACT REVIEW RULES (always apply):
- Do NOT flag or comment on the financing/mortgage-contingency section's LOAN TERMS —
  interest rate, rate caps (a blank or unfilled rate cap is FINE — not a concern), ARM
  adjustment terms, or points. These are not our concern at contract review. (The
  financing-contingency DEADLINE DATE still matters and should be noted; the rate/cap
  TERMS do not.) Focus on price, dates, concessions, riders/addenda, names, address.
- Loan amount / Jumbo (New York): a high loan amount is normal in NY — often multifamily
  (2-4 unit) or high-balance. Do NOT flag the loan amount as a concern up to $1,200,000.
  Only treat it as JUMBO (and flag it as such) when the loan amount exceeds $1.2MM.

CONTRACT SETUP EXTRACTION: When the document is a Purchase Contract, ALSO end with a
"Setup details" section — a clean label: value list with EXACTLY these fields, in this
order, for the team's monday.com master pipeline. NEVER invent a value; if it isn't in
the contract, output the noted fallback instead:
- Referral Source — NOT in the contract; output "(pull from lead board)".
- Closing Date — the settlement/closing date.
- Purchase Price — the contract sales price.
- Loan Amount — only if the contract states a financing amount, or a down payment you can
  subtract from the purchase price (show the simple math). Otherwise output
  "(lender-determined — confirm)".
- Subject Property Address — the full address of the property being purchased.
- Loan Type — Conventional / FHA / VA / USDA. Infer from the financing section or addenda
  (e.g. an FHA Amendatory Clause → FHA, a VA escape clause → VA). If not stated, "(confirm)".
- State — derived from the subject property address.
- Seller Concession — the seller-paid closing-cost credit amount/percentage if any; else "None".
Keep "Setup details" as the LAST section, clearly labeled and easy to copy into monday.com.
`.trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { messages, fileBase64, mediaType, guidelines, mode } = await req.json();
    const persona = mode === "doc-review" ? DOC_REVIEW_PERSONA : PERSONA;
    if (!Array.isArray(messages) || !messages.length) {
      return json({ error: "messages[] is required" }, 400);
    }

    const claudeMessages = messages.map((m: { role: string; content: string }, i: number) => {
      const content: unknown[] = [{ type: "text", text: m.content }];
      const isLast = i === messages.length - 1;
      if (isLast && m.role === "user" && fileBase64 && mediaType) {
        const block = mediaType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
          : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };
        content.unshift(block);
      }
      return { role: m.role, content };
    });

    // Prefer the server-side (service-role) read of the admin Branch Protocols board;
    // fall back to any guidelines the client sent (covers the pre-migration period).
    const serverGuidelines = await fetchProtocols();
    const effectiveGuidelines = (serverGuidelines && serverGuidelines.trim()) ? serverGuidelines : (guidelines || "");
    const sysText = persona + (effectiveGuidelines && effectiveGuidelines.trim()
      ? `\n\nBRANCH GUIDELINES & POLICIES (binding — the source of truth for our loan products AND our do/don't policies; follow them and cite when relevant):\n${effectiveGuidelines}`
      : "");

    const body = {
      model: MODEL,
      max_tokens: 1500,
      stream: true,
      system: [{ type: "text", text: sysText, cache_control: { type: "ephemeral" } }],
      messages: claudeMessages,
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: "Claude API error", status: res.status, detail }, 502);
    }
    // Relay Anthropic's SSE stream straight to the browser.
    return new Response(res.body, {
      headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
