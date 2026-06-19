"use strict";

var EXECUTE_ACTION_COMMAND = "_execute_action";
var DEFAULT_ACTION_TITLE = "Scan this page with JobDateLens";
var SHORTCUT_UNASSIGNED_TITLE =
  "JobDateLens shortcut was not assigned. Existing shortcuts were not changed. Set one at chrome://extensions/shortcuts.";
var SHORTCUT_WARNING_BADGE_TEXT = "!";
var SHORTCUT_WARNING_BADGE_COLOR = "#D97706";
var FETCH_HTML_FALLBACK_MESSAGE = "jobdatelens:fetchHtmlFallback";

function isSupportedPageUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function getCanonicalLeverPostingUrl(value) {
  var parsed;
  var pathSegments;

  try {
    parsed = new URL(String(value || ""));
  } catch (error) {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "jobs.lever.co") {
    return null;
  }

  pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (
    pathSegments.length === 2 ||
    (pathSegments.length === 3 && pathSegments[2] === "apply")
  ) {
    return parsed.origin + "/" + pathSegments[0] + "/" + pathSegments[1];
  }

  return null;
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

async function handleFetchHtmlFallbackMessage(request, fetchImpl) {
  var fallbackUrl = getCanonicalLeverPostingUrl(request && request.url);
  var fetcher;
  var response;
  var htmlText;

  if (!fallbackUrl) {
    return {
      ok: false,
      message: "Unsupported fallback URL."
    };
  }

  fetcher = fetchImpl || fetch;

  try {
    response = await fetcher(fallbackUrl, {
      cache: "no-store",
      credentials: "omit"
    });

    if (!response.ok) {
      return {
        ok: false,
        message: "HTTP " + response.status
      };
    }

    htmlText = await response.text();
    return {
      ok: true,
      htmlText: htmlText,
      url: fallbackUrl
    };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

function handleRuntimeMessage(request, sender, sendResponse) {
  if (!request || request.type !== FETCH_HTML_FALLBACK_MESSAGE) {
    return false;
  }

  handleFetchHtmlFallbackMessage(request).then(sendResponse);
  return true;
}

if (typeof chrome !== "undefined" && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(handleActionClick);

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  if (chrome.runtime && chrome.runtime.onInstalled && chrome.commands && chrome.commands.getAll) {
    chrome.runtime.onInstalled.addListener(warnIfShortcutUnassignedOnInstall);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EXECUTE_ACTION_COMMAND: EXECUTE_ACTION_COMMAND,
    FETCH_HTML_FALLBACK_MESSAGE: FETCH_HTML_FALLBACK_MESSAGE,
    getCanonicalLeverPostingUrl: getCanonicalLeverPostingUrl,
    getCommandByName: getCommandByName,
    handleFetchHtmlFallbackMessage: handleFetchHtmlFallbackMessage,
    handleRuntimeMessage: handleRuntimeMessage,
    isCommandShortcutUnassigned: isCommandShortcutUnassigned,
    isSupportedPageUrl: isSupportedPageUrl
  };
}
