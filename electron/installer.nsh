; Additions to electron-builder's assisted installer (see electron-builder.config.js).
; - Installs for the current user only: no "all users" page, no admin prompt.
; - The uninstaller keeps the user's data unless they tick "Also remove my data".
;   An update runs the old uninstaller silently with --updated: that never removes it.

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifdef BUILD_UNINSTALLER
  LangString removeDataTitle 1033 "Uninstall ${PRODUCT_NAME}"
  LangString removeDataTitle 1025 "إلغاء تثبيت ${PRODUCT_NAME}"
  LangString removeDataSubtitle 1033 "Choose whether to keep your data."
  LangString removeDataSubtitle 1025 "اختر ما إذا كنت تريد الاحتفاظ ببياناتك."
  LangString removeDataText 1033 "${PRODUCT_NAME} will be removed from this computer. Your data stays in $APPDATA\${PRODUCT_NAME}: your history, settings and API keys, uploaded videos and exports. It is still there if you install the app again."
  LangString removeDataText 1025 "سيُزال ${PRODUCT_NAME} من هذا الكمبيوتر. تبقى بياناتك في $APPDATA\${PRODUCT_NAME}: السجل والإعدادات ومفاتيح API ومقاطع الفيديو المرفوعة والمقاطع المصدَّرة. وستجدها كما هي إذا ثبّتّ التطبيق مرة أخرى."
  LangString removeDataCheck 1033 "Also remove my data"
  LangString removeDataCheck 1025 "احذف بياناتي أيضًا"
!endif

; Replaces the uninstaller's welcome page
!macro customUnWelcomePage
  Var removeDataBox
  Var removeData
  UninstPage custom un.removeDataShow un.removeDataLeave

  Function un.removeDataShow
    !insertmacro MUI_HEADER_TEXT "$(removeDataTitle)" "$(removeDataSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 48u "$(removeDataText)"
    Pop $0
    ${NSD_CreateCheckbox} 0 56u 100% 12u "$(removeDataCheck)"
    Pop $removeDataBox
    ; The uninstall starts from this page, so the button says so
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^UninstallBtn)"
    nsDialogs::Show
  FunctionEnd

  Function un.removeDataLeave
    ${NSD_GetState} $removeDataBox $removeData
  FunctionEnd
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; The updater's cache: a copy of this installer kept for smaller updates, and any downloaded update.
    ; Named after electron/package.json's name; no use once the app is gone.
    RMDir /r "$LOCALAPPDATA\reels-analyzer-desktop-updater"
    ${if} $removeData == ${BST_CHECKED}
      ; The data folder (APP_DATA_DIR) and the window's own browser data, both per user
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
    ${endIf}
  ${endIf}
!macroend
