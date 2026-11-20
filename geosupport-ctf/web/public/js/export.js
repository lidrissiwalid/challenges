// Data Export page

document.getElementById('exportForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var result = document.getElementById('exportResult');
  var btn    = this.querySelector('button[type=submit]');
  var dataset = document.getElementById('dataset').value;
  var format  = document.getElementById('format').value;

  btn.disabled = true;
  btn.textContent = 'Requesting…';
  result.innerHTML = '';

  try {
    var res  = await fetch('/export/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset, format }),
    });
    var data = await res.json();
    if (data.ok) {
      result.innerHTML =
        '<div class="alert alert-success">' +
        '<strong>Export queued</strong> — Job ID: <code>' + escHtml(data.jobId) + '</code><br>' +
        '<small>Estimated processing time: ' + data.estimatedMinutes + ' minutes. ' +
        'You will receive an email notification when the file is ready.</small>' +
        '</div>';
      this.reset();
    } else {
      result.innerHTML = '<div class="alert alert-error">' + escHtml(data.error || 'Request failed.') + '</div>';
    }
  } catch {
    result.innerHTML = '<div class="alert alert-error">Network error.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Request Export';
  }
});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
