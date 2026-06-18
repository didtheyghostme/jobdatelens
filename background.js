"use strict";

function isSupportedPageUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
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

chrome.action.onClicked.addListener(scanTab);
