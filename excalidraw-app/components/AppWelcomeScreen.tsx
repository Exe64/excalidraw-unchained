import { LoadIcon } from "@excalidraw/excalidraw/components/icons";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { WelcomeScreen } from "@excalidraw/excalidraw/index";
import React from "react";

import { useUnchainedI18n } from "../app-language/unchained-i18n";

export const AppWelcomeScreen: React.FC<{
  onCollabDialogOpen: () => any;
  isCollabEnabled: boolean;
  onDrawingsDialogOpen: () => void;
}> = React.memo((props) => {
  const { t } = useI18n();
  const { t: tu } = useUnchainedI18n();
  const headingContent = (
    <>
      {tu("welcome.heading")}
      <br />
      {tu("welcome.heading_line2")}
    </>
  );

  return (
    <WelcomeScreen>
      <WelcomeScreen.Hints.MenuHint>
        {t("welcomeScreen.app.menuHint")}
      </WelcomeScreen.Hints.MenuHint>
      <WelcomeScreen.Hints.ToolbarHint />
      <WelcomeScreen.Hints.HelpHint />
      <WelcomeScreen.Center>
        <WelcomeScreen.Center.Logo />
        <WelcomeScreen.Center.Heading>
          {headingContent}
        </WelcomeScreen.Center.Heading>
        <WelcomeScreen.Center.Menu>
          <WelcomeScreen.Center.MenuItemLoadScene />
          <WelcomeScreen.Center.MenuItemHelp />
          {props.isCollabEnabled && (
            <WelcomeScreen.Center.MenuItemLiveCollaborationTrigger
              onSelect={() => props.onCollabDialogOpen()}
            />
          )}
          <WelcomeScreen.Center.MenuItem
            onSelect={() => props.onDrawingsDialogOpen()}
            shortcut={null}
            icon={LoadIcon}
          >
            {tu("drawings.title")}
          </WelcomeScreen.Center.MenuItem>
        </WelcomeScreen.Center.Menu>
      </WelcomeScreen.Center>
    </WelcomeScreen>
  );
});
