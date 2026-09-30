// Pure state machine for the channel QR-pairing panel. The wire format is
// the `attributes.login` object the gateway broadcasts on the authenticated
// SSE `/api/events` stream (see `zeroclaw-channels/src/login_events.rs`):
// credential-bearing frames (`qr`, `pair_code`) are delivery-once and never
// persisted, so this module only folds what a live subscriber observed.

import type { SSEEvent } from "../types/api";

/** `attributes.login` on a channel-category log frame. */
export interface LoginAttrs {
  state:
    | "qr"
    | "pair_code"
    | "scanned"
    | "expired"
    | "connected"
    | "failed"
    | "logged_out";
  channel?: string;
  channel_type?: string;
  channel_alias?: string;
  /** Broadcast-only: raw payload to encode into a QR image client-side. */
  qr_payload?: string;
  /** Broadcast-only: platform-served QR image URL, when one exists. */
  qr_image_url?: string;
  pair_code?: string;
  attempt?: number;
  max_attempts?: number;
  reason?: string;
}

/** True when the SSE frame is a login-lifecycle event for this channel. */
export function isChannelLoginFrame(
  event: SSEEvent,
  channelType: string,
  channelAlias: string,
): boolean {
  if (event?.event?.category !== "channel") return false;
  const login = event.attributes?.login as Partial<LoginAttrs> | undefined;
  if (!login || typeof login.state !== "string") return false;
  // Frames carry either the composite `channel` ("wechat.default") or the
  // split pair; accept a match on whichever the emitter populated.
  if (login.channel) return login.channel === `${channelType}.${channelAlias}`;
  return (
    login.channel_type === channelType && login.channel_alias === channelAlias
  );
}

export type QrLoginPhase =
  | "idle"
  | "waiting_qr"
  | "qr"
  | "pair_code"
  | "scanned"
  | "expired"
  | "connected"
  | "failed"
  | "logged_out";

export interface QrLoginView {
  phase: QrLoginPhase;
  /** Last observed QR payload; kept across scanned/expired so the image can
   * stay rendered (dimmed) until a fresh QR replaces it. */
  qrPayload?: string;
  qrImageUrl?: string;
  pairCode?: string;
  attempt?: number;
  maxAttempts?: number;
  reason?: string;
}

export const INITIAL_QR_LOGIN_VIEW: QrLoginView = { phase: "idle" };

/** Fold one login frame into the panel view. Order-sensitive: later frames
 * win on phase; `expired`/`scanned` keep the last QR payload. */
export function foldQrLoginState(
  prev: QrLoginView,
  attrs: Partial<LoginAttrs>,
): QrLoginView {
  switch (attrs.state) {
    case "qr":
      return {
        phase: "qr",
        qrPayload: attrs.qr_payload,
        qrImageUrl: attrs.qr_image_url,
        attempt: attrs.attempt,
        maxAttempts: attrs.max_attempts,
      };
    case "pair_code":
      return {
        phase: "pair_code",
        pairCode: attrs.pair_code,
        attempt: attrs.attempt,
        maxAttempts: attrs.max_attempts,
      };
    case "scanned":
      return { ...prev, phase: "scanned" };
    case "expired":
      return {
        ...prev,
        phase: "expired",
        attempt: attrs.attempt,
        maxAttempts: attrs.max_attempts,
      };
    case "connected":
      return { phase: "connected" };
    case "failed":
      return { phase: "failed", reason: attrs.reason };
    case "logged_out":
      return { phase: "logged_out" };
    default:
      return prev;
  }
}

/** Reduce the full observed SSE frame list into the current view. */
export function deriveQrLoginView(
  events: SSEEvent[],
  channelType: string,
  channelAlias: string,
): QrLoginView {
  let view = INITIAL_QR_LOGIN_VIEW;
  for (const event of events) {
    if (!isChannelLoginFrame(event, channelType, channelAlias)) continue;
    view = foldQrLoginState(view, event.attributes.login as LoginAttrs);
  }
  return view;
}
