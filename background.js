"use strict";

var EXECUTE_ACTION_COMMAND = "_execute_action";
var DEFAULT_ACTION_TITLE = "Scan this page with JobDateLens";
var SHORTCUT_UNASSIGNED_TITLE =
  "JobDateLens shortcut was not assigned. Existing shortcuts were not changed. Set one at chrome://extensions/shortcuts.";
var SHORTCUT_WARNING_BADGE_TEXT = "!";
var SHORTCUT_WARNING_BADGE_COLOR = "#D97706";
var FETCH_HTML_FALLBACK_MESSAGE = "jobdatelens:fetchHtmlFallback";
var FETCH_YC_JOB_POSTING_MESSAGE = "jobdatelens:fetchYcJobPosting";
var FETCH_ASHBY_JOB_POSTING_MESSAGE = "jobdatelens:fetchAshbyJobPosting";
var HTML_ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
var YC_ORIGIN = "https://www.ycombinator.com";
var ASHBY_JOB_HOSTNAME = "jobs.ashbyhq.com";

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

function normalizeAshbyJobId(value) {
  var jobId = String(value || "").trim().toLowerCase();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    jobId
  )
    ? jobId
    : null;
}

function normalizeAshbyBoardPathSegment(value) {
  var segment = String(value || "").trim();

  if (!segment || segment === "." || segment === "..") {
    return null;
  }

  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch (error) {
    return null;
  }
}

function getCanonicalAshbyJobPostingUrl(value) {
  var parsed;
  var pathSegments;
  var boardSegment;
  var jobId;

  try {
    parsed = new URL(String(value || ""));
  } catch (error) {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== ASHBY_JOB_HOSTNAME) {
    return null;
  }

  pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 2) {
    return null;
  }

  boardSegment = normalizeAshbyBoardPathSegment(pathSegments[0]);
  jobId = normalizeAshbyJobId(pathSegments[1]);
  if (!boardSegment || !jobId) {
    return null;
  }

  return parsed.origin + "/" + boardSegment + "/" + jobId + "?embed=js";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, function (match, hex) {
      var codePoint = parseInt(hex, 16);

      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, function (match, decimal) {
      var codePoint = parseInt(decimal, 10);

      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeYcCompanySlug(value) {
  var slug = String(value || "").trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return null;
  }

  return slug;
}

function getYcCompanyUrl(companySlug) {
  var slug = normalizeYcCompanySlug(companySlug);

  return slug ? YC_ORIGIN + "/companies/" + encodeURIComponent(slug) : null;
}

function hasExactWaasJobId(value, jobId) {
  var id = Number(jobId);
  var idPattern;
  var signupPattern;

  if (!Number.isInteger(id) || id <= 0) {
    return false;
  }

  idPattern = new RegExp('["\']id["\']\\s*:\\s*' + id + "\\b");
  signupPattern = new RegExp("signup_job_id(?:%3D|=)" + id + "\\b", "i");

  return idPattern.test(value) || signupPattern.test(value);
}

function validateYcJobPostingUrl(value, companySlug) {
  var slug = normalizeYcCompanySlug(companySlug);
  var parsed;
  var expectedPrefix;

  if (!slug) {
    return null;
  }

  try {
    parsed = new URL(String(value || ""), YC_ORIGIN);
  } catch (error) {
    return null;
  }

  expectedPrefix = "/companies/" + slug + "/jobs/";
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "www.ycombinator.com" ||
    parsed.pathname.indexOf(expectedPrefix) !== 0
  ) {
    return null;
  }

  return parsed.origin + parsed.pathname;
}

