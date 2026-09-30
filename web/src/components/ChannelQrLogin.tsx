// Channel QR-pairing panel — the web surface for QR login flows (WeChat
// today). The channel daemon prints the QR to the terminal for CLI users;
// this panel consumes the same lifecycle from the authenticated SSE
// `/api/events` stream (`attributes.login` frames; credentials are
// broadcast-only and delivery-once, see login_events.rs), so headless
// operators can complete pairing entirely in the dashboard.

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Badge, Button, Card } from "@/components/ui";
import { getChannels, reloadDaemon, relinkChannel } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useSSE } from "@/hooks/useSSE";
import type { ChannelDetail } from "@/types/api";
import {
  deriveQrLoginView,
  isChannelLoginFrame,
  type QrLoginView,
} from "./ChannelQrLogin.logic";

const QR_IMAGE_SIZE = 232;

export default function ChannelQrLogin({
  channelType,
  alias,
}: {
  channelType: string;
  alias: string;
}) {
  const composite = `${channelType}.${alias}`;
  const [channel, setChannel] = useState<ChannelDetail | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    getChannels()
      .then((all) => {
        setChannel(all.find((c) => c.name === composite) ?? null);
      })
      .catch(() => {
        /* keep the last known status; the pairing flow still works */
      })
      .finally(() => setStatusLoading(false));
  }, [composite]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const { events, clearEvents } = useSSE({
    // Structured log frames arrive as type "message"; discriminate on the
    // channel category + attributes.login identity instead of `type`.
    filter: (event) => isChannelLoginFrame(event, channelType, alias),
    maxEvents: 64,
  });

  const view: QrLoginView = useMemo(
    () => deriveQrLoginView(events, channelType, alias),
    [events, channelType, alias],
  );

  // Render the current QR payload into an image whenever it changes.
  useEffect(() => {
    let alive = true;
    if (!view.qrPayload) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(view.qrPayload, { width: QR_IMAGE_SIZE, margin: 2 })
      .then((url) => {
        if (alive) setQrDataUrl(url);
      })
      .catch(() => {
        if (alive) setQrDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [view.qrPayload]);

  // A confirmed pairing flips the channel's persisted-login readiness; poll
  // it once so the status badge updates without a manual refresh.
  const wasConnected = useMemo(
    () => events.some((e) => (e.attributes?.login as { state?: string })?.state === "connected"),
    [events],
  );
  useEffect(() => {
    if (wasConnected) refreshStatus();
  }, [wasConnected, refreshStatus]);

  const authenticated = channel?.readiness?.authenticated ?? "unknown";
  const enabled = channel?.enabled ?? false;

  async function startPairing(force: boolean) {
    if (actionBusy) return;
    if (!force && authenticated === "ready") {
      const ok = window.confirm(t("channel_qr.relink_confirm"));
      if (!ok) return;
    }
    setActionBusy(true);
    setError(null);
    clearEvents();
    try {
      // Relink is idempotent (`nothing_to_clear` when no login is stored) and
      // always followed by a daemon reload, which restarts the channel and
      // mints a fresh QR on its listen() path.
      await relinkChannel(composite);
      await reloadDaemon();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("channel_qr.start_failed"));
    } finally {
      setActionBusy(false);
    }
  }

  const showWaiting = view.phase === "idle" || view.phase === "waiting_qr";

  return (
    <Card className="max-w-2xl space-y-4 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-pc-text">
          {t("channel_qr.title")}
        </h3>
        <p className="text-xs text-pc-text-muted">{t("channel_qr.intro")}</p>
      </div>

      {/* Current persisted-login state, from GET /api/channels readiness. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-pc-text-muted">{composite}</span>
        {statusLoading ? (
          <Badge>{t("channel_qr.status_loading")}</Badge>
        ) : !channel ? (
          <Badge tone="error">{t("channel_qr.status_missing_block")}</Badge>
        ) : (
          <>
            <Badge tone={enabled ? "ok" : "error"}>
              {enabled ? t("channel_qr.enabled") : t("channel_qr.disabled")}
            </Badge>
            <Badge
              tone={authenticated === "ready" ? "ok" : authenticated === "missing" ? "error" : "neutral"}
            >
              {authenticated === "ready"
                ? t("channel_qr.authenticated")
                : authenticated === "missing"
                  ? t("channel_qr.not_authenticated")
                  : t("channel_qr.auth_unknown")}
            </Badge>
          </>
        )}
      </div>

      {/* Live pairing area driven by SSE login frames. */}
      {showWaiting ? (
        <div className="rounded-lg border border-dashed border-pc-border px-4 py-8 text-center">
          <p className="text-xs text-pc-text-muted">
            {actionBusy ? t("channel_qr.restarting") : t("channel_qr.waiting_hint")}
          </p>
        </div>
      ) : view.phase === "qr" || view.phase === "scanned" || view.phase === "expired" ? (
        <div className="flex flex-col items-center gap-3">
          <div
            className={`rounded-lg border border-pc-border bg-white p-2 transition-opacity ${
              view.phase === "qr" ? "" : "opacity-40"
            }`}
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                width={QR_IMAGE_SIZE}
                height={QR_IMAGE_SIZE}
                alt={t("channel_qr.qr_alt")}
                className="block"
              />
            ) : (
              <div
                style={{ width: QR_IMAGE_SIZE, height: QR_IMAGE_SIZE }}
                className="flex items-center justify-center text-xs text-pc-text-faint"
              >
                {t("channel_qr.qr_render_failed")}
              </div>
            )}
          </div>
          <p className="text-xs text-pc-text">
            {view.phase === "qr" && t("channel_qr.scan_hint")}
            {view.phase === "scanned" && t("channel_qr.scanned_hint")}
            {view.phase === "expired" && t("channel_qr.expired_hint")}
          </p>
          {view.attempt != null && view.maxAttempts != null ? (
            <p className="text-xs text-pc-text-faint">
              {t("channel_qr.attempt_counter")
                .replace("{attempt}", String(view.attempt))
                .replace("{max}", String(view.maxAttempts))}
            </p>
          ) : null}
          {view.qrImageUrl ? (
            <a
              href={view.qrImageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline text-pc-text-muted"
            >
              {t("channel_qr.platform_image")}
            </a>
          ) : null}
        </div>
      ) : view.phase === "connected" ? (
        <div className="rounded-lg border border-status-success/25 bg-status-success/10 px-4 py-6 text-center">
          <p className="text-sm font-medium text-status-success">
            {t("channel_qr.connected_hint")}
          </p>
        </div>
      ) : view.phase === "failed" ? (
        <div className="rounded-lg border border-status-error/25 bg-status-error/10 px-4 py-6 text-center space-y-1">
          <p className="text-sm font-medium text-status-error">
            {t("channel_qr.failed_hint")}
          </p>
          {view.reason ? (
            <p className="text-xs text-pc-text-muted font-mono break-all">{view.reason}</p>
          ) : null}
        </div>
      ) : view.phase === "logged_out" ? (
        <div className="rounded-lg border border-status-warning/25 bg-status-warning/10 px-4 py-6 text-center">
          <p className="text-sm font-medium text-status-warning">
            {t("channel_qr.logged_out_hint")}
          </p>
        </div>
      ) : view.phase === "pair_code" && view.pairCode ? (
        <div className="rounded-lg border border-pc-border px-4 py-6 text-center">
          <p className="text-xs text-pc-text-muted">{t("channel_qr.pair_code_hint")}</p>
          <p className="mt-2 font-mono text-lg tracking-widest text-pc-text">{view.pairCode}</p>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={() => void startPairing(false)}
          disabled={actionBusy}
        >
          {actionBusy
            ? t("channel_qr.starting")
            : authenticated === "ready"
              ? t("channel_qr.repair")
              : t("channel_qr.start")}
        </Button>
        <Button variant="ghost" size="md" onClick={refreshStatus} disabled={statusLoading}>
          {t("channel_qr.refresh_status")}
        </Button>
      </div>

      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <p className="text-xs text-pc-text-faint">{t("channel_qr.delivery_note")}</p>
    </Card>
  );
}
