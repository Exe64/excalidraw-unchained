import { useEffect, useState } from "react";

import Spinner from "@excalidraw/excalidraw/components/Spinner";

import { useUnchainedI18n } from "../app-language/unchained-i18n";

import "./TwoFactor.scss";

/** the QR code to scan with an authenticator app, and its key */
export const TotpSetup = ({ secret, uri }: { secret: string; uri: string }) => {
  const { t } = useUnchainedI18n();
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    import("../share/qrcode.chunk")
      .then(({ generateQRCodeSVG }) => {
        if (mounted) {
          setSvg(generateQRCodeSVG(uri));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [uri]);

  return (
    <div className="TwoFactor__setup">
      <p className="TwoFactor__hint">{t("tfa.scan")}</p>
      <div
        className="TwoFactor__qrcode"
        role="img"
        aria-label={t("tfa.qrcode")}
        {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : {})}
      >
        {svg ? undefined : <Spinner />}
      </div>
      <div className="TwoFactor__key">
        <span>{t("tfa.key")}</span>
        <code>{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
      </div>
    </div>
  );
};

/** a 6-digit code of the app, or any code (e.g. a recovery code) when
 * `recovery` */
export const CodeInput = ({
  value,
  onChange,
  recovery = false,
  autoFocus = true,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  recovery?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) => {
  const { t } = useUnchainedI18n();
  const label =
    placeholder ??
    (recovery ? t("tfa.recoveryPlaceholder") : t("tfa.codePlaceholder"));
  return (
    <input
      className="TwoFactor__code"
      name={recovery ? "recovery-code" : "otp"}
      inputMode={recovery ? "text" : "numeric"}
      autoComplete={recovery ? "off" : "one-time-code"}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      maxLength={recovery ? 20 : 6}
      placeholder={label}
      aria-label={label}
      required
      autoFocus={autoFocus}
      value={value}
      onChange={(event) =>
        onChange(
          recovery
            ? event.target.value
            : event.target.value.replace(/\D/g, "").slice(0, 6),
        )
      }
      // keep the editor's shortcuts out, but let Escape close dialogs
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          event.stopPropagation();
        }
      }}
    />
  );
};

/** recovery codes, shown once */
export const RecoveryCodes = ({
  codes,
  username,
}: {
  codes: string[];
  username: string;
}) => {
  const { t } = useUnchainedI18n();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  return (
    <div className="TwoFactor__recovery">
      <p className="TwoFactor__hint">{t("tfa.recoveryHint")}</p>
      <ul className="TwoFactor__codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="TwoFactor__actions">
        <button
          type="button"
          className="TwoFactor__secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {}
          }}
        >
          {copied ? t("tfa.copied") : t("tfa.copy")}
        </button>
        <a
          className="TwoFactor__secondary"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(
            `${t("tfa.recoveryTitle")} (${username})\n\n${text}\n`,
          )}`}
          download={`excalidraw-recovery-codes-${username}.txt`}
        >
          {t("tfa.download")}
        </a>
      </div>
    </div>
  );
};
