import { useEffect, useRef, useState } from "react";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { apiRequest } from "../data/api";
import { ServerData } from "../data/ServerData";

const POLL_INTERVAL = 10e3;

/**
 * Tells everyone with the editor open about an update being installed, then
 * invites them to reload once the server runs a new version: this page's
 * assets may be gone from the server by then.
 */
export const UpdateBanner = () => {
  const { t } = useUnchainedI18n();
  const [installing, setInstalling] = useState(false);
  const [updated, setUpdated] = useState(false);
  const loadedVersion = useRef<string | null>(null);

  useEffect(() => {
    const poll = () =>
      apiRequest<{ version: string; installing: boolean }>(
        "GET",
        "/update/status",
      )
        .then(({ version, installing }) => {
          loadedVersion.current ??= version;
          setInstalling(installing);
          setUpdated(version !== loadedVersion.current);
        })
        // the server is unreachable: if it was installing an update, it's
        // restarting, so the banner stays
        .catch(() => {});
    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL);
    return () => window.clearInterval(interval);
  }, []);

  if (!installing && !updated) {
    return null;
  }

  return (
    <div className="unchained-update-banner" role="status">
      {updated ? t("update.installed") : t("update.installing")}
      {updated && (
        <button
          type="button"
          className="AdminDialog__button AdminDialog__button--primary"
          onClick={async () => {
            await ServerData.flushSave();
            window.location.reload();
          }}
        >
          {t("update.reload")}
        </button>
      )}
    </div>
  );
};
