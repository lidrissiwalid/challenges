// Support page — submits a ticket and reloads to show status

var form = document.getElementById('ticketForm');
if (form) {
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var result = document.getElementById('ticketResult');
    var btn    = this.querySelector('button[type=submit]');

    var subject = document.getElementById('subject').value.trim();
    var content = document.getElementById('content').value.trim();

    btn.disabled    = true;
    btn.textContent = 'Sending…';

    try {
      var res  = await fetch('/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, content }),
      });
      var data = await res.json();

      if (data.ok) {
        result.innerHTML =
          '<div class="alert alert-success">Your ticket has been submitted. ' +
          'An administrator will examine it shortly.</div>';
        // Reload after a short pause to show the ticket status view
        setTimeout(function () { window.location.reload(); }, 1800);
      } else {
        result.innerHTML =
          '<div class="alert alert-error">' + escHtml(data.error || 'Submission failed.') + '</div>';
        btn.disabled    = false;
        btn.textContent = 'Send Ticket';
      }
    } catch {
      result.innerHTML = '<div class="alert alert-error">Network error. Please try again.</div>';
      btn.disabled    = false;
      btn.textContent = 'Send Ticket';
    }
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
