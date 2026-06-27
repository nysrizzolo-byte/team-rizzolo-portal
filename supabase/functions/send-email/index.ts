// Supabase Edge Function: send-email
// Admin email composer for the portal. Two actions:
//   action:"draft" {notes} -> Claude writes a friendly "what's new" team email -> {subject, body}
//   action:"send"  {subject, body} -> emails ALL approved members (BCC) via Gmail SMTP
// Admin-gated: caller must pass their Supabase access token and be an approved admin.
//
// Secrets: ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD (you add the Gmail ones).
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injected. DEPLOY: new function
// "send-email", Verify JWT OFF (we do our own admin check).

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";

const FEATURES = `Portal tools you can mention:
- Home page with picture tiles; the "AI Assistants" tile opens a hub of the document tools.
- AI Assistant — chat for guidelines/program checks, loan scenarios, strategy, and rate-sheet pricing; bound by branch protocols.
- Document Review — drop in any doc for an instant red-flag review; a File Checklist panel shows what to verify per doc type; "Push to monday" writes contract setup fields straight to the Master Pipeline.
- Doc Organizer — auto-rename docs, split combined PDFs, ZIP batches, auto-detect doc types.
- Knowledge Academy ("School of Strategy") — interactive training games (flashcards, quiz, match-the-pairs, what-would-you-do, acronyms).
- Team Calendar — shared month grid; scheduled closings & fundings auto-sync from monday every morning.
- Admin panel — Branch Protocols (post a rule, the AI bots enforce it), Accounts (approvals), Usage (who's using what).`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
}

async function requireAdmin(userToken: string): Promise<boolean> {
  if (!userToken) return false;
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${userToken}` } });
    if (!u.ok) return false;
    const user = await u.json();
    if (!user?.id) return false;
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,status`, { headers: sbHeaders() });
    const rows = await p.json();
    return !!(rows[0] && rows[0].role === "admin" && rows[0].status === "approved");
  } catch (_) { return false; }
}

async function draftEmail(notes: string) {
  const sys = `You write a short, friendly internal email to the Team Rizzolo mortgage team about their intranet portal. Upbeat, clear, concise, professional — like a team lead's weekly note. Cover what's new and HOW to use it, in a few skimmable bullets. No fluff, no salesy tone.
${FEATURES}
Use the admin's notes below for what specifically changed this week (if notes are sparse, write a helpful general "here's what the portal does / reminders" update).
Return ONLY a JSON object: {"subject": "...", "body": "..."}. The body is plain text with real line breaks; you may use "-" bullets. No markdown headers, no code fences.`;
  const body = {
    model: MODEL, max_tokens: 900, system: sys,
    messages: [{ role: "user", content: `Admin notes for this update:\n${notes || "(none — write a general what's-new / reminders email)"}` }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Claude error: " + await res.text());
  const j = await res.json();
  let txt = (j.content || []).map((c: { text?: string }) => c.text || "").join("").trim();
  txt = txt.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(txt);
}

async function approvedEmails(): Promise<string[]> {
  const r = await fetch(`${SB_URL}/rest/v1/profiles?status=eq.approved&select=email`, { headers: sbHeaders() });
  if (!r.ok) return [];
  const rows = await r.json();
  return rows.map((x: { email: string }) => x.email).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, notes, subject, body, userToken } = await req.json();
    if (!(await requireAdmin(userToken))) return json({ error: "Admins only." }, 403);

    if (action === "draft") {
      const d = await draftEmail(notes || "");
      return json({ ok: true, subject: d.subject, body: d.body });
    }

    if (action === "send") {
      if (!subject || !body) return json({ error: "subject and body required" }, 400);
      if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return json({ error: "Gmail secrets not set (GMAIL_USER, GMAIL_APP_PASSWORD)" }, 400);
      const emails = await approvedEmails();
      if (!emails.length) return json({ error: "no approved members to email" }, 400);
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">${escapeHtml(body).replace(/\n/g, "<br>")}</div>`;
      const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } } });
      await client.send({ from: `Team Rizzolo <${GMAIL_USER}>`, to: GMAIL_USER, bcc: emails, subject, content: body, html });
      await client.close();
      return json({ ok: true, sent: emails.length });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function escapeHtml(s: string) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
