// ============================================================
// Tuttle Kids Studio — data layer.
// Same Supabase project as the casting form; every studio table
// is RLS-gated to the public.moderators whitelist (see
// supabase-studio-setup.sql). AI generation goes through the
// Netlify function at /api/ai so the Angel AI Labs key stays
// server-side.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://ukeqcxdpzkhwlibabawg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrZXFjeGRwemtod2xpYmFiYXdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjMwMjYsImV4cCI6MjA5ODA5OTAyNn0.-0a_9qz4ryHNBi6P6cXMTF02ceMwYmkuRtoT4uE-_v4";

export const BUCKET = "studio-assets";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ------------------------------------------------------------
// Shot taxonomy — the 3x3 live matrix + 4 animated modes.
// ------------------------------------------------------------
export const SHOT_TYPES = {
  live: {
    label: "Live action",
    subtypes: {
      crew_dtc:    "Crew · Direct to camera",
      crew_story:  "Crew · Story",
      crew_broll:  "Crew · B-roll",
      kid_dtc:     "Kid · Direct to camera",
      kid_story:   "Kid · Story",
      kid_broll:   "Kid · B-roll",
      adult_dtc:   "Adult · Direct to camera",
      adult_story: "Adult · Story",
      adult_broll: "Adult · B-roll",
    },
  },
  animated: {
    label: "Animated",
    subtypes: {
      anim_fully_scripted:    "Fully scripted",
      anim_reactive_scripted: "Reactive scripted",
      anim_short_term:        "Short-term scripted",
      anim_live:              "Live / improv",
    },
  },
};

export function subtypeLabel(subtype) {
  for (const cat of Object.values(SHOT_TYPES)) {
    if (cat.subtypes[subtype]) return cat.subtypes[subtype];
  }
  return subtype;
}

export const EPISODE_STATUSES = ["script", "concepted", "shooting", "rough_cut", "released"];
export const EPISODE_STATUS_LABELS = {
  script: "Script", concepted: "Concepted", shooting: "Shooting",
  rough_cut: "Rough cut", released: "Released",
};

// ------------------------------------------------------------
// Models — ids on the Angel AI Labs gateway + cost estimates.
// est is a per-run estimate used for button labels and the
// episode tally; actual cost from the API replaces it when the
// gateway reports one.
// ------------------------------------------------------------
export const MODELS = {
  frame: {
    id: "google/nano-banana-2",
    short: "Nano Banana 2", est: 0.06, kind: "frame",
  },
  mini: {
    id: "bytedance/seedance-2.0/mini/reference-to-video",
    short: "Seedance Mini", est: 0.15, kind: "video",
  },
  flagship: {
    id: "bytedance/seedance-2.0/reference-to-video",
    short: "Seedance 2.0", est: 6.15, kind: "video", confirm: true,
  },
  llm: { id: "anthropic/claude-opus-4.6" },
};

export function fmtCost(n) {
  if (n == null) return "";
  return n < 1 ? `~${Math.round(n * 100)}¢` : `~$${n.toFixed(2)}`;
}

