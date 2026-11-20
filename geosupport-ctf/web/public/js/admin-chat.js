// Admin chat page — intentionally renders message content via innerHTML (XSS sink)
(function () {
  var messages = window.__MESSAGES__ || [];

  messages.forEach(function (msg) {
    var el = document.querySelector('[data-message-id="' + msg.id + '"]');
    if (el) {
      try {
        // ── Intentional XSS vulnerability ──────────────────────────────────
        // Content is inserted with innerHTML without sanitisation.
        // This allows stored XSS payloads to execute in the admin browser.
        el.innerHTML = msg.content;
        // ───────────────────────────────────────────────────────────────────
      } catch (e) {
        el.textContent = '[Error rendering message]';
      }
    }
  });
})();
