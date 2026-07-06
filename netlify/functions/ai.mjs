// ============================================================
// Tuttle Kids Studio — AI proxy.
//
// The ONLY server code in this repo. It exists so the Angel AI
// Labs API key never reaches the browser. Every request must
// carry a Supabase JWT belonging to an email on the
// public.moderators whitelist — verified with the caller's OWN
// token via the security-definer is_moderator() RPC, so no
// service-role key is needed anywhere.
//
// Actions:
//   create  { model, input }  -> start a prediction (model allowlist)
//   status  { id }            -> poll a prediction
//   persist { url, path }     -> copy a finished output into the
//                                studio-assets bucket (gateway URLs
//                                expire); upload runs as the caller,
//                                gated by the bucket's moderator RLS.
//
// Env vars (Netlify site settings):
//   AI_LABS_API_KEY   Angel AI Labs key (aal_…) — the only secret.
// ============================================================

export const config = { path: "/api/ai" };

const AI_BASE = "https://ai-labs.angel-tools.io/api/v1";

// Public Supabase coordinates — same ones already shipped to the
// browser in supabase-client.js; RLS is what protects the data.
const SUPABASE_URL  = "https://ukeqcxdpzkhwlibabawg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrZXFjeGRwemtod2xpYmFiYXdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjMwMjYsImV4cCI6MjA5ODA5OTAyNn0.-0a_9qz4ryHNBi6P6cXMTF02ceMwYmkuRtoT4uE-_v4";

// Only the models the studio actually uses may run through this
// proxy — nobody can burn budget on arbitrary models with a stolen JWT.
const MODEL_ALLOWLIST = new Set([
  "anthropic/claude-opus-4.6",                          // script breakdown / prompt writing
  "google/nano-banana-2",                               // previz frames
  "bytedance/seedance-2.0/mini/reference-to-video",     // previz video (cheap default)
  "bytedance/seedance-2.0/reference-to-video",          // previz video (flagship, ~$6/run)
]);

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Verify the caller is a whitelisted moderator using their own JWT.
async function verifyModerator(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Missing auth token." };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: "Invalid or expired session." };
  const user = await userRes.json();
  const email = (user.email || "").toLowerCase();
  if (!email) return { error: "No email on session." };

  const modRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_moderator`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const isMod = modRes.ok ? await modRes.json() : false;
  if (isMod !== true) return { error: "Not on the moderator whitelist." };
  return { email, token };
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only." });

  const { AI_LABS_API_KEY } = process.env;
  if (!AI_LABS_API_KEY) return json(500, { error: "Server not configured — missing AI_LABS_API_KEY." });

  const who = await verifyModerator(req);
  if (who.error) return json(401, { error: who.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Bad JSON." }); }

  const aiHeaders = {
    Authorization: `Bearer ${AI_LABS_API_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // ---------- create ----------
    if (body.action === "create") {
      if (!MODEL_ALLOWLIST.has(body.model)) {
        return json(400, { error: `Model not allowed: ${body.model}` });
      }
      // Belt-and-braces cost caps regardless of what the client sent.
      const input = { ...(body.input || {}) };
      if (body.model.includes("seedance")) input.resolution = "480p";
      if (body.model.includes("nano-banana")) input.resolution = "1K";
      if (!body.model.startsWith("anthropic/")) input.end_user_id = who.email;

      const res = await fetch(`${AI_BASE}/predictions`, {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({ model: body.model, input }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json(res.status, { error: data.error || data.detail || `Gateway error ${res.status}` });
      return json(200, data);
    }

    // ---------- status ----------
    if (body.action === "status") {
      if (!body.id) return json(400, { error: "Missing prediction id." });
      const res = await fetch(`${AI_BASE}/predictions/${encodeURIComponent(body.id)}`, {
        headers: aiHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json(res.status, { error: data.error || `Gateway error ${res.status}` });
      return json(200, data);
    }

    // ---------- persist ----------
    if (body.action === "persist") {
      const { url, path } = body;
      if (!url || !path || !/^generations\/[\w.-]+$/.test(path)) {
        return json(400, { error: "Bad persist request." });
      }
      const media = await fetch(url);
      if (!media.ok) return json(502, { error: `Couldn't fetch output (${media.status}).` });
      const buf = await media.arrayBuffer();
      if (buf.byteLength > 100 * 1024 * 1024) return json(413, { error: "Output too large to persist." });
      const contentType = media.headers.get("content-type") ||
        (path.endsWith(".mp4") ? "video/mp4" : "image/jpeg");

      // Upload as the calling moderator — the studio-assets bucket's
      // RLS policy authorizes this; no service key involved.
      const up = await fetch(
        `${SUPABASE_URL}/storage/v1/object/studio-assets/${path}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${who.token}`,
            "Content-Type": contentType,
            "x-upsert": "true",
          },
          body: buf,
        },
      );
      if (!up.ok) {
        const err = await up.text().catch(() => "");
        return json(502, { error: `Storage upload failed: ${err.slice(0, 200)}` });
      }
      return json(200, { path });
    }

    return json(400, { error: `Unknown action: ${body.action}` });
  } catch (e) {
    return json(500, { error: e.message || "Proxy error." });
  }
};
