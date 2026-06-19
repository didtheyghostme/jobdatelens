"use strict";

var EXECUTE_ACTION_COMMAND = "_execute_action";
var DEFAULT_ACTION_TITLE = "Scan this page with JobDateLens";
var SHORTCUT_UNASSIGNED_TITLE =
  "JobDateLens shortcut was not assigned. Existing shortcuts were not changed. Set one at chrome://extensions/shortcuts.";
var SHORTCUT_WARNING_BADGE_TEXT = "!";
var SHORTCUT_WARNING_BADGE_COLOR = "#D97706";

function isSupportedPageUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function getCommandByName(commands, commandName) {
  if (!Array.isArray(commands)) {
    return null;
  }

  for (var index = 0; index < commands.length; index += 1) {
    if (commands[index] && commands[index].name === commandName) {
      return commands[index];
    }
  }

  return null;
}

function isCommandShortcutUnassigned(commands, commandName) {
  var command = getCommandByName(commands, commandName);

  return Boolean(command && command.shortcut === "");
}

async function isExecuteActionShortcutUnassigned() {
  var commands = await chrome.commands.getAll();

  return isCommandShortcutUnassigned(commands, EXECUTE_ACTION_COMMAND);
}

async function showShortcutUnassignedWarning() {
  await chrome.action.setBadgeBackgroundColor({ color: SHORTCUT_WARNING_BADGE_COLOR });
  await chrome.action.setBadgeText({ text: SHORTCUT_WARNING_BADGE_TEXT });
  await chrome.action.setTitle({ title: SHORTCUT_UNASSIGNED_TITLE });
}

async function clearShortcutUnassignedWarning() {
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
}

async function updateShortcutUnassignedWarning() {
  if (await isExecuteActionShortcutUnassigned()) {
    await showShortcutUnassignedWarning();
  } else {
    await clearShortcutUnassignedWarning();
  }
}

async function warnIfShortcutUnassignedOnInstall(details) {
  if (!details || details.reason !== "install") {
    return;
  }

  try {
    if (await isExecuteActionShortcutUnassigned()) {
      await showShortcutUnassignedWarning();
    }
  } catch (error) {
    console.warn("JobDateLens could not check its shortcut assignment.", error);
  }
}

async function refreshShortcutWarningIfShown() {
  var badgeText;

  try {
    badgeText = await chrome.action.getBadgeText({});
    if (badgeText === SHORTCUT_WARNING_BADGE_TEXT) {
      await updateShortcutUnassignedWarning();
    }
  } catch (error) {
    console.warn("JobDateLens could not refresh its shortcut warning.", error);
  }
}

async function injectJobDateLens(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId: tabId },
    files: ["content.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ["content.js"]
  });
}

async function isJobDateLensInjected(tabId) {
  var results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function () {
      return Boolean(window.JobDateLens && typeof window.JobDateLens.scanOnce === "function");
    }
  });

  return Boolean(results && results[0] && results[0].result);
}

async function scanTab(tab) {
  if (!tab || typeof tab.id !== "number" || !isSupportedPageUrl(tab.url)) {
    return;
  }

  try {
    if (!(await isJobDateLensInjected(tab.id))) {
      await injectJobDateLens(tab.id);
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        if (!window.JobDateLens || typeof window.JobDateLens.scanOnce !== "function") {
          return { found: false, error: "JobDateLens content script was not ready." };
        }

        return window.JobDateLens.scanOnce();
      }
    });
  } catch (error) {
    console.warn("JobDateLens could not scan this page.", error);
  }
}

async function handleActionClick(tab) {
  await refreshShortcutWarningIfShown();
  await scanTab(tab);
}

if (typeof chrome !== "undefined" && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(handleActionClick);

  if (chrome.runtime && chrome.runtime.onInstalled && chrome.commands && chrome.commands.getAll) {
    chrome.runtime.onInstalled.addListener(warnIfShortcutUnassignedOnInstall);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EXECUTE_ACTION_COMMAND: EXECUTE_ACTION_COMMAND,
    getCommandByName: getCommandByName,
    isCommandShortcutUnassigned: isCommandShortcutUnassigned,
    isSupportedPageUrl: isSupportedPageUrl
  };
}
