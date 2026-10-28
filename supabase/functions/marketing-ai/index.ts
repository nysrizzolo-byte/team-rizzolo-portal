// Supabase Edge Function: marketing-ai
// Co-branded marketing assistant. Given the LEFT + RIGHT people, the material type, and any
// reference files (PDF/PNG/GIF the user drops in), it drafts/adjusts the material and returns
// a self-contained printable HTML draft plus a short chat reply. Iterates on the current draft.
// ADMIN ONLY for now (Sal is piloting it). Reuses ANTHROPIC_API_KEY.
// Request: { userToken, instructions, materialType, left?, right?, references?:[{dataUrl,name}], current?, history? }
// Reply:   { ok, reply, draftHtml|null }
// DEPLOY: new fn "marketing-ai", Verify JWT OFF (we verify userToken ourselves).

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

// Admin-only gate (role 'admin', approved). Opened to the wider team later by relaxing this.
async function approvedAdmin(token: string): Promise<boolean> {
  if (!token || !SB_URL || !SB_ANON) return false;
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const uid = (await u.json())?.id;
    if (!uid) return false;
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=status,role`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!p.ok) return false;
    const row = (await p.json())?.[0];
    return !!row && row.status === "approved" && row.role === "admin";
  } catch (_) { return false; }
}

const MATERIALS: Record<string, string> = {
  "one-pager": "a single-page co-branded flyer (US Letter portrait) — a headline, a short value section, and both people's contact blocks with headshots at the bottom",
  "slideshow": "a short slide outline / deck content (title + 4-8 slides), each slide a heading and 2-4 bullet points",
  "social": "a social media video script — hook, talking points, and a call to action; note which lines are for the LEFT person vs the RIGHT person when it's a dual (two-person) film",
  "openhouse": "open house material — a property flyer / sign rider style sheet with both agents/LO branding",
  "signin": "an open-house sign-in sheet — a titled header with both people's branding and a table (Name, Phone, Email, Agent, Pre-approved? , Notes)",
};

function esc(s: string) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }
function personLine(tag: string, p: any): string {
  if (!p || !p.name) return `${tag}: (none selected)`;
  const bits = [p.name, p.title, p.company, p.phone, p.email, p.nmls].filter(Boolean).join(" · ");
  return `${tag}: ${bits}${p.headshot ? `  [headshot url: ${p.headshot}]` : ""}`;
}
function extractReply(s: string): string | null {
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (!m) return null;
  try { return JSON.parse('"' + m[1] + '"'); } catch (_) { return m[1]; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 400);
    const body = await req.json().catch(() => ({}));
    if (!(await approvedAdmin(body.userToken || ""))) return json({ error: "admins only" }, 401);

    const instructions = String(body.instructions || "").trim();
    const materialType = String(body.materialType || "one-pager");
    const side = String(body.side || "front").toLowerCase() === "back" ? "back" : "front";
    const matDesc = MATERIALS[materialType] || MATERIALS["one-pager"];
    const left = body.left || null, right = body.right || null;
    const refs = Array.isArray(body.references) ? body.references.slice(0, 5) : [];
    if (!instructions && !refs.length) return json({ error: "Type what you want, or drop a reference file." }, 400);

    const messages: any[] = [];
    const hist = Array.isArray(body.history) ? body.history.slice(-10) : [];
    for (const h of hist) {
      const role = h?.role === "assistant" ? "assistant" : "user";
      const text = String(h?.text || "").slice(0, 3000);
      if (text) messages.push({ role, content: text });
    }

    // Current user turn — instructions + context + any reference files.
    const content: any[] = [];
    for (const f of refs) {
      if (f && typeof f.dataUrl === "string") {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(f.dataUrl);
        if (m) {
          const mt = m[1], data = m[2];
          if (mt === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
          else if (/^image\/(png|jpe?g|gif|webp)$/.test(mt)) content.push({ type: "image", source: { type: "base64", media_type: mt, data } });
        }
      }
    }
    const curr = body.current ? String(body.current).slice(0, 20000) : "";
    content.push({ type: "text", text:
      `Material type: ${materialType} — ${matDesc}.\n` +
      `${materialType === "one-pager" || materialType === "openhouse" ? `You are editing the ${side.toUpperCase()} side of this piece.${side === "back" ? " The FRONT already exists separately — design a complementary back (e.g. program details, loan options, testimonials, QR/contact) that pairs with it." : ""}\n` : ""}` +
      `${personLine("LEFT", left)}\n${personLine("RIGHT", right)}\n` +
      `${refs.length ? `Attached ${refs.length} reference file(s) — use them for layout/content inspiration where relevant.\n` : ""}` +
      `\nRequest: ${instructions || "(build the first draft from the references and the people above)"}` +
      `${curr ? `\n\nCURRENT DRAFT HTML (adjust THIS, keep what isn't mentioned):\n${curr}` : ""}` });
    messages.push({ role: "user", content });

    const system = `You are a marketing designer for the "Team Rizzolo" mortgage team at NAF (New American Funding). You create clean, professional, co-branded marketing material that pairs two people — a LEFT person and a RIGHT person (each a loan officer OR a referral real-estate agent).

Brand: primary green #8CC63F, gold #CBA24A, deep navy #0C2340, white. Fonts: system sans (e.g. -apple-system, Segoe UI, Arial). Keep it tasteful and uncluttered — real estate / mortgage marketing, compliant and understated, never spammy.

ALWAYS output ONLY valid minified JSON (no prose, no markdown, no code fences) with EXACTLY this shape:
{"reply":"<your message to the user>","draftHtml":"<the full material as self-contained HTML, or empty string to leave the current draft unchanged>"}

Rules:
- "reply" is ALWAYS present and MUST be short — one or two sentences, plain. Say what you built or changed, or ask ONE clarifying question if you truly need it. Never paste the HTML into "reply".
- "draftHtml": a SINGLE self-contained block of HTML using ONLY inline styles (no <script>, no external CSS, no <html>/<head> wrappers). It will be dropped straight into a preview container and printed. Size it for the material:
  - one-pager / openhouse: a US-Letter portrait sheet — give the outer wrapper width:7.5in; min-height:10in; margin:0 auto; padding:0.4in; box-sizing:border-box; background:#fff; color:#111.
  - signin: a full-width sheet with a branded header and a bordered <table> (Name, Phone, Email, Agent, Pre-approved?, Notes) with ~12 empty rows.
  - slideshow: stack each "slide" as its own bordered 16:9 block (aspect-ratio:16/9) with a heading + bullets.
  - social: a clean script layout — Hook / Body talking points / CTA; for a DUAL film, label lines "LEFT:" and "RIGHT:".
- Use the REAL people data provided (names, titles, company, phone, email, NMLS/license). If a headshot url is given, include it with <img src="that url" style="...;object-fit:cover">. Never invent contact info; leave a field out if it's missing.
- Always include a small compliance footer on letters/flyers: "New American Funding | Equal Housing Lender | NMLS #6606" plus each person's NMLS where applicable.
- When CURRENT DRAFT HTML is provided, EDIT it per the request and keep everything else intact.
- If both people are missing, still build a tasteful draft using placeholders and ask the user to pick Left/Right.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages }),
    });
    const j = await res.json();
    if (!res.ok) return json({ error: "AI error: " + JSON.stringify(j).slice(0, 300) }, 500);
    let txt = (j?.content?.[0]?.text || "").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    let out: any;
    try { out = JSON.parse(txt); } catch (_) {
      const r = extractReply(txt);
      return json({ ok: true, reply: r || "That got cut off — try again or ask for a smaller change.", draftHtml: null });
    }
    const draftHtml = typeof out?.draftHtml === "string" && out.draftHtml.trim() ? out.draftHtml : null;
    const reply = String(out?.reply || (draftHtml ? "Here's the updated draft." : "Tell me a bit more about what you want.")).slice(0, 1200);
    return json({ ok: true, reply, draftHtml });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
