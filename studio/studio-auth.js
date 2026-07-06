// ============================================================
// Tuttle Kids Studio — auth gate + shared page chrome.
// Same auth model as /admin: email + password accounts created
// in the Supabase dashboard, whitelisted in public.moderators.
// Every studio page calls requireModerator() before rendering.
// ============================================================
import { supabase, escapeHtml } from "./studio-store.js";

const NAV = [
  { href: "index.html",      label: "Episodes",   primary: true },
  { href: "characters.html", label: "Characters", primary: true },
  { href: "checklists.html", label: "Checklists", primary: true },
  { href: "dashboard.html",  label: "Dashboard" },
  { href: "people.html",     label: "People" },
  { href: "ideas.html",      label: "Ideas" },
];

function renderNav(email) {
  const here = location.pathname.split("/").pop() || "index.html";
  const links = NAV.map(n =>
    `<a href="${n.href}" class="${n.primary ? "" : "nav-secondary"} ${here === n.href ? "active" : ""}">${n.label}</a>`
  ).join("");
  const el = document.createElement("header");
  el.className = "studio-nav";
  el.innerHTML = `
    <div class="nav-inner">
      <a class="brand" href="index.html">🎬 Tuttle Kids <span>Studio</span></a>
      <nav>${links}</nav>
      <div class="nav-user">
        <span title="${escapeHtml(email)}">${escapeHtml(email.split("@")[0])}</span>
        <button class="btn-mini" id="signoutBtn">Sign out</button>
      </div>
    </div>`;
  document.body.prepend(el);
  el.querySelector("#signoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

function renderSignin(root) {
  root.innerHTML = `
    <section class="signin">
      <h1>🎬 Tuttle Kids Studio</h1>
      <p>Episode concepting for <i>Will It Sell?</i> — sign in with your moderator account.</p>
      <form id="signinForm" autocomplete="on">
        <input class="input" id="signinEmail" type="email" placeholder="you@tuttletwins.tv" autocomplete="username" required>
        <input class="input" id="signinPassword" type="password" placeholder="Password" autocomplete="current-password" required>
        <button class="btn btn-block" type="submit" id="signinBtn">Sign in</button>
      </form>
      <p class="msg" id="signinMsg" role="status" aria-live="polite"></p>
    </section>`;
  const form = root.querySelector("#signinForm");
  const msg  = root.querySelector("#signinMsg");
  const btn  = root.querySelector("#signinBtn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = "Signing in…"; msg.textContent = "";
    const { error } = await supabase.auth.signInWithPassword({
      email: root.querySelector("#signinEmail").value.trim().toLowerCase(),
      password: root.querySelector("#signinPassword").value,
    });
    btn.disabled = false; btn.textContent = "Sign in";
    if (error) { msg.textContent = error.message; msg.className = "msg error"; return; }
    location.reload();
  });
}

function renderNotModerator(root, email) {
  const sql = `insert into public.moderators (email, note)\nvalues ('${email}', 'studio')\non conflict (email) do nothing;`;
  root.innerHTML = `
    <section class="signin" style="max-width:640px; text-align:left;">
      <h1>Almost there</h1>
      <p><b>${escapeHtml(email)}</b> can sign in, but isn't on the <code>public.moderators</code> whitelist, so the studio data is hidden.</p>
      <p>Open the <a href="https://supabase.com/dashboard/project/ukeqcxdpzkhwlibabawg/sql/new" target="_blank" rel="noopener">Supabase SQL Editor</a> and run:</p>
      <pre class="code-block">${escapeHtml(sql)}</pre>
      <p style="margin-top:12px;"><button class="btn" onclick="location.reload()">I ran it — refresh</button></p>
    </section>`;
}

// Gate the page. Resolves with the signed-in moderator's email and
// reveals #app; otherwise renders sign-in / whitelist help and never
// resolves.
export async function requireModerator() {
  const root = document.getElementById("gate");
  const app  = document.getElementById("app");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.email) {
    renderSignin(root);
    return new Promise(() => {});
  }
  const { data: isMod, error } = await supabase.rpc("is_moderator");
  if (error || !isMod) {
    renderNotModerator(root, session.user.email);
    return new Promise(() => {});
  }
  root.remove();
  renderNav(session.user.email);
  app.hidden = false;
  return session.user.email;
}
