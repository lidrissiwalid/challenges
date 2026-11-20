// Login page
// The form submits as JSON so MongoDB operator objects can be injected.
// A player can type {"$gt":""} directly into the email/password fields.
document.getElementById('loginForm').addEventListener('submit', function (e) {
  e.preventDefault();

  var emailRaw    = document.getElementById('email').value;
  var passwordRaw = document.getElementById('password').value;

  // If a field value looks like a JSON object, parse it so the operator
  // is sent as a real object rather than a quoted string.
  // e.g. typing {"$gt":""} sends {"email":{"$gt":""},...} to the server.
  function parseField(val) {
    var t = val.trim();
    if ((t.startsWith('{') && t.endsWith('}')) ||
        (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.parse(t); } catch (_) {}
    }
    return val;
  }

  var body = {
    email:    parseField(emailRaw),
    password: parseField(passwordRaw),
  };

  // Use XMLHttpRequest so we can set withCredentials and handle the response
  // ourselves. The server returns 200 with a redirect page on success, so
  // the cookie arrives in this response and the redirect HTML navigates the
  // browser — no fetch() redirect-follow quirks.
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/login', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.withCredentials = true;

  xhr.onload = function () {
    if (xhr.status === 200) {
      // Server returned success page — write it out so the meta-refresh fires
      document.open();
      document.write(xhr.responseText);
      document.close();
    } else {
      // Error page returned inline
      document.open();
      document.write(xhr.responseText);
      document.close();
    }
  };

  xhr.onerror = function () {
    document.getElementById('loginForm').insertAdjacentHTML(
      'beforebegin',
      '<div class="alert alert-error">Network error. Please try again.</div>'
    );
  };

  xhr.send(JSON.stringify(body));
});
