// Tuttle Twins casting call — deadline countdown (concept)
(function () {
  // Applications due July 13. Target next occurrence at 11:59pm local.
  function target() {
    var now = new Date();
    var y = now.getFullYear();
    var t = new Date(y, 6, 13, 23, 59, 0); // July = month 6
    if (t < now) t = new Date(y + 1, 6, 13, 23, 59, 0);
    return t;
  }
  var T = target();
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function tick() {
    var els = document.querySelectorAll("[data-countdown]");
    if (!els.length) return;
    var diff = Math.max(0, T - new Date());
    var d = Math.floor(diff / 864e5);
    var h = Math.floor((diff % 864e5) / 36e5);
    var m = Math.floor((diff % 36e5) / 6e4);
    var s = Math.floor((diff % 6e4) / 1e3);
    var vals = { d: d, h: pad(h), m: pad(m), s: pad(s) };
    els.forEach(function (root) {
      root.querySelectorAll("[data-unit]").forEach(function (u) {
        var n = u.querySelector(".n");
        if (n) n.textContent = vals[u.getAttribute("data-unit")];
      });
    });
  }
  tick();
  setInterval(tick, 1000);
})();
