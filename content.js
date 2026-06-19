(function () {
  "use strict";

  var BADGE_ID = "jobdatelens-badge";
  var NOTICE_ID = "jobdatelens-notice";
  var SCRIPT_TYPE = "application/ld+json";
  var DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;
  var TRANSIENT_NOTICE_DURATION_MS = 3000;
  var HTML_FETCH_TIMEOUT_MS = 1500;

  if (typeof window !== "undefined" && window.JobDateLens && window.JobDateLens.scanOnce) {
    return;
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSearchText(value) {
    return normalizeWhitespace(value).toLowerCase();
  }

  function isJsonLdType(value) {
    return normalizeSearchText(value).split(";")[0] === SCRIPT_TYPE;
  }

  function firstText(value) {
    if (value == null) {
      return "";
    }

    if (typeof value === "string" || typeof value === "number") {
      return normalizeWhitespace(value);
    }

    if (Array.isArray(value)) {
      for (var index = 0; index < value.length; index += 1) {
        var itemText = firstText(value[index]);
        if (itemText) {
          return itemText;
        }
      }
      return "";
    }

    if (typeof value === "object") {
      return firstText(value.name || value.legalName || value.text || value["@value"] || value["@id"]);
    }

    return "";
  }

  function getTypes(node) {
    var rawTypes = node && node["@type"];
    var values = Array.isArray(rawTypes) ? rawTypes : [rawTypes];

    return values
      .filter(function (value) {
        return typeof value === "string";
      })
      .map(function (value) {
        return value.trim();
      })
      .filter(Boolean);
  }

  function isJobPostingType(value) {
    var normalized = String(value || "").trim().toLowerCase();
    return (
      normalized === "jobposting" ||
      normalized === "schema:jobposting" ||
      normalized.endsWith("/jobposting") ||
      normalized.endsWith("#jobposting")
    );
  }

  function isJobPostingNode(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return false;
    }

    return getTypes(node).some(isJobPostingType);
  }

  function getCompanyName(node) {
    return firstText(
      node.hiringOrganization ||
        node.organization ||
        node.employerOverview ||
        node.company ||
        node.provider
    );
  }

  function createCandidate(node, sourceIndex, path) {
    return {
      node: node,
      sourceIndex: sourceIndex,
      path: path,
      title: firstText(node.title || node.name),
      company: getCompanyName(node),
      datePostedRaw: firstText(node.datePosted),
      validThroughRaw: firstText(node.validThrough)
    };
  }

  function collectJobPostings(value, sourceIndex, path, results) {
    if (!value || typeof value !== "object") {
      return results;
    }

    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        collectJobPostings(item, sourceIndex, path + "[" + index + "]", results);
      });
      return results;
    }

    if (isJobPostingNode(value)) {
      results.push(createCandidate(value, sourceIndex, path));
      return results;
    }

    Object.keys(value).forEach(function (key) {
      if (key === "@context" || key === "@type") {
        return;
      }
      collectJobPostings(value[key], sourceIndex, path + "." + key, results);
    });

    return results;
  }

  function parseJsonLdText(text) {
    return JSON.parse(String(text || "").trim());
  }

  function extractJobPostingsFromJsonLd(jsonLdValue, sourceIndex) {
    return collectJobPostings(jsonLdValue, sourceIndex || 0, "$", []);
  }

  function parseSchemaDate(rawValue, usage) {
    var raw = firstText(rawValue);
    var dateOnlyMatch;
    var date;
    var year;
    var month;
    var day;

    if (!raw) {
      return {
        state: "missing",
        raw: "",
        date: null,
        dateOnly: false
      };
    }

    dateOnlyMatch = raw.match(DATE_ONLY_RE);
    if (dateOnlyMatch) {
      year = Number(dateOnlyMatch[1]);
      month = Number(dateOnlyMatch[2]);
      day = Number(dateOnlyMatch[3]);
      date =
        usage === "validThrough"
          ? new Date(year, month - 1, day, 23, 59, 59, 999)
          : new Date(year, month - 1, day);

      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return {
          state: "invalid",
          raw: raw,
          date: null,
          dateOnly: true
        };
      }

      return {
        state: "valid",
        raw: raw,
        date: date,
        dateOnly: true
      };
    }

    date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return {
        state: "invalid",
        raw: raw,
        date: null,
        dateOnly: false
      };
    }

    return {
      state: "valid",
      raw: raw,
      date: date,
      dateOnly: false
    };
  }

  function wordOverlapRatio(needle, haystack) {
    var words = normalizeSearchText(needle)
      .split(" ")
      .filter(function (word) {
        return word.length > 2;
      });
    var hits = 0;

    if (!words.length || !haystack) {
      return 0;
    }

    words.forEach(function (word) {
      if (haystack.indexOf(word) !== -1) {
        hits += 1;
      }
    });

    return hits / words.length;
  }

  function getSignificantWords(value) {
    var seen = {};

    return normalizeSearchText(value)
      .split(/[^a-z0-9]+/)
      .filter(function (word) {
        if (word.length <= 2 || seen[word]) {
          return false;
        }
        seen[word] = true;
        return true;
      });
  }

  function countSharedWords(leftWords, rightWords) {
    var rightLookup = {};
    var count = 0;

    rightWords.forEach(function (word) {
      rightLookup[word] = true;
    });

    leftWords.forEach(function (word) {
      if (rightLookup[word]) {
        count += 1;
      }
    });

    return count;
  }

  function titleSignalMatches(candidateTitle, signal) {
    var candidate = normalizeSearchText(candidateTitle);
    var normalizedSignal = normalizeSearchText(signal);
    var candidateWords = getSignificantWords(candidateTitle);
    var signalWords = getSignificantWords(signal);
    var shared;

    if (!candidate || !normalizedSignal) {
      return false;
    }

    if (normalizedSignal.indexOf(candidate) !== -1) {
      return true;
    }

    if (
      candidateWords.length >= 2 &&
      signalWords.length >= 2 &&
      candidate.indexOf(normalizedSignal) !== -1
    ) {
      return true;
    }

    if (candidateWords.length < 2 || signalWords.length < 2) {
      return false;
    }

    shared = countSharedWords(candidateWords, signalWords);
    return shared >= 2 && shared / Math.min(candidateWords.length, signalWords.length) >= 0.75;
  }

  function titleSignalClearlyConflicts(candidateTitle, signal) {
    var candidateWords = getSignificantWords(candidateTitle);
    var signalWords = getSignificantWords(signal);
    var shared;

    if (titleSignalMatches(candidateTitle, signal)) {
      return false;
    }

    if (candidateWords.length < 1 || signalWords.length < 1) {
      return false;
    }

    shared = countSharedWords(candidateWords, signalWords);
    return (
      shared === 0 ||
      (shared / candidateWords.length < 0.5 && shared / signalWords.length < 0.5)
    );
  }

  function isGenericHeadingSignal(heading) {
    var key = getSignificantWords(heading).join(" ");
    var genericHeadings = {
      "job details": true,
      "job detail": true,
      "job description": true,
      "open role": true,
      "open roles": true,
      "open position": true,
      "open positions": true,
      "current opening": true,
      "current openings": true,
      careers: true,
      "apply now": true,
      "join our team": true
    };

    return Boolean(genericHeadings[key]);
  }

  function isStaleJobPosting(candidate, pageContext) {
    var context = pageContext || {};
    var candidateTitle = candidate && candidate.title;
    var heading = context.heading || "";
    var pageTitle = context.title || "";
    var headingIsGeneric = isGenericHeadingSignal(heading);

    if (!candidateTitle) {
      return false;
    }

    if (titleSignalMatches(candidateTitle, heading) || titleSignalMatches(candidateTitle, pageTitle)) {
      return false;
    }

    if (!headingIsGeneric && titleSignalClearlyConflicts(candidateTitle, heading)) {
      return true;
    }

    return false;
  }

  function scoreCandidate(candidate, pageContext) {
    var context = pageContext || {};
    var title = normalizeSearchText(candidate.title);
    var company = normalizeSearchText(candidate.company);
    var pageTitle = normalizeSearchText(context.title);
    var heading = normalizeSearchText(context.heading);
    var haystack = normalizeSearchText(
      [context.title, context.heading, context.visibleText].filter(Boolean).join(" ")
    );
    var postedDate = parseSchemaDate(candidate.datePostedRaw, "datePosted");
    var validThrough = parseSchemaDate(candidate.validThroughRaw, "validThrough");
    var score = 100;

    if (candidate.datePostedRaw) {
      score += 30;
    }
    if (candidate.validThroughRaw) {
      score += 20;
    }
    if (postedDate.state === "valid") {
      score += 10;
    }
    if (validThrough.state === "valid") {
      score += 10;
    }
    if (candidate.title) {
      score += 10;
    }
    if (candidate.company) {
      score += 8;
    }

    if (title && (pageTitle.indexOf(title) !== -1 || heading.indexOf(title) !== -1)) {
      score += 35;
    } else if (title && wordOverlapRatio(candidate.title, haystack) >= 0.6) {
      score += 20;
    }

    if (company && haystack.indexOf(company) !== -1) {
      score += 15;
    }

    if (candidate.path && candidate.path.indexOf("itemListElement") !== -1 && !title) {
      score -= 8;
    }

    return score;
  }

  function selectBestJobPosting(candidates, pageContext) {
    var scored;
    var eligibleCandidates;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    eligibleCandidates = candidates
      .map(function (candidate, index) {
        return {
          candidate: candidate,
          index: index
        };
      })
      .filter(function (entry) {
        return !isStaleJobPosting(entry.candidate, pageContext || {});
      });

    if (eligibleCandidates.length === 0) {
      return null;
    }

    scored = eligibleCandidates.map(function (entry) {
      return {
        candidate: entry.candidate,
        index: entry.index,
        score: scoreCandidate(entry.candidate, pageContext)
      };
    });

    scored.sort(function (left, right) {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.candidate.sourceIndex !== right.candidate.sourceIndex) {
        return left.candidate.sourceIndex - right.candidate.sourceIndex;
      }
      return left.index - right.index;
    });

    return Object.assign({}, scored[0].candidate, {
      selectedIndex: scored[0].index,
      score: scored[0].score
    });
  }

  function scanJsonLdTexts(texts, pageContext) {
    var candidates = [];
    var errors = [];
    var context = pageContext || {};
    var staleCandidates;

    (texts || []).forEach(function (text, sourceIndex) {
      var jsonLdValue;

      try {
        jsonLdValue = parseJsonLdText(text);
        candidates = candidates.concat(extractJobPostingsFromJsonLd(jsonLdValue, sourceIndex));
      } catch (error) {
        errors.push({
          sourceIndex: sourceIndex,
          message: error && error.message ? error.message : String(error)
        });
      }
    });

    staleCandidates = candidates.filter(function (candidate) {
      return isStaleJobPosting(candidate, context);
    });

    return {
      candidates: candidates,
      selected: selectBestJobPosting(candidates, context),
      staleCandidates: staleCandidates,
      errors: errors
    };
  }

  function shouldFetchHtmlFallback(scanResult, jsonLdTexts, readyState) {
    var result = scanResult || {};

    if (result.selected || (readyState && readyState !== "complete")) {
      return false;
    }

    return true;
  }

  function getNoResultNotice(scanResult, jsonLdTexts, readyState) {
    var result = scanResult || {};
    var texts = jsonLdTexts || [];
    var errors = Array.isArray(result.errors) ? result.errors : [];
    var staleCandidates = Array.isArray(result.staleCandidates) ? result.staleCandidates : [];

    if (result.selected) {
      return null;
    }

    if (readyState && readyState !== "complete") {
      return {
        message: "Job page is still loading",
        helper: "Try again shortly if the job dates do not appear."
      };
    }

    if (staleCandidates.length) {
      return {
        message: "Structured job data looks stale",
        helper:
          "The current DOM's JobPosting JSON-LD does not match the visible job."
      };
    }

    if (!texts.length) {
      return {
        message: "No structured job data found",
        helper: "JobDateLens only reads schema.org JobPosting JSON-LD."
      };
    }

    if (errors.length === texts.length) {
      return {
        message: "Structured job data could not be read",
        helper: "The page includes JSON-LD, but it is not valid JSON."
      };
    }

    return {
      message: "No JobPosting JSON-LD found",
      helper: "This page has structured data, but not schema.org JobPosting data."
    };
  }

  function getHtmlFallbackNoResultNotice() {
    return {
      message: "No trustworthy job data found",
      helper:
        "Neither the live page nor the current URL's HTML includes matching schema.org JobPosting JSON-LD."
    };
  }

  function getHtmlFetchFailureNotice(error) {
    var message = error && error.message ? error.message : String(error || "");

    return {
      message: "Current page HTML could not be fetched",
      helper:
        "JobDateLens could not re-read this URL's server HTML. Reload the page, then press the shortcut again." +
        (message ? " (" + message + ")" : "")
    };
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function sameLocalDay(left, right) {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  function formatDate(dateInfo) {
    var options;

    if (dateInfo.state === "missing") {
      return "Missing";
    }
    if (dateInfo.state === "invalid") {
      return dateInfo.raw ? "Invalid: " + dateInfo.raw : "Invalid";
    }

    options = dateInfo.dateOnly
      ? { year: "numeric", month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

    try {
      return new Intl.DateTimeFormat(undefined, options).format(dateInfo.date);
    } catch (error) {
      return dateInfo.date.toLocaleDateString();
    }
  }

  function formatPostedHelper(dateInfo, now) {
    var days;

    if (dateInfo.state === "missing") {
      return "datePosted is missing";
    }
    if (dateInfo.state === "invalid") {
      return "datePosted is invalid";
    }

    days = Math.floor((startOfLocalDay(now) - startOfLocalDay(dateInfo.date)) / MS_PER_DAY);
    if (days === 0) {
      return "posted today";
    }
    if (days === 1) {
      return "posted 1 day ago";
    }
    if (days > 1) {
      return "posted " + days + " days ago";
    }
    if (days === -1) {
      return "posts tomorrow";
    }
    return "posts in " + Math.abs(days) + " days";
  }

  function formatExpiryHelper(dateInfo, now) {
    var days;

    if (dateInfo.state === "missing") {
      return "no validThrough provided";
    }
    if (dateInfo.state === "invalid") {
      return "validThrough is invalid";
    }
    if (now.getTime() > dateInfo.date.getTime()) {
      days = Math.floor((startOfLocalDay(now) - startOfLocalDay(dateInfo.date)) / MS_PER_DAY);
      if (days === 0) {
        return "expired today";
      }
      if (days === 1) {
        return "expired 1 day ago";
      }
      return "expired " + days + " days ago";
    }
    if (sameLocalDay(now, dateInfo.date)) {
      return "expires today";
    }

    days = Math.ceil((startOfLocalDay(dateInfo.date) - startOfLocalDay(now)) / MS_PER_DAY);
    if (days === 1) {
      return "expires tomorrow";
    }
    return "expires in " + days + " days";
  }

  function getStatus(postedDate, validThrough, now) {
    if (postedDate.state === "missing" && validThrough.state === "missing") {
      return { kind: "missing", label: "Missing dates" };
    }
    if (postedDate.state === "missing") {
      return { kind: "warning", label: "Missing posted" };
    }
    if (postedDate.state === "invalid" || validThrough.state === "invalid") {
      return { kind: "warning", label: "Invalid date" };
    }
    if (validThrough.state === "missing") {
      return { kind: "missing", label: "No expiry" };
    }
    if (now.getTime() > validThrough.date.getTime()) {
      return { kind: "expired", label: "Expired" };
    }
    return { kind: "open", label: "Open" };
  }

  function formatJobPosting(candidate, now) {
    var postedDate = parseSchemaDate(candidate.datePostedRaw, "datePosted");
    var validThrough = parseSchemaDate(candidate.validThroughRaw, "validThrough");
    var currentTime = now || new Date();

    return {
      title: candidate.title || "Untitled job posting",
      company: candidate.company || "Unknown company",
      postedDate: {
        label: formatDate(postedDate),
        helper: formatPostedHelper(postedDate, currentTime),
        state: postedDate.state
      },
      validThrough: {
        label: formatDate(validThrough),
        helper: formatExpiryHelper(validThrough, currentTime),
        state: validThrough.state
      },
      status: getStatus(postedDate, validThrough, currentTime),
      score: candidate.score
    };
  }

  function createRow(label, value, helper, state) {
    var row = document.createElement("div");
    var labelNode = document.createElement("div");
    var valueWrap = document.createElement("div");
    var valueNode = document.createElement("div");
    var helperNode = document.createElement("div");

    row.className = "jdl-row";
    labelNode.className = "jdl-label";
    labelNode.textContent = label;

    valueWrap.className = "jdl-value-wrap";
    valueNode.className = "jdl-value";
    if (state === "missing" || state === "invalid") {
      valueNode.className += " jdl-value--problem";
    }
    if (state === "expired") {
      valueNode.className += " jdl-value--expired";
    }
    valueNode.textContent = value;

    helperNode.className = "jdl-helper";
    helperNode.textContent = helper || "";

    valueWrap.appendChild(valueNode);
    if (helper) {
      valueWrap.appendChild(helperNode);
    }
    row.appendChild(labelNode);
    row.appendChild(valueWrap);
    return row;
  }

  function removeBadge() {
    var existing = document.getElementById(BADGE_ID);
    if (existing) {
      existing.remove();
    }
  }

  function collectJsonLdScriptTexts(doc) {
    return Array.prototype.slice
      .call(doc.scripts || [])
      .filter(function (script) {
        return isJsonLdType(script.type);
      })
      .map(function (script) {
        return script.textContent || "";
      });
  }

  function getPageContext(doc) {
    var heading = doc.querySelector ? doc.querySelector("h1") : null;
    var bodyText = "";

    if (doc.body) {
      bodyText = doc.body.innerText || doc.body.textContent || "";
    }

    return {
      title: doc.title || "",
      heading: heading ? heading.textContent || "" : "",
      visibleText: bodyText.slice(0, 50000)
    };
  }

  function scanDocument(doc, pageContext) {
    var jsonLdTexts = collectJsonLdScriptTexts(doc);
    var result = scanJsonLdTexts(jsonLdTexts, pageContext || getPageContext(doc));

    return {
      jsonLdTexts: jsonLdTexts,
      result: result,
      readyState: doc.readyState || "complete"
    };
  }

  function parseHtmlDocument(htmlText, parser) {
    var htmlParser = parser;

    if (!htmlParser && typeof DOMParser !== "undefined") {
      htmlParser = new DOMParser();
    }

    if (!htmlParser || typeof htmlParser.parseFromString !== "function") {
      throw new Error("DOMParser is not available.");
    }

    return htmlParser.parseFromString(String(htmlText || ""), "text/html");
  }

  function scanHtmlText(htmlText, pageContext, parser) {
    return scanDocument(parseHtmlDocument(htmlText, parser), pageContext || {});
  }

  function installBrowserApi() {
    var currentUrl = window.location.href;
    var collapsed = false;
    var noticeTimer = null;
    var activeScanId = 0;

    function resetInteractionForNewUrl() {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        collapsed = false;
      }
    }

    function removeNotice() {
      var existing = document.getElementById(NOTICE_ID);
      if (existing) {
        existing.remove();
      }
      window.clearTimeout(noticeTimer);
      noticeTimer = null;
    }

    function showNotice(message, helper, options) {
      var notice;
      var messageNode;
      var helperNode;
      var closeButton;
      var persistent = Boolean(options && options.persistent);
      var durationMs =
        options && typeof options.durationMs === "number"
          ? options.durationMs
          : TRANSIENT_NOTICE_DURATION_MS;

      if (persistent && !(options && typeof options.durationMs === "number")) {
        durationMs = 0;
      }

      if (!document.body) {
        return;
      }

      removeNotice();

      notice = document.createElement("aside");
      notice.id = NOTICE_ID;
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");

      messageNode = document.createElement("div");
      messageNode.textContent = message;
      notice.appendChild(messageNode);

      if (helper) {
        helperNode = document.createElement("div");
        helperNode.className = "jdl-notice-helper";
        helperNode.textContent = helper;
        notice.appendChild(helperNode);
      }

      if (persistent) {
        closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "jdl-notice-close";
        closeButton.title = "Close JobDateLens notice";
        closeButton.setAttribute("aria-label", closeButton.title);
        closeButton.textContent = "x";
        closeButton.addEventListener("click", removeNotice);
        notice.appendChild(closeButton);
      }

      document.body.appendChild(notice);
      if (durationMs > 0) {
        noticeTimer = window.setTimeout(removeNotice, durationMs);
      }
    }

    function renderBadge(scanResult) {
      var badge = document.getElementById(BADGE_ID);
      var model;
      var header;
      var title;
      var status;
      var actions;
      var toggleButton;
      var closeButton;
      var body;
      var expiryState;

      if (!scanResult.selected) {
        removeBadge();
        return;
      }

      removeNotice();

      model = formatJobPosting(scanResult.selected, new Date());
      expiryState = model.status.kind === "expired" ? "expired" : model.validThrough.state;

      if (!badge) {
        badge = document.createElement("aside");
        badge.id = BADGE_ID;
        badge.setAttribute("role", "status");
        badge.setAttribute("aria-live", "polite");
        document.body.appendChild(badge);
      }

      badge.className =
        "jdl-badge jdl-status--" +
        model.status.kind +
        (collapsed ? " jdl-badge--collapsed" : "");

      header = document.createElement("div");
      header.className = "jdl-header";

      title = document.createElement("div");
      title.className = "jdl-title";
      title.title = "JobDateLens";
      title.textContent = "JobDateLens";

      status = document.createElement("div");
      status.className = "jdl-status";
      status.textContent = model.status.label;

      actions = document.createElement("div");
      actions.className = "jdl-actions";

      toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "jdl-icon-button";
      toggleButton.title = collapsed ? "Expand JobDateLens" : "Collapse JobDateLens";
      toggleButton.setAttribute("aria-label", toggleButton.title);
      toggleButton.textContent = collapsed ? "v" : "^";
      toggleButton.addEventListener("click", function () {
        collapsed = !collapsed;
        renderBadge(scanResult);
      });

      closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "jdl-icon-button";
      closeButton.title = "Close JobDateLens for this page";
      closeButton.setAttribute("aria-label", closeButton.title);
      closeButton.textContent = "x";
      closeButton.addEventListener("click", removeBadge);

      actions.appendChild(toggleButton);
      actions.appendChild(closeButton);
      header.appendChild(title);
      header.appendChild(status);
      header.appendChild(actions);

      body = document.createElement("div");
      body.className = "jdl-body";
      body.appendChild(createRow("Role", model.title, "", "valid"));
      body.appendChild(createRow("Company", model.company, "", "valid"));
      body.appendChild(
        createRow("Posted", model.postedDate.label, model.postedDate.helper, model.postedDate.state)
      );
      body.appendChild(
        createRow("Expires", model.validThrough.label, model.validThrough.helper, expiryState)
      );

      badge.replaceChildren(header, body);
    }

    function summarizeScan(snapshot, source, reason) {
      return {
        found: Boolean(snapshot && snapshot.result && snapshot.result.selected),
        candidates: snapshot && snapshot.result ? snapshot.result.candidates.length : 0,
        errors: snapshot && snapshot.result ? snapshot.result.errors.length : 0,
        stale:
          snapshot && snapshot.result && Array.isArray(snapshot.result.staleCandidates)
            ? snapshot.result.staleCandidates.length
            : 0,
        source: source || "",
        reason: reason || ""
      };
    }

    function fetchCurrentPageHtml(url) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var options = {
        cache: "no-store",
        credentials: "include"
      };
      var timeoutId;

      if (controller) {
        options.signal = controller.signal;
      }

      return new Promise(function (resolve, reject) {
        timeoutId = window.setTimeout(function () {
          if (controller) {
            controller.abort();
          }
          reject(new Error("Timed out after " + HTML_FETCH_TIMEOUT_MS + "ms."));
        }, HTML_FETCH_TIMEOUT_MS);

        window
          .fetch(url, options)
          .then(function (response) {
            if (!response.ok) {
              throw new Error("HTTP " + response.status);
            }
            return response.text();
          })
          .then(
            function (htmlText) {
              window.clearTimeout(timeoutId);
              resolve(htmlText);
            },
            function (error) {
              window.clearTimeout(timeoutId);
              reject(error);
            }
          );
      });
    }

    async function scanOnce() {
      var scanId = activeScanId + 1;
      var pageContext;
      var domSnapshot;
      var htmlSnapshot;
      var notice;
      var url;
      var htmlText;

      activeScanId = scanId;

      if (!document.body) {
        return {
          found: false,
          candidates: 0,
          errors: 0,
          stale: 0,
          reason: "document-not-ready"
        };
      }

      resetInteractionForNewUrl();
      removeBadge();
      showNotice("Scanning current page...", "Reading schema.org JobPosting JSON-LD.", {
        durationMs: 0
      });

      pageContext = getPageContext(document);
      domSnapshot = scanDocument(document, pageContext);

      if (domSnapshot.result.selected) {
        renderBadge(domSnapshot.result);
        return summarizeScan(domSnapshot, "dom");
      }

      if (
        !shouldFetchHtmlFallback(
          domSnapshot.result,
          domSnapshot.jsonLdTexts,
          domSnapshot.readyState
        )
      ) {
        notice = getNoResultNotice(
          domSnapshot.result,
          domSnapshot.jsonLdTexts,
          domSnapshot.readyState
        );
        showNotice(notice.message, notice.helper);
        return summarizeScan(domSnapshot, "dom");
      }

      url = window.location.href;
      try {
        htmlText = await fetchCurrentPageHtml(url);
        if (scanId !== activeScanId) {
          return summarizeScan(null, "html", "scan-superseded");
        }
        if (window.location.href !== url) {
          removeNotice();
          return summarizeScan(null, "html", "scan-superseded");
        }

        htmlSnapshot = scanHtmlText(htmlText, pageContext);
        if (htmlSnapshot.result.selected) {
          renderBadge(htmlSnapshot.result);
          return summarizeScan(htmlSnapshot, "html");
        }

        removeBadge();
        notice = getHtmlFallbackNoResultNotice();
        showNotice(notice.message, notice.helper, { persistent: true });
        return summarizeScan(htmlSnapshot, "html", "html-no-match");
      } catch (error) {
        if (scanId !== activeScanId) {
          return summarizeScan(null, "html", "scan-superseded");
        }
        if (window.location.href !== url) {
          removeNotice();
          return summarizeScan(null, "html", "scan-superseded");
        }

        removeBadge();
        notice = getHtmlFetchFailureNotice(error);
        showNotice(notice.message, notice.helper, { persistent: true });
        return summarizeScan(domSnapshot, "dom", "html-fetch-failed");
      }
    }

    window.JobDateLens = Object.assign({}, api, {
      scanOnce: scanOnce
    });
  }

  var api = {
    parseJsonLdText: parseJsonLdText,
    extractJobPostingsFromJsonLd: extractJobPostingsFromJsonLd,
    scanJsonLdTexts: scanJsonLdTexts,
    getNoResultNotice: getNoResultNotice,
    getHtmlFallbackNoResultNotice: getHtmlFallbackNoResultNotice,
    shouldFetchHtmlFallback: shouldFetchHtmlFallback,
    selectBestJobPosting: selectBestJobPosting,
    scoreCandidate: scoreCandidate,
    isStaleJobPosting: isStaleJobPosting,
    parseSchemaDate: parseSchemaDate,
    scanDocument: scanDocument,
    scanHtmlText: scanHtmlText,
    formatJobPosting: formatJobPosting,
    isJsonLdType: isJsonLdType,
    HTML_FETCH_TIMEOUT_MS: HTML_FETCH_TIMEOUT_MS,
    TRANSIENT_NOTICE_DURATION_MS: TRANSIENT_NOTICE_DURATION_MS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    installBrowserApi();
  }
})();
