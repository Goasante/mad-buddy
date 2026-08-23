/* Behaviour for the offline shell (MB-GOD-041).
 *
 * A separate file rather than an inline <script>: the app enforces a
 * nonce-based Content-Security-Policy, and a static file served by the service
 * worker has no request through which a nonce could be issued. An external
 * same-origin script satisfies `script-src 'self'` without depending on
 * 'unsafe-inline' remaining in the policy.
 */
(function () {
  var status = document.getElementById("status");
  var retry = document.getElementById("retry");

  function say(text) {
    if (status) status.textContent = text;
  }

  if (retry) {
    /* Retry reloads the route the user was actually trying to reach, because
     * this page was served in ITS place -- location.reload() therefore
     * re-requests that route, not offline.html. */
    retry.addEventListener("click", function () {
      if (navigator.onLine) {
        say("Reconnecting\u2026");
        location.reload();
        return;
      }
      say("Still offline. Check your connection.");
    });
  }

  // Recover unprompted the moment the network returns, so someone who set the
  // phone down does not have to notice and tap.
  window.addEventListener("online", function () {
    say("Back online. Reloading\u2026");
    location.reload();
  });
  window.addEventListener("offline", function () {
    say("Still offline.");
  });
})();
