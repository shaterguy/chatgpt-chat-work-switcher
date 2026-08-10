# ChatGPT Chat ↔ Work Switcher — Read-only Probe v0.0.2

Phase 0–1 research build for finding the **real** request-level difference between native Chat and native Work before implementing any same-conversation request mutation.

## v0.0.2 bug fix

The previous v0.0.1 manifest declared a toolbar action but did not attach a popup or click handler, so clicking the extension icon correctly resulted in no visible action. v0.0.2 fixes that defect by wiring a real toolbar popup to the in-page probe controls.

## What this build does

- Observes only message-submission candidates sent to `chatgpt.com` backend endpoints.
- Lets the tester label one native request as Chat and one as Work.
- Stores only a sanitized request fingerprint: endpoint path, transport, route kind, conversation-ID consistency boolean and short non-sensitive primitive control values.
- Computes candidate stable differences between Chat and Work.
- Records response status/path/content-type metadata for the captured request.
- Never changes the request URL, body, headers, `conversation_id`, message tree or response.
- Never creates a new conversation or copies/handoffs messages.

## Data intentionally excluded

The probe skips message arrays, message/content/text/parts fields, prompts, attachments/files, conversation/message/user/account IDs, tokens, cookies, authorization/session/credential fields, UUID-like values, URLs, emails and long opaque strings.

No captured data leaves Chrome extension local storage automatically.

## Install

1. Download and unzip `chatgpt-chat-work-switcher-probe-v0.0.2.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Remove the older probe build if it is already installed.
5. Choose **Load unpacked** and select the unzipped folder containing `manifest.json`.
6. Refresh the already-open `https://chatgpt.com` tab once.

## Capture procedure

1. Open a conversation that is natively running as **Chat**.
2. Click the extension toolbar icon. A popup must open with `Chat 기록`, `Work 기록`, `진단 보기`, and `기록 초기화` controls.
3. Click **Chat 기록**, then send one harmless message in the ChatGPT page.
4. Open a conversation that is natively running as **Work**.
5. Click the extension toolbar icon → **Work 기록**, then send one harmless message.
6. Click the extension toolbar icon → **진단 보기** and copy the diagnostic JSON back into the development conversation for analysis.
7. For stronger evidence, repeat one additional capture in each mode; the comparison becomes `high` confidence when each mode has at least two samples and its candidate fields are stable.

If the popup says the probe is not loaded, refresh the ChatGPT tab once. If the current tab is not `https://chatgpt.com`, the popup reports that explicitly instead of appearing to do nothing.

## Why this is read-only

The goal is to prove where mode selection actually lives before touching a live conversation. If Chat and Work use the same endpoint with a stable body-level difference, Phase 2 can test a minimal same-conversation patch. If the endpoint differs or mode is bound to a task/session/conversation metadata layer, the next implementation must target that layer explicitly instead of faking a UI switch.

## Development

```bash
npm run check
```

CI runs syntax checks, unit tests and packages a loadable ZIP.
