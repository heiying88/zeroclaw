import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveQrLoginView,
  foldQrLoginState,
  INITIAL_QR_LOGIN_VIEW,
  isChannelLoginFrame,
} from "./ChannelQrLogin.logic.ts";

import type { SSEEvent } from "../types/api.ts";

function loginFrame(login: Record<string, unknown>): SSEEvent {
  return {
    type: "message",
    event: { category: "channel", action: "note" },
    attributes: { login },
  } as unknown as SSEEvent;
}

test("isChannelLoginFrame matches the composite channel identity", () => {
  const frame = loginFrame({
    state: "qr",
    channel: "wechat.default",
    channel_type: "wechat",
    channel_alias: "default",
    qr_payload: "https://qr.example/x",
  });
  assert.equal(isChannelLoginFrame(frame, "wechat", "default"), true);
  assert.equal(isChannelLoginFrame(frame, "wechat", "other"), false);
  assert.equal(isChannelLoginFrame(frame, "telegram", "default"), false);
});

test("isChannelLoginFrame matches the split identity when composite is absent", () => {
  const frame = loginFrame({
    state: "scanned",
    channel_type: "wechat",
    channel_alias: "bot",
  });
  assert.equal(isChannelLoginFrame(frame, "wechat", "bot"), true);
  assert.equal(isChannelLoginFrame(frame, "wechat", "default"), false);
});

test("isChannelLoginFrame rejects non-channel frames and frames without login attrs", () => {
  const otherCategory = {
    type: "message",
    event: { category: "agent", action: "note" },
    attributes: { login: { state: "qr", channel: "wechat.default" } },
  } as unknown as SSEEvent;
  assert.equal(isChannelLoginFrame(otherCategory, "wechat", "default"), false);

  const noLogin = {
    type: "channel_update",
    attributes: { channel: "wechat.default" },
  } as unknown as SSEEvent;
  assert.equal(isChannelLoginFrame(noLogin, "wechat", "default"), false);
});

test("fold keeps the last QR payload across scanned and expired", () => {
  let view = foldQrLoginState(INITIAL_QR_LOGIN_VIEW, {
    state: "qr",
    qr_payload: "PAYLOAD-1",
    attempt: 1,
    max_attempts: 3,
  });
  assert.equal(view.phase, "qr");
  assert.equal(view.qrPayload, "PAYLOAD-1");

  view = foldQrLoginState(view, { state: "scanned" });
  assert.equal(view.phase, "scanned");
  assert.equal(view.qrPayload, "PAYLOAD-1");

  view = foldQrLoginState(view, { state: "expired", attempt: 2, max_attempts: 3 });
  assert.equal(view.phase, "expired");
  assert.equal(view.qrPayload, "PAYLOAD-1");
  assert.equal(view.attempt, 2);

  view = foldQrLoginState(view, {
    state: "qr",
    qr_payload: "PAYLOAD-2",
    attempt: 2,
    max_attempts: 3,
  });
  assert.equal(view.qrPayload, "PAYLOAD-2");
});

test("fold clears credentials on connected and records failure reason", () => {
  let view = foldQrLoginState(INITIAL_QR_LOGIN_VIEW, {
    state: "qr",
    qr_payload: "P",
  });
  view = foldQrLoginState(view, { state: "connected" });
  assert.equal(view.phase, "connected");
  assert.equal(view.qrPayload, undefined);

  view = foldQrLoginState(view, { state: "failed", reason: "attempts exhausted" });
  assert.equal(view.phase, "failed");
  assert.equal(view.reason, "attempts exhausted");
});

test("deriveQrLoginView folds only this channel's frames in order", () => {
  const events = [
    loginFrame({ state: "qr", channel: "wechat.default", qr_payload: "A" }),
    {
      type: "message",
      event: { category: "channel", action: "note" },
      attributes: { login: { state: "qr", channel: "wechat.other", qr_payload: "B" } },
    } as unknown as SSEEvent,
    loginFrame({ state: "scanned", channel: "wechat.default" }),
    loginFrame({ state: "connected", channel: "wechat.default" }),
  ];
  const view = deriveQrLoginView(events, "wechat", "default");
  assert.equal(view.phase, "connected");
  // The final connected state drops the credential payload entirely.
  assert.equal(view.qrPayload, undefined);
});
