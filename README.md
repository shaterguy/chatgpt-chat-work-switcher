# ChatGPT Chat ↔ Work Switcher — v0.1.0 Preview

Experimental Chrome extension for switching the request profile of the **same existing ChatGPT conversation** between Chat and Work without creating a new conversation or copying the message tree.

## Evidence used for this preview

A real ChatGPT capture on 2026-08-10 showed that native Chat and native Work both submit to the same endpoint:

- `POST /backend-api/f/conversation`
- response: HTTP 200, `text/event-stream`
- `conversation_id` remained consistent with the current `/c/<conversation_id>` route in both cases
- `conversation_mode.kind` stayed `primary_assistant` in both cases

The control-plane differences observed in that pair were:

| field | Chat | Work |
| --- | --- | --- |
| `model` | `gpt-5-6-thinking` | `gpt-5.6-luna-wm` |
| `thinking_effort` | `max` | `standard` |
| `conversation_origin` | absent | `tpp` |
| `service_tier` | absent | `standard` |

Volatile browser context such as `client_contextual_info.time_since_loaded`, dimensions, timezone data and unrelated common fields are excluded from the switching profile.

## What v0.1.0 Preview does

- Adds **Chat로 전환** and **Work로 전환** controls to the toolbar popup and on-page switch bar.
- Arms a target mode only for the current `/c/<conversation_id>` route.
- Intercepts the next matching `POST /backend-api/f/conversation` submission in the page's MAIN world.
- Applies only the captured control-plane differences above, or a newer locally captured profile if available.
- Refuses to transform when the request does not match the expected source-mode profile.
- Refuses to transform if the request `conversation_id` disagrees with the current URL conversation ID.
- Restores `conversation_id` and the complete `messages` array from the original request after patching.
- Never creates a new conversation and never hands off/copies messages.
- Keeps the selected target mode armed for later matching submissions in that same conversation.
- Automatically disables switching after HTTP/network failure or when the conversation changes.

## Important limitation

This is the first live-switching preview. The request-level evidence supports a same-endpoint body-profile experiment, but server-side acceptance of **Chat → Work → Chat inside one already-existing conversation** still requires live account testing.

A successful HTTP 200 is necessary but not sufficient proof that the server actually executed the requested target mode. The tester must verify the resulting ChatGPT UI/model behavior and then return the diagnostic JSON so the next revision can tighten the acceptance check.

## Install

1. Download and unzip `chatgpt-chat-work-switcher-v0.1.0-preview.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Remove the old probe or replace its files, then choose **Load unpacked** for the folder containing `manifest.json`.
5. Refresh all open `https://chatgpt.com` tabs once.

## First live test

Use an expendable existing conversation first.

### Chat → Work

1. Open a conversation currently behaving as native Chat.
2. Click the extension icon.
3. Click **Work로 전환**.
4. Send one harmless message in the same conversation.
5. Confirm that the browser URL still has exactly the same `/c/<conversation_id>`.
6. Check whether the response behaves as Work rather than ordinary Chat.
7. Open **진단 보기** and copy the result.

### Work → Chat

1. In the same conversation, click **Chat로 전환**.
2. Send another harmless message.
3. Confirm that the same `/c/<conversation_id>` is still present.
4. Check whether the response now behaves as ordinary Chat.
5. Copy diagnostics again.

## Optional recalibration

The popup still exposes **Chat 기록** and **Work 기록** under `프로필 다시 기록`.

If ChatGPT changes its private request schema:

1. Record one native Chat submission.
2. Record one native Work submission.
3. The extension recomputes a control-only profile.
4. With two stable samples per mode, the diagnostic confidence becomes `high`.

## Safety rules

The transformer never intentionally changes:

- browser route / conversation URL
- `conversation_id`
- `messages`
- message IDs / parent message IDs
- prompt or message contents
- attachments
- tokens, cookies or authorization headers

If the source request no longer resembles the captured source mode, the extension bypasses the request instead of guessing.

## Development

```bash
npm run check
```

CI runs syntax checks, unit tests, popup contract tests and packages the preview ZIP.
