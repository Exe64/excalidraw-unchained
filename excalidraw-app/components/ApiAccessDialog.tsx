import { useCallback, useEffect, useState } from "react";

import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import Spinner from "@excalidraw/excalidraw/components/Spinner";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import {
  PlusIcon,
  TrashIcon,
  copyIcon,
} from "@excalidraw/excalidraw/components/icons";

import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { atom, useAtom } from "../app-jotai";
import { apiRequest } from "../data/api";

import "./ApiAccessDialog.scss";

export const apiAccessDialogOpenAtom = atom(false);

type ApiToken = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

const getMcpUrl = () =>
  `${import.meta.env.VITE_APP_API_URL || window.location.origin}/mcp`;

const CopyableSnippet = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => {
  const { t } = useUnchainedI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="ApiAccessDialog__snippet">
      <div className="ApiAccessDialog__snippetHeader">
        <span>{label}</span>
        <button
          type="button"
          className="ApiAccessDialog__copy"
          onClick={async () => {
            await copyTextToSystemClipboard(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copyIcon}
          {copied ? t("api.copied") : t("api.copy")}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
};

const NewTokenInstructions = ({ token }: { token: string }) => {
  const { t } = useUnchainedI18n();
  const mcpUrl = getMcpUrl();
  return (
    <div className="ApiAccessDialog__newToken">
      <p className="ApiAccessDialog__warning">{t("api.tokenOnce")}</p>
      <CopyableSnippet label={t("api.token")} value={token} />
      <CopyableSnippet
        label={t("api.claudeCode")}
        value={`claude mcp add --transport http excalidraw ${mcpUrl} --header "Authorization: Bearer ${token}"`}
      />
      <CopyableSnippet
        label={t("api.connector")}
        value={`${mcpUrl}/${token}`}
      />
      <p className="ApiAccessDialog__hint">{t("api.connectorHint")}</p>
      <CopyableSnippet
        label={t("api.jsonConfig")}
        value={JSON.stringify(
          {
            mcpServers: {
              excalidraw: {
                type: "http",
                url: mcpUrl,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
          },
          null,
          2,
        )}
      />
    </div>
  );
};

export const ApiAccessDialog = () => {
  const { t, langCode } = useUnchainedI18n();
  const [isOpen, setIsOpen] = useAtom(apiAccessDialogOpenAtom);
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("Claude");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTokens(
        (await apiRequest<{ tokens: ApiToken[] }>("GET", "/tokens")).tokens,
      );
    } catch (error: any) {
      setError(error.message);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refresh();
    } else {
      setTokens(null);
      setNewToken(null);
      setError(null);
    }
  }, [isOpen, refresh]);

  if (!isOpen) {
    return null;
  }

  const formatDate = (timestamp: number | null) =>
    timestamp
      ? new Date(timestamp).toLocaleString(langCode, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : t("api.never");

  return (
    <Dialog
      size="regular"
      onCloseRequest={() => setIsOpen(false)}
      title={t("api.title")}
      className="ApiAccessDialog"
    >
      <p className="ApiAccessDialog__intro">{t("api.intro")}</p>

      <div className="ApiAccessDialog__create">
        <TextField
          label={t("api.tokenName")}
          value={name}
          onChange={setName}
          onKeyDown={(event) => event.stopPropagation()}
          fullWidth
        />
        <FilledButton
          size="large"
          icon={PlusIcon}
          label={t("api.create")}
          onClick={async () => {
            try {
              const { token } = await apiRequest<{ token: string }>(
                "POST",
                "/tokens",
                { json: { name } },
              );
              setNewToken(token);
              setError(null);
              await refresh();
            } catch (error: any) {
              setError(error.message);
            }
          }}
        />
      </div>

      {error && <div className="ApiAccessDialog__error">{error}</div>}
      {newToken && <NewTokenInstructions token={newToken} />}

      <h3 className="ApiAccessDialog__subtitle">{t("api.tokens")}</h3>
      {tokens === null ? (
        <Spinner />
      ) : tokens.length === 0 ? (
        <p className="ApiAccessDialog__empty">{t("api.noTokens")}</p>
      ) : (
        <ul className="ApiAccessDialog__list">
          {tokens.map((token) => (
            <li key={token.id} className="ApiAccessDialog__row">
              <div>
                <div className="ApiAccessDialog__name">{token.name}</div>
                <div className="ApiAccessDialog__meta">
                  {t("api.created", { date: formatDate(token.createdAt) })}
                  {" · "}
                  {t("api.lastUsed", { date: formatDate(token.lastUsedAt) })}
                </div>
              </div>
              <button
                type="button"
                className="ApiAccessDialog__revoke"
                title={t("api.revoke")}
                aria-label={t("api.revoke")}
                onClick={async () => {
                  if (
                    !window.confirm(
                      t("api.revokeConfirm", { name: token.name }),
                    )
                  ) {
                    return;
                  }
                  try {
                    await apiRequest(
                      "DELETE",
                      `/tokens/${encodeURIComponent(token.id)}`,
                    );
                    await refresh();
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                {TrashIcon}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};
