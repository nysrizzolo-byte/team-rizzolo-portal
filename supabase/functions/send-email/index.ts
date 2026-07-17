// Supabase Edge Function: send-email
// Portal update composer + partner "What's New" feed. Actions:
//   action:"draft" {notes?} -> Claude reads recent repo commits + optional notes and writes a
//        two-section team email: "For the team" and "For our referral partners". Admin only.
//   action:"send"  {subject, body} -> emails ALL approved members (BCC) via Gmail SMTP. Admin only.
//   action:"feed"  {} -> Claude returns ONLY the partner-facing "What's New" items as JSON, for the
//        in-portal Referral Partner News feed. Any approved signed-in user (so partners can read it).
//
// The "what changed" comes automatically from the repo's git history (GitHub commits API) — no more
// hand-typing notes. Notes (draft only) are optional extra context.
//
// Secrets: ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD (you add the Gmail ones).
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injected. DEPLOY: redeploy "send-email",
// Verify JWT OFF (we do our own auth check).

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";
const REPO = "nysrizzolo-byte/team-rizzolo-portal";

// Shared definition of who sees what, so the team email's partner section and the partner
// feed classify changes the exact same way.
const PARTNER_DEF = `A "partner-facing" change is anything a referral partner (an outside real estate agent with a limited login) would see or use: the referral-partner home, the Tools & Utilities row, Training / 203K Coach, the partner Payment Calculator, the "Join Our Preferred Network" page, the 203k-Friendly listings, their referred-deal pipeline, and partner news. EVERYTHING ELSE is team-only (Document Review, Doc Organizer, My Conditions / stips, Pre-Approval tool, Take/Transcribe Application, metrics, calendar, admin tools, account plumbing).`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
}

// ── Auth helpers ──
async function userRow(userToken: string): Promise<{ id: string; role: string; status: string } | null> {
  if (!userToken) return null;
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${userToken}` } });
    if (!u.ok) return null;
    const user = await u.json();
    if (!user?.id) return null;
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,status`, { headers: sbHeaders() });
    const rows = await p.json();
    if (!rows[0]) return null;
    return { id: user.id, role: rows[0].role, status: rows[0].status };
  } catch (_) { return null; }
}