// ------------------------------------------------------------
// Tiny CRUD helpers. All throw on error so callers can toast.
// ------------------------------------------------------------
function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export const db = {
  episodes:   () => supabase.from("episodes").select("*").order("number").then(unwrap),
  episode:    (id) => supabase.from("episodes").select("*").eq("id", id).single().then(unwrap),
  saveEpisode:(id, patch) => supabase.from("episodes").update(patch).eq("id", id).then(unwrap),
  addEpisode: (row) => supabase.from("episodes").insert(row).select().single().then(unwrap),

  shots:      (episodeId) => supabase.from("shots").select("*")
                .eq("episode_id", episodeId).order("position").then(unwrap),
  allShots:   () => supabase.from("shots").select("id,episode_id,status,category,subtype").then(unwrap),
  addShot:    (row) => supabase.from("shots").insert(row).select().single().then(unwrap),
  saveShot:   (id, patch) => supabase.from("shots").update(patch).eq("id", id).then(unwrap),
  deleteShot: (id) => supabase.from("shots").delete().eq("id", id).then(unwrap),

  characters: () => supabase.from("characters").select("*").order("kind").order("name").then(unwrap),
  addCharacter:(row) => supabase.from("characters").insert(row).select().single().then(unwrap),
  saveCharacter:(id, patch) => supabase.from("characters").update(patch).eq("id", id).then(unwrap),
  deleteCharacter:(id) => supabase.from("characters").delete().eq("id", id).then(unwrap),

  assets:     (owner) => supabase.from("assets").select("*").eq("owner", owner)
                .order("created_at").then(unwrap),
  allAssets:  () => supabase.from("assets").select("*").then(unwrap),
  addAsset:   (row) => supabase.from("assets").insert(row).select().single().then(unwrap),
  deleteAsset:(id) => supabase.from("assets").delete().eq("id", id).then(unwrap),

  generations:(shotId) => supabase.from("generations").select("*")
                .eq("shot_id", shotId).order("created_at", { ascending: false }).then(unwrap),
  generationsForEpisode: async (episodeId) => {
    const shots = await supabase.from("shots").select("id").eq("episode_id", episodeId).then(unwrap);
    if (!shots.length) return [];
    return supabase.from("generations").select("*")
      .in("shot_id", shots.map(s => s.id))
      .order("created_at", { ascending: false }).then(unwrap);
  },
  addGeneration:(row) => supabase.from("generations").insert(row).select().single().then(unwrap),
  saveGeneration:(id, patch) => supabase.from("generations").update(patch).eq("id", id).then(unwrap),
  deleteGeneration:(id) => supabase.from("generations").delete().eq("id", id).then(unwrap),

  shoots:     () => supabase.from("shoots").select("*").order("shoot_date", { ascending: true, nullsFirst: false }).then(unwrap),
  addShoot:   (row) => supabase.from("shoots").insert(row).select().single().then(unwrap),
  saveShoot:  (id, patch) => supabase.from("shoots").update(patch).eq("id", id).then(unwrap),
  deleteShoot:(id) => supabase.from("shoots").delete().eq("id", id).then(unwrap),

  ideas:      () => supabase.from("ideas").select("*").order("created_at", { ascending: false }).then(unwrap),
  addIdea:    (row) => supabase.from("ideas").insert(row).select().single().then(unwrap),
  saveIdea:   (id, patch) => supabase.from("ideas").update(patch).eq("id", id).then(unwrap),
  deleteIdea: (id) => supabase.from("ideas").delete().eq("id", id).then(unwrap),

  contacts:   () => supabase.from("contacts").select("*").order("name").then(unwrap),
  addContact: (row) => supabase.from("contacts").insert(row).select().single().then(unwrap),
  saveContact:(id, patch) => supabase.from("contacts").update(patch).eq("id", id).then(unwrap),
  deleteContact:(id) => supabase.from("contacts").delete().eq("id", id).then(unwrap),

  setting: async (key, fallback = null) => {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.value : fallback;
  },
  saveSetting: (key, value) =>
    supabase.from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).then(unwrap),
};

// ------------------------------------------------------------
// Storage helpers.
// ------------------------------------------------------------
export async function uploadAsset(owner, file) {
  const ext  = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${owner.replace(":", "/")}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  const media_type = file.type.startsWith("video") ? "video" : "image";
  return db.addAsset({ owner, storage_path: path, media_type });
}

export async function signedUrl(path, secs = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, secs);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function removeAsset(asset) {
  await supabase.storage.from(BUCKET).remove([asset.storage_path]);
  await db.deleteAsset(asset.id);
}

// ------------------------------------------------------------
// AI proxy — Netlify function keeps the Angel AI Labs key
// server-side; we pass the caller's Supabase JWT so it can
// verify moderator status.
// ------------------------------------------------------------
async function aiCall(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `AI proxy error (${res.status})`);
  return json;
}

export const ai = {
  create:  (model, input) => aiCall({ action: "create", model, input }),
  status:  (id)           => aiCall({ action: "status", id }),
  // Server-side copies a finished output into studio-assets so the
  // board doesn't rot when the gateway's signed URL expires.
  persist: (url, path)    => aiCall({ action: "persist", url, path }),
};

