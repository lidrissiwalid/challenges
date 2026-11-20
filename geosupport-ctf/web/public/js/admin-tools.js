// Admin Map Data Source Validator

document.getElementById('validatorForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const result = document.getElementById('validatorResult');
  const btn    = this.querySelector('button[type=submit]');
  const url    = document.getElementById('url').value.trim();

  btn.disabled = true;
  btn.textContent = 'Validating…';
  result.innerHTML = '<div class="spinner"></div> Sending request…';

  try {
    const res  = await fetch('/admin/tools/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.status === 'ok') {
      result.innerHTML =
        '<div class="alert alert-success">' +
        '<strong>Response received</strong> — HTTP ' + escHtml(String(data.statusCode)) +
        '</div>' +
        '<pre>' + escHtml(data.body || '') + '</pre>';
    } else {
      result.innerHTML =
        '<div class="alert alert-error">' +
        '<strong>Request failed</strong>: ' + escHtml(data.error || 'Unknown error') +
        '</div>';
    }
  } catch {
    result.innerHTML = '<div class="alert alert-error">Network error.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Validate Source';
  }
});

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
