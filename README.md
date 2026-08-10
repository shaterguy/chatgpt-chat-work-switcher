# ChatGPT Chat ↔ Work Switcher

Experimental Chrome extension that learns the request-level difference between native Chat and native Work, then applies only that stable difference to later message submissions in the **same existing ChatGPT conversation**.

## What v0.1.0 does

- Keeps the browser conversation URL and `conversation_id` unchanged.
- Never copies messages into a new conversation and never creates a handoff conversation.
- Learns Chat/Work mode fingerprints from native outgoing requests instead of hard-coding a private ChatGPT schema.
- Ignores message bodies, message arrays, IDs, tokens, cookies, credentials, URLs and long opaque values when learning.
- Refuses to transform requests if native Chat and Work use different backend endpoints; that case needs a separately verified endpoint-level implementation rather than a blind rewrite.
- Automatically disables transformation after an HTTP/network failure so the next submission uses native behavior.

## Install for testing

1. Download/unzip the extension folder or CI ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the folder that contains `manifest.json`.
5. Open `https://chatgpt.com` and use the small `Chat | Work | ⚙` control at the top-right.

## One-time calibration

Because ChatGPT's private request schema is not a stable public API, v0.1.0 learns the difference from your own account instead of guessing field names.

1. Open a conversation that is natively running as **Chat**.
2. Open the switcher settings, click **Chat 캡처**, then send one harmless message.
3. Open a conversation that is natively running as **Work**.
4. Click **Work 캡처**, then send one harmless message.
5. If a stable same-endpoint mode difference is found, Chat/Work buttons become available in any existing `/c/<conversation_id>` route.
6. Capture one more request in each native mode later if you want the profile upgraded from `provisional` to `high` confidence.

The extension stores only sanitized control-plane leaf values and endpoint paths. It does not intentionally store prompts, message text, attachments, cookies, auth headers or conversation/message IDs.

## Safety invariants

- The current URL conversation ID is authoritative.
- A request whose `conversation_id` disagrees with the current `/c/<id>` route is not transformed.
- `conversation_id` and the entire `messages` array are copied back from the original request after patching.
- Endpoint differences are reported but not rewritten in this version.
- Failed transformed requests disable the transformer; there is no automatic resend that could duplicate a user message.

## Current limitation

This is a real request-transforming PoC, but **server acceptance of Work inside an already-existing Chat conversation must still be verified against the live ChatGPT service**. If OpenAI binds mode above the request-body layer or uses separate endpoints, the extension deliberately stops instead of faking success. The diagnostics view exposes only the sanitized learned delta needed for the next implementation step.

## Development

```bash
npm run check
```

The CI workflow runs syntax checks + unit tests and packages a loadable ZIP.
