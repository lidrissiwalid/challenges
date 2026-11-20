// Account Settings page

// Profile form
document.getElementById('profileForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var result = document.getElementById('profileResult');
  var btn    = this.querySelector('button[type=submit]');
  var name   = document.getElementById('displayName').value.trim();

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    var res  = await fetch('/settings/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    var data = await res.json();
    if (data.ok) {
      result.innerHTML = '<div class="alert alert-success">Profile updated successfully.</div>';
    } else {
      result.innerHTML = '<div class="alert alert-error">' + escHtml(data.error || 'Update failed.') + '</div>';
    }
  } catch {
    result.innerHTML = '<div class="alert alert-error">Network error.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
});

// Preferences form — cosmetic, no backend
document.getElementById('prefForm').addEventListener('submit', function (e) {
  e.preventDefault();
  document.getElementById('prefResult').innerHTML =
    '<div class="alert alert-success">Preferences saved.</div>';
});

// API key toggle
var apiKeyInput = document.getElementById('apiKey');
var realKey     = 'gs_live_a3f8c2d19e74b05612ef4a8c3d7b9012';
var masked      = 'gs_live_••••••••••••••••••••••••••••••••';
var visible     = false;

document.getElementById('toggleApiKey').addEventListener('click', function () {
  visible = !visible;
  apiKeyInput.type  = visible ? 'text' : 'password';
  apiKeyInput.value = visible ? realKey : masked;
  this.textContent  = visible ? 'Hide' : 'Show';
});

document.getElementById('copyApiKey').addEventListener('click', function () {
  navigator.clipboard.writeText(realKey).then(function () {
    var btn = document.getElementById('copyApiKey');
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
  });
});

document.getElementById('rotateKey').addEventListener('click', function () {
  document.getElementById('apiResult').innerHTML =
    '<div class="alert alert-success">A new API key has been generated and sent to your email address.</div>';
});

// Delete account — confirmation dialog
document.getElementById('deleteAccount').addEventListener('click', function () {
  if (confirm('Are you sure you want to permanently delete your account? This action cannot be undone.')) {
    alert('Your deletion request has been received. You will receive a confirmation email within 24 hours.');
  }
});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
