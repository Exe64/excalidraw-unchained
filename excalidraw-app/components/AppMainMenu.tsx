import {
  LoadIcon,
  PlusIcon,
  eyeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { useUnchainedI18n } from "../app-language/unchained-i18n";
import { useAtomValue } from "../app-jotai";
import { currentUserAtom } from "../auth/auth";

import { saveDebugState } from "./DebugCanvas";

const logoutIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" />
    <path d="M9 12h12l-3-3" />
    <path d="M18 15l3-3" />
  </svg>
);

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  refresh: () => void;
  onDrawingsDialogOpen: () => void;
  onNewDrawing: () => void;
  onLogout: () => void;
}> = React.memo((props) => {
  const { t: tu } = useUnchainedI18n();
  const user = useAtomValue(currentUserAtom);
  return (
    <MainMenu>
      <MainMenu.Item icon={LoadIcon} onSelect={props.onDrawingsDialogOpen}>
        {tu("drawings.title")}
      </MainMenu.Item>
      <MainMenu.Item icon={PlusIcon} onSelect={props.onNewDrawing}>
        {tu("drawings.new")}
      </MainMenu.Item>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      {props.isCollabEnabled && (
        <MainMenu.DefaultItems.LiveCollaborationTrigger
          isCollaborating={props.isCollaborating}
          onSelect={() => props.onCollabDialogOpen()}
        />
      )}
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Socials />
      <MainMenu.Item
        icon={logoutIcon}
        onSelect={props.onLogout}
        title={
          user ? tu("auth.signedInAs", { username: user.username }) : undefined
        }
      >
        {tu("auth.signOut")}
        {user && (
          <span className="unchained-menu-username">{user.username}</span>
        )}
      </MainMenu.Item>
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={props.theme} />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