function extractYcJobPostingUrlFromCompanyHtml(htmlText, jobId, companySlug) {
  var slug = normalizeYcCompanySlug(companySlug);
  var decoded;
  var urlPattern;
  var match;
  var matchedUrl;
  var trustedUrl;
  var context;
  var objectStart;
  var objectEnd;

  if (!slug || !Number.isInteger(Number(jobId)) || Number(jobId) <= 0) {
    return null;
  }

  decoded = decodeHtmlEntities(htmlText);
  urlPattern = new RegExp(
    '(?:https:\\/\\/www\\.ycombinator\\.com)?(\\/companies\\/' +
      escapeRegExp(slug) +
      '\\/jobs\\/[^"\'<>\\s\\\\]+)',
    "g"
  );

  while ((match = urlPattern.exec(decoded))) {
    matchedUrl = match[1];
    trustedUrl = validateYcJobPostingUrl(matchedUrl, slug);
    if (!trustedUrl) {
      continue;
    }

    objectStart = decoded.lastIndexOf("{", match.index);
    objectEnd = decoded.indexOf("}", match.index);
    context =
      objectStart !== -1 && objectEnd !== -1 && objectEnd > match.index
        ? decoded.slice(objectStart, objectEnd + 1)
        : decoded.slice(Math.max(0, match.index - 500), match.index + 900);
    if (hasExactWaasJobId(context, jobId)) {
      return trustedUrl;
    }
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
      credentials: "omit",
      headers: {
        Accept: HTML_ACCEPT_HEADER
      }
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

async function handleFetchYcJobPostingMessage(request, fetchImpl) {
  var jobId = Number(request && request.jobId);
  var companySlug = normalizeYcCompanySlug(request && request.companySlug);
  var companyUrl;
  var fetcher;
  var companyResponse;
  var companyHtml;
  var jobUrl;
  var jobResponse;
  var jobHtml;
  var fetchOptions = {
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: HTML_ACCEPT_HEADER
    }
  };

  if (!Number.isInteger(jobId) || jobId <= 0 || !companySlug) {
    return {
      ok: false,
      message: "Unsupported YC job lookup."
    };
  }

  companyUrl = getYcCompanyUrl(companySlug);
  fetcher = fetchImpl || fetch;

  try {
    companyResponse = await fetcher(companyUrl, fetchOptions);
    if (!companyResponse.ok) {
      return {
        ok: false,
        message: "HTTP " + companyResponse.status
      };
    }

    companyHtml = await companyResponse.text();
    jobUrl = extractYcJobPostingUrlFromCompanyHtml(companyHtml, jobId, companySlug);
    if (!jobUrl) {
      return {
        ok: false,
        message: "No exact YC job match."
      };
    }

    jobResponse = await fetcher(jobUrl, fetchOptions);
    if (!jobResponse.ok) {
      return {
        ok: false,
        message: "HTTP " + jobResponse.status
      };
    }

    jobHtml = await jobResponse.text();
    return {
      ok: true,
      htmlText: jobHtml,
      url: jobUrl
    };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

async function handleFetchAshbyJobPostingMessage(request, fetchImpl) {
  var jobUrl = getCanonicalAshbyJobPostingUrl(request && request.jobUrl);
  var fetcher;
  var response;
  var htmlText;

  if (!jobUrl) {
    return {
      ok: false,
      message: "Unsupported Ashby job lookup."
    };
  }

  fetcher = fetchImpl || fetch;

  try {
    response = await fetcher(jobUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: HTML_ACCEPT_HEADER
      }
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
      url: jobUrl
    };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error)
    };
  }
}

function handleRuntimeMessage(request, sender, sendResponse) {
  if (!request) {
    return false;
  }

  if (request.type === FETCH_HTML_FALLBACK_MESSAGE) {
    handleFetchHtmlFallbackMessage(request).then(sendResponse);
    return true;
  }

  if (request.type === FETCH_YC_JOB_POSTING_MESSAGE) {
    handleFetchYcJobPostingMessage(request).then(sendResponse);
    return true;
  }

  if (request.type === FETCH_ASHBY_JOB_POSTING_MESSAGE) {
    handleFetchAshbyJobPostingMessage(request).then(sendResponse);
    return true;
  }

  return false;
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
    FETCH_ASHBY_JOB_POSTING_MESSAGE: FETCH_ASHBY_JOB_POSTING_MESSAGE,
    FETCH_HTML_FALLBACK_MESSAGE: FETCH_HTML_FALLBACK_MESSAGE,
    FETCH_YC_JOB_POSTING_MESSAGE: FETCH_YC_JOB_POSTING_MESSAGE,
    HTML_ACCEPT_HEADER: HTML_ACCEPT_HEADER,
    decodeHtmlEntities: decodeHtmlEntities,
    extractYcJobPostingUrlFromCompanyHtml: extractYcJobPostingUrlFromCompanyHtml,
    getCanonicalAshbyJobPostingUrl: getCanonicalAshbyJobPostingUrl,
    getCanonicalLeverPostingUrl: getCanonicalLeverPostingUrl,
    getCommandByName: getCommandByName,
    getYcCompanyUrl: getYcCompanyUrl,
    handleFetchAshbyJobPostingMessage: handleFetchAshbyJobPostingMessage,
    handleFetchHtmlFallbackMessage: handleFetchHtmlFallbackMessage,
    handleFetchYcJobPostingMessage: handleFetchYcJobPostingMessage,
    handleRuntimeMessage: handleRuntimeMessage,
    hasExactWaasJobId: hasExactWaasJobId,
    isCommandShortcutUnassigned: isCommandShortcutUnassigned,
    isSupportedPageUrl: isSupportedPageUrl,
    validateYcJobPostingUrl: validateYcJobPostingUrl
  };
}
