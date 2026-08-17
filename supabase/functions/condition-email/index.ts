// Supabase Edge Function: condition-email
// Generates a warm, copy-paste borrower email from a loan's outstanding conditions —
// simplifying cryptic/jargon condition names into plain English and adding a brief note
// on what to look for. Approved team members only. Reuses ANTHROPIC_API_KEY.
// DEPLOY: new fn "condition-email", Verify JWT OFF (we verify userToken ourselves).

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
async function approvedUser(token: string): Promise<boolean> {
  if (!token || !SB_URL || !SB_ANON) return false;
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const uid = (await u.json())?.id;
    if (!uid) return false;
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=status`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!p.ok) return false;
    return (await p.json())?.[0]?.status === "approved";
  } catch (_) { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 400);
    const body = await req.json().catch(() => ({}));
    if (!(await approvedUser(body.userToken || ""))) return json({ error: "not signed in" }, 401);

    const conditions = (Array.isArray(body.conditions) ? body.conditions : [])
      .filter((c: any) => c && typeof c.name === "string" && c.name.trim())
      .map((c: any) => ({ name: String(c.name).trim(), note: c.note ? String(c.note).trim() : "" }));
    if (!conditions.length) return json({ error: "No conditions to include." }, 400);
    const borrower = String(body.borrower || "").trim() || "the borrower";
    const collector = String(body.collector || "").trim();

    const list = conditions.map((c, i) => `${i + 1}. ${c.name}${c.note ? `  [internal note: ${c.note}]` : ""}`).join("\n");
    const system = `You are a loan condition collector at Team Rizzolo, a mortgage branch. Write a warm, professional, concise email to a borrower listing the outstanding items still needed to move their loan forward.

Rules:
- Simplify any confusing, jargon-heavy, or poorly written condition names into plain English a borrower can actually understand.
- For any item that isn't self-explanatory, add a brief (one short sentence) note on what to provide or look for.
- ONLY include items the borrower is responsible for providing or doing. Silently drop purely internal tasks (e.g. "lock the loan", "run credit", "restructure to review", "order appraisal", internal reviews) — those are not the borrower's job.
- Group logically when it helps (e.g. Income, Assets, Credit, Property) with short headers; otherwise a simple numbered list.
- Friendly and encouraging in tone, never demanding. A short intro, the list, and a short close offering to help with any questions.
- The [internal note] on an item is context for YOU to write a clearer request — never quote it verbatim.
- Output ONLY the finished email: a "Subject:" line, then the body. Ready to copy and paste. No preamble, no explanations, no markdown code fences.`;
    const userMsg = `Borrower: ${borrower}\n${collector ? `Sent by (loan team member): ${collector}\n` : ""}\nOutstanding conditions to turn into a borrower-friendly email:\n${list}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: userMsg }] }),
    });
    const j = await res.json();
    if (!res.ok) return json({ error: "AI error: " + JSON.stringify(j).slice(0, 300) }, 500);
    const email = (j?.content?.[0]?.text || "").trim();
    if (!email) return json({ error: "no email generated" }, 500);
    return json({ ok: true, email });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