// Poll a prediction until it finishes. onTick(status) fires each poll.
export async function pollPrediction(id, onTick, { intervalMs = 3000, timeoutMs = 600000 } = {}) {
  const start = Date.now();
  for (;;) {
    const p = await ai.status(id);
    onTick?.(p);
    if (p.status === "completed" || p.status === "succeeded") return p;
    if (p.status === "failed" || p.status === "canceled")
      throw new Error(p.error || "Generation failed.");
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the generation.");
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Cost in USD for a finished prediction. The gateway's reported
// usage.cost_microcents runs implausibly low (internal cost, not
// billing), so our catalog estimate is the floor — we only trust a
// reported number when it's HIGHER than the estimate.
export function costOf(p, fallback) {
  const candidates = [
    Number(p?.usage?.cost_microcents) / 1e8,
    Number(p?.cost), Number(p?.cost_usd), Number(p?.total_cost),
  ].filter(n => Number.isFinite(n) && n > 0);
  return Math.max(fallback || 0, ...candidates, 0) || fallback;
}

// Extract a usable output URL from a prediction result (gateway
// output shapes vary: string URL, array of URLs, object, or an
// assets[] list).
export function outputUrlOf(p) {
  for (const a of p.assets || []) {
    if (typeof a === "string" && a.startsWith("http")) return a;
    if (a && typeof a.url === "string" && a.url.startsWith("http")) return a.url;
  }
  const o = p.output;
  if (!o) return null;
  if (typeof o === "string") return o.startsWith("http") ? o : null;
  if (Array.isArray(o)) return o.find(x => typeof x === "string" && x.startsWith("http")) || null;
  if (typeof o === "object") {
    for (const v of Object.values(o)) {
      if (typeof v === "string" && v.startsWith("http")) return v;
      if (Array.isArray(v)) { const hit = v.find(x => typeof x === "string" && x.startsWith("http")); if (hit) return hit; }
      // Seedance nests it: output.video.url
      if (v && typeof v === "object" && typeof v.url === "string" && v.url.startsWith("http")) return v.url;
    }
  }
  return null;
}

// Extract text output from an LLM prediction.
export function textOutputOf(p) {
  const o = p.output;
  if (typeof o === "string") return o;
  if (Array.isArray(o)) return o.join("");
  if (o && typeof o === "object" && typeof o.text === "string") return o.text;
  return "";
}

// ------------------------------------------------------------
// Prompt + reference assembly for a shot.
// Animated shots pull the global style refs ('style' owner) and
// each character's refs; live shots use the template only (plus
// refs of any REAL people attached).
// ------------------------------------------------------------
export async function buildGenerationPlan(shot, allCharacters, templates, { forFrame = false } = {}) {
  const chars = (shot.character_ids || [])
    .map(id => allCharacters.find(c => c.id === id))
    .filter(Boolean)
    .filter(c => c.kind !== "persona");

  const template = templates?.[shot.subtype] ||
    "{description}. {script}";

  const charText = chars.length
    ? chars.map(c => `${c.name} — ${c.description}`).join(" | ")
    : "";

  let prompt = template
    .replaceAll("{description}", shot.description || shot.title || "")
    .replaceAll("{script}", shot.script_text ? `"${shot.script_text}"` : "")
    .replaceAll("{characters}", charText)
    .replace(/\s{2,}/g, " ").trim();

  // Gather references: character images first, then (for animated
  // video) the global style videos. Seedance caps: 9 images, 3
  // videos, 12 files total. Nano Banana 2: images only, up to 14.
  const imageRefs = [];   // { url, label }
  const videoRefs = [];
  const maxImgsPerChar = 2;

  for (const c of chars) {
    const assets = await db.assets(`character:${c.id}`);
    for (const a of assets.filter(a => a.media_type === "image").slice(0, maxImgsPerChar)) {
      if (imageRefs.length >= 9) break;
      imageRefs.push({ url: await signedUrl(a.storage_path), label: c.name });
    }
  }

  if (shot.category === "animated" && !forFrame) {
    const styleAssets = await db.assets("style");
    for (const a of styleAssets.filter(a => a.media_type === "video").slice(0, 3)) {
      videoRefs.push({ url: await signedUrl(a.storage_path), label: "animation style" });
    }
    // If no style videos yet, fall back to style images.
    if (!videoRefs.length) {
      for (const a of styleAssets.filter(a => a.media_type === "image").slice(0, 9 - imageRefs.length)) {
        imageRefs.push({ url: await signedUrl(a.storage_path), label: "animation style" });
      }
    }
  } else if (shot.category === "animated" && forFrame) {
    const styleAssets = await db.assets("style");
    for (const a of styleAssets.filter(a => a.media_type === "image").slice(0, 4)) {
      imageRefs.push({ url: await signedUrl(a.storage_path), label: "animation style" });
    }
  }

  // Reference the attachments explicitly in the prompt (Seedance
  // understands @Image1/@Video1; Nano Banana just uses them).
  const refNotes = [];
  imageRefs.forEach((r, i) => refNotes.push(`@Image${i + 1} = ${r.label}`));
  videoRefs.forEach((r, i) => refNotes.push(`@Video${i + 1} = ${r.label}`));
  if (refNotes.length) prompt += ` (References: ${refNotes.join(", ")}.)`;

  return { prompt, imageRefs, videoRefs };
}

// Build the model input payload from a plan + user-editable prompt.
export function buildModelInput(modelKey, prompt, plan, shot) {
  if (modelKey === "frame") {
    const input = { prompt, aspect_ratio: "16:9", resolution: "1K", output_format: "jpg" };
    if (plan.imageRefs.length) input.image_input = plan.imageRefs.map(r => r.url);
    return input;
  }
  const input = {
    prompt,
    resolution: "480p",
    aspect_ratio: "16:9",
    duration: String(Math.min(Math.max(shot.duration_secs || 6, 4), 12)),
    generate_audio: true,
  };
  if (plan.imageRefs.length) input.image_urls = plan.imageRefs.map(r => r.url);
  if (plan.videoRefs.length) input.video_urls = plan.videoRefs.map(r => r.url);
  return input;
}

// ------------------------------------------------------------
// Misc UI helpers shared across pages.
// ------------------------------------------------------------
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toast(msg, isError = false) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast"; el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), isError ? 6000 : 2600);
}