// ── Pull recent user-visible changes from the git history ──
async function fetchCommits(sinceDays = 30): Promise<string> {
  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?since=${since}&per_page=100`, {
      headers: { "User-Agent": "team-rizzolo-portal", "Accept": "application/vnd.github+json" },
    });
    if (!r.ok) return "";
    const arr = await r.json();
    if (!Array.isArray(arr)) return "";
    return arr.map((c: any) => {
      const msg = String(c?.commit?.message || "").split("\n")[0];
      const date = String(c?.commit?.author?.date || "").slice(0, 10);
      return date && msg ? `- ${date}: ${msg}` : "";
    }).filter(Boolean).join("\n");
  } catch (_) { return ""; }
}

async function callClaude(system: string, user: string, maxTokens = 1100): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error("Claude error: " + await res.text());
  const j = await res.json();
  const txt = (j.content || []).map((c: { text?: string }) => c.text || "").join("").trim();
  return txt.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
}

// ── Team email: two labeled sections, auto-built from commits (+ optional notes) ──
async function draftEmail(notes: string) {
  const log = await fetchCommits(30);
  const sys = `You write a short, friendly internal email to the Team Rizzolo mortgage team about their web portal. Upbeat, clear, concise, professional — like a team lead's weekly note. No fluff, no salesy tone.

You are given the portal's recent git commit log. Turn it into "what's new" for the team.
- Only include real, user-visible product changes. DROP purely internal/dev commits (edge-function plumbing, CSS fixes, refactors, roster tweaks, deploy notes, thumbnail/meta changes).
- Merge related commits into one clear item. Describe the benefit and how to use it in plain language — never say "commit", "edge function", or other dev jargon.

${PARTNER_DEF}

The email BODY must have TWO clearly labeled sections, in this order:
"🏢 For the team" — the team-only changes.
"🤝 For our referral partners" — the partner-facing changes (so the team knows what partners are now seeing). If there are no partner-facing changes, write a single line: "Nothing new on the partner side this week."
Use "-" bullets under each heading. Keep it skimmable.

Return ONLY a JSON object: {"subject": "...", "body": "..."}. The body is plain text with real line breaks and "-" bullets. No markdown headers beyond the two section labels, no code fences.`;
  const user = `Recent portal changes (git log):\n${log || "(commit log unavailable)"}\n\nExtra admin notes (optional, may be blank):\n${notes || "(none)"}`;
  return JSON.parse(await callClaude(sys, user, 1100));
}

// ── Partner feed: ONLY the partner-facing items, as structured cards ──
async function partnerFeed() {
  const log = await fetchCommits(45);
  const sys = `You produce a "What's New" feed for Team Rizzolo's REFERRAL PARTNERS (outside real estate agents with a limited login). You are given the portal's recent git commit log.

${PARTNER_DEF}

Include ONLY partner-facing changes. Completely ignore team-only changes — partners must never see internal updates. Merge related commits into one item and rewrite in warm, plain, partner-friendly language (the benefit to them, how to use it). Never use dev jargon.

Return ONLY a JSON object: {"items":[{"title":"short headline","blurb":"one or two friendly sentences","date":"YYYY-MM-DD"}]}. Use the most recent relevant date for each item. Most important / most recent first, max 8 items. If there is nothing partner-facing, return {"items":[]}.`;
  const user = `Recent portal changes (git log):\n${log || "(commit log unavailable)"}`;
  const parsed = JSON.parse(await callClaude(sys, user, 900));
  return Array.isArray(parsed.items) ? parsed.items : [];
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
    const { action, notes, subject, body, userToken, email, name, contactId } = await req.json();
    const who = await userRow(userToken);
    const isApproved = !!(who && who.status === "approved");
    const isAdmin = !!(who && who.role === "admin" && who.status === "approved");

    // Partner-readable: the in-portal What's New feed.
    if (action === "feed") {
      if (!isApproved) return json({ error: "Sign in to see updates." }, 403);
      const items = await partnerFeed();
      return json({ ok: true, items, generatedAt: new Date().toISOString() });
    }

    // Everything else is admin-only.
    if (!isAdmin) return json({ error: "Admins only." }, 403);

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

    // Invite a referral partner: set them up as an approved partner linked to their monday
    // contact, generate a magic login link, and email a branded invite from Gmail.
    if (action === "invitePartner") {
      const em = String(email || "").trim().toLowerCase();
      const first = String(name || "").trim().split(/\s+/)[0] || "";
      const last = String(name || "").trim().split(/\s+/).slice(1).join(" ");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json({ error: "a valid email is required" }, 400);
      if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return json({ error: "Gmail secrets not set (GMAIL_USER, GMAIL_APP_PASSWORD)" }, 400);
      const PORTAL = "https://nysrizzolo-byte.github.io/team-rizzolo-portal/";
      // Generate a login link. "invite" also creates the auth user if new (longer-lived);
      // fall back to "magiclink" if they already have a login.
      const genLink = (type: string) => fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
        method: "POST", headers: sbHeaders(),
        body: JSON.stringify({ type, email: em, options: { redirect_to: PORTAL, data: { first_name: first, last_name: last } } }),
      });
      let lr = await genLink("invite");
      if (!lr.ok) lr = await genLink("magiclink");
      if (!lr.ok) return json({ error: "could not create login link: " + (await lr.text()).slice(0, 300) }, 500);
      const lj = await lr.json();
      const link = lj.action_link || lj.properties?.action_link || "";
      const userId = lj.user?.id || lj.id || lj.user_id || "";
      if (!link || !userId) return json({ error: "login link/user missing from response" }, 500);
      // Upsert their profile: approved Referral Partner, linked to their monday contact.
      const prof = { id: userId, email: em, first_name: first, last_name: last, role: "partner", status: "approved", referral_contact_id: contactId ? String(contactId) : null };
      const up = await fetch(`${SB_URL}/rest/v1/profiles`, {
        method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(prof),
      });
      if (!up.ok && up.status !== 409) { /* trigger may have created it; try a PATCH */
        await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${userId}`, { method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ email: em, first_name: first, last_name: last, role: "partner", status: "approved", referral_contact_id: contactId ? String(contactId) : null }) });
      }
      // Branded invite email.
      const subj = "You're invited to the Team Rizzolo partner portal";
      const text = `Hi${first ? " " + first : ""},\n\nYou've been invited to the Team Rizzolo referral-partner portal — your hub for the clients you send us: live updates on their loans, the 203k coach & tools, a payment calculator, and more.\n\nLog in here (no password needed — the link signs you in):\n${link}\n\nSee you inside,\nTeam Rizzolo`;
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <div style="background:#12141a;color:#fff;padding:22px 24px;border-radius:14px 14px 0 0"><div style="font-size:20px;font-weight:800">Team <span style="color:#8CC63F">Rizzolo</span></div><div style="color:#9aa3b2;font-size:13px;margin-top:2px">Referral Partner Portal</div></div>
        <div style="border:1px solid #e6e6e6;border-top:0;border-radius:0 0 14px 14px;padding:24px">
          <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hi${first ? " " + escapeHtml(first) : ""},</p>
          <p style="font-size:15px;line-height:1.6;margin:0 0 18px">You've been invited to the <b>Team Rizzolo referral-partner portal</b> — your hub for the clients you send us: live updates on their loans, the 203k coach &amp; tools, a payment calculator, and more.</p>
          <a href="${escapeHtml(link)}" style="display:inline-block;background:linear-gradient(135deg,#8CC63F,#a7d55f);color:#12141a;font-weight:800;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:11px">Log in to the portal →</a>
          <p style="font-size:12.5px;color:#888;line-height:1.6;margin:18px 0 0">No password needed — this link signs you in. If the button doesn't work, copy this URL:<br>${escapeHtml(link)}</p>
        </div></div>`;
      const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } } });
      await client.send({ from: `Team Rizzolo <${GMAIL_USER}>`, to: em, subject: subj, content: text, html });
      await client.close();
      return json({ ok: true, email: em, userId });
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
