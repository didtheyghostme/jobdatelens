(function () {
  "use strict";

  var BADGE_ID = "jobdatelens-badge";
  var NOTICE_ID = "jobdatelens-notice";
  var SCRIPT_TYPE = "application/ld+json";
  var DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;
  var TRANSIENT_NOTICE_DURATION_MS = 3000;
  var HTML_FETCH_TIMEOUT_MS = 1500;
  var FETCH_HTML_FALLBACK_MESSAGE = "jobdatelens:fetchHtmlFallback";
  var FETCH_YC_JOB_POSTING_MESSAGE = "jobdatelens:fetchYcJobPosting";
  var FETCH_ASHBY_JOB_POSTING_MESSAGE = "jobdatelens:fetchAshbyJobPosting";
  var STOP_SESSION_MESSAGE = "jobdatelens:stopSession";
  var HTML_ACCEPT_HEADER =
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  var JSON_ACCEPT_HEADER = "application/json";
  var GREENHOUSE_API_ORIGIN = "https://boards-api.greenhouse.io";
  var ASHBY_JOB_HOSTNAME = "jobs.ashbyhq.com";
  var DATE_SOURCE_ORDER = {
    posted: 10,
    deadline: 20,
    updated: 30,
    start: 40
  };
  var HTML_FALLBACK_CANONICALIZERS = {
    "jobs.lever.co": function (url) {
      return getCanonicalLeverPostingUrl(url.href) || url.href;
    }
  };

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

  function createDateSource(options) {
    var config = options || {};

    return {
      key: config.key || "",
      label: config.label || "",
      raw: firstText(config.raw),
      source: config.source || "",
      field: config.field || "",
      usage: config.usage || config.key || "",
      priority: typeof config.priority === "number" ? config.priority : 0,
      showWhenMissing: Boolean(config.showWhenMissing)
    };
  }

  function collectSchemaDateSourcesFromNode(node) {
    var sources = [
      createDateSource({
        key: "posted",
        label: "Posted",
        raw: node && node.datePosted,
        source: "schema.org",
        field: "datePosted",
        usage: "datePosted",
        priority: 100,
        showWhenMissing: true
      }),
      createDateSource({
        key: "deadline",
        label: "Deadline",
        raw: node && node.validThrough,
        source: "schema.org",
        field: "validThrough",
        usage: "validThrough",
        priority: 90,
        showWhenMissing: true
      })
    ];

    if (firstText(node && node.jobStartDate)) {
      sources.push(
        createDateSource({
          key: "start",
          label: "Start date",
          raw: node.jobStartDate,
          source: "schema.org",
          field: "jobStartDate",
          usage: "datePosted",
          priority: 80
        })
      );
    }

    return sources;
  }

  function createCandidate(node, sourceIndex, path) {
    return {
      node: node,
      sourceIndex: sourceIndex,
      path: path,
      title: firstText(node.title || node.name),
      company: getCompanyName(node),
      datePostedRaw: firstText(node.datePosted),
      validThroughRaw: firstText(node.validThrough),
      jobStartDateRaw: firstText(node.jobStartDate),
      dateSources: collectSchemaDateSourcesFromNode(node)
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

  function getGreenhouseNoResultNotice() {
    return {
      message: "No trustworthy job data found",
      helper: "Greenhouse returned job data, but it does not match the visible job."
    };
  }

  function getProviderFetchFailureNotice(provider, error) {
    var message = error && error.message ? error.message : String(error || "");

    return {
      message: provider + " job data could not be retrieved",
      helper:
        "JobDateLens could not read this posting from " +
        provider +
        (message ? ". (" + message + ")" : ".")
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
      return "no deadline provided";
    }
    if (dateInfo.state === "invalid") {
      return "deadline is invalid";
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

  function formatUpdatedHelper(dateInfo, now) {
    var days;

    if (dateInfo.state === "missing") {
      return "last updated date is missing";
    }
    if (dateInfo.state === "invalid") {
      return "last updated date is invalid";
    }

    days = Math.floor((startOfLocalDay(now) - startOfLocalDay(dateInfo.date)) / MS_PER_DAY);
    if (days === 0) {
      return "updated today";
    }
    if (days === 1) {
      return "updated 1 day ago";
    }
    if (days > 1) {
      return "updated " + days + " days ago";
    }
    if (days === -1) {
      return "updates tomorrow";
    }
    return "updates in " + Math.abs(days) + " days";
  }

  function formatStartHelper(dateInfo, now) {
    var days;

    if (dateInfo.state === "missing") {
      return "start date is missing";
    }
    if (dateInfo.state === "invalid") {
      return "start date is invalid";
    }

    days = Math.ceil((startOfLocalDay(dateInfo.date) - startOfLocalDay(now)) / MS_PER_DAY);
    if (days === 0) {
      return "starts today";
    }
    if (days === 1) {
      return "starts tomorrow";
    }
    if (days > 1) {
      return "starts in " + days + " days";
    }
    if (days === -1) {
      return "started 1 day ago";
    }
    return "started " + Math.abs(days) + " days ago";
  }

  function getFallbackDateSources(candidate) {
    var sources = [
      createDateSource({
        key: "posted",
        label: "Posted",
        raw: candidate && candidate.datePostedRaw,
        source: candidate && candidate.sourceProvider ? candidate.sourceProvider : "schema.org",
        field: "datePosted",
        usage: "datePosted",
        priority: 100,
        showWhenMissing: true
      }),
      createDateSource({
        key: "deadline",
        label: "Deadline",
        raw: candidate && candidate.validThroughRaw,
        source: candidate && candidate.sourceProvider ? candidate.sourceProvider : "schema.org",
        field: "validThrough",
        usage: "validThrough",
        priority: 90,
        showWhenMissing: true
      })
    ];

    if (candidate && candidate.jobStartDateRaw) {
      sources.push(
        createDateSource({
          key: "start",
          label: "Start date",
          raw: candidate.jobStartDateRaw,
          source: candidate.sourceProvider || "schema.org",
          field: "jobStartDate",
          usage: "datePosted",
          priority: 80
        })
      );
    }

    return sources;
  }

  function compareDateSourceOrder(left, right) {
    var leftOrder = Object.prototype.hasOwnProperty.call(DATE_SOURCE_ORDER, left.key)
      ? DATE_SOURCE_ORDER[left.key]
      : 999;
    var rightOrder = Object.prototype.hasOwnProperty.call(DATE_SOURCE_ORDER, right.key)
      ? DATE_SOURCE_ORDER[right.key]
      : 999;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    return left.field.localeCompare(right.field);
  }

  function getDateSourceComparableValue(source) {
    var dateInfo;

    if (!source || !source.raw) {
      return "";
    }

    dateInfo = parseSchemaDate(source.raw, source.usage);
    if (dateInfo.state === "valid") {
      return String(dateInfo.date.getTime());
    }

    return source.raw;
  }

  function normalizeDateSources(sources) {
    var grouped = {};
    var normalized = [];

    (sources || []).forEach(function (source) {
      if (!source || !source.key) {
        return;
      }
      if (!source.raw && !source.showWhenMissing) {
        return;
      }
      if (!grouped[source.key]) {
        grouped[source.key] = [];
      }
      grouped[source.key].push(source);
    });

    Object.keys(grouped).forEach(function (key) {
      var candidates = grouped[key].slice().sort(function (left, right) {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        return left.field.localeCompare(right.field);
      });
      var selected = Object.assign({}, candidates[0]);
      var selectedComparable = getDateSourceComparableValue(selected);
      var rawValues = {};
      var conflicts = [];

      candidates.forEach(function (candidate) {
        var comparable = getDateSourceComparableValue(candidate);

        if (!comparable) {
          return;
        }
        rawValues[comparable] = true;
      });

      if (Object.keys(rawValues).length > 1) {
        conflicts = candidates
          .filter(function (candidate) {
            return (
              candidate.raw &&
              getDateSourceComparableValue(candidate) !== selectedComparable
            );
          })
          .map(function (candidate) {
            return candidate.source + ": " + candidate.field + "=" + candidate.raw;
          });
      }

      if (conflicts.length) {
        selected.conflicts = conflicts;
      }
      normalized.push(selected);
    });

    return normalized.sort(compareDateSourceOrder);
  }

  function getDateSourceByKey(dateSources, key) {
    var matches = (dateSources || []).filter(function (source) {
      return source.key === key;
    });

    return matches.length ? matches[0] : null;
  }

  function getSourceHelper(dateSource) {
    if (!dateSource || !dateSource.source || !dateSource.field) {
      return "";
    }

    return dateSource.source + ": " + dateSource.field;
  }

  function formatDateSourceRow(dateSource, now) {
    var dateInfo = parseSchemaDate(dateSource.raw, dateSource.usage);
    var helper = "";
    var sourceHelper = getSourceHelper(dateSource);
    var state = dateInfo.state;
    var value;

    if (dateInfo.state === "missing") {
      value = "Not provided";
    } else {
      value = formatDate(dateInfo);
    }

    if (dateSource.key === "posted") {
      helper = formatPostedHelper(dateInfo, now);
    } else if (dateSource.key === "deadline") {
      helper = formatExpiryHelper(dateInfo, now);
      if (dateInfo.state === "valid" && now.getTime() > dateInfo.date.getTime()) {
        state = "expired";
      }
    } else if (dateSource.key === "updated") {
      helper = formatUpdatedHelper(dateInfo, now);
    } else if (dateSource.key === "start") {
      helper = formatStartHelper(dateInfo, now);
    }

    if (sourceHelper) {
      helper = helper ? helper + " (" + sourceHelper + ")" : sourceHelper;
    }
    if (dateSource.conflicts && dateSource.conflicts.length) {
      helper =
        (helper ? helper + " " : "") +
        "Source mismatch: " +
        dateSource.conflicts.join("; ");
      state = state === "valid" ? "warning" : state;
    }

    return {
      key: dateSource.key,
      label: dateSource.label,
      value: value,
      helper: helper,
      state: state,
      dateInfo: dateInfo
    };
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
    var currentTime = now || new Date();
    var candidateDateSources =
      candidate &&
      candidate.sourceProvider === "Greenhouse API" &&
      Array.isArray(candidate.dateSources) &&
      candidate.dateSources.length
        ? candidate.dateSources
        : getFallbackDateSources(candidate);
    var dateSources = normalizeDateSources(candidateDateSources);
    var dateRows = dateSources.map(function (dateSource) {
      return formatDateSourceRow(dateSource, currentTime);
    });
    var postedRow = getDateSourceByKey(dateRows, "posted") || {
      value: "Not provided",
      helper: "datePosted is missing",
      state: "missing",
      dateInfo: parseSchemaDate("", "datePosted")
    };
    var deadlineRow = getDateSourceByKey(dateRows, "deadline") || {
      value: "Not provided",
      helper: "no deadline provided",
      state: "missing",
      dateInfo: parseSchemaDate("", "validThrough")
    };
    var postedDate = postedRow.dateInfo;
    var validThrough = deadlineRow.dateInfo;

    return {
      title: candidate.title || "Untitled job posting",
      company: candidate.company || "Unknown company",
      postedDate: {
        label: postedRow.value,
        helper: postedRow.helper,
        state: postedDate.state
      },
      validThrough: {
        label: deadlineRow.value,
        helper: deadlineRow.helper,
        state: validThrough.state
      },
      status: getStatus(postedDate, validThrough, currentTime),
      dateRows: dateRows,
      score: candidate.score
    };
  }

  function compactDateRowForDebug(row) {
    return {
      key: row.key,
      label: row.label,
      value: row.value,
      state: row.state,
      helper: row.helper
    };
  }

  function getSelectedCandidateDebug(candidate) {
    var model;

    if (!candidate) {
      return null;
    }

    model = formatJobPosting(candidate, new Date());
    return {
      title: model.title,
      company: model.company,
      path: candidate.path || "",
      sourceProvider: candidate.sourceProvider || "schema.org",
      status: model.status.kind,
      dateRows: model.dateRows.map(compactDateRowForDebug)
    };
  }

  function getErrorMessage(error) {
    return error && error.message ? error.message : String(error || "");
  }

  function createScanDebug(pageUrl) {
    return {
      pageUrl: String(pageUrl || ""),
      selectedSource: "",
      dateRows: [],
      attempts: []
    };
  }

  function addDebugAttempt(debug, options) {
    var config = options || {};
    var snapshot = config.snapshot || null;
    var result = snapshot && snapshot.result ? snapshot.result : null;
    var selected = result ? getSelectedCandidateDebug(result.selected) : null;
    var attempt = {
      source: config.source || "",
      status: config.status || "skipped",
      candidates: result && Array.isArray(result.candidates) ? result.candidates.length : 0,
      stale:
        result && Array.isArray(result.staleCandidates) ? result.staleCandidates.length : 0,
      errors: result && Array.isArray(result.errors) ? result.errors.length : 0
    };

    if (!debug) {
      return attempt;
    }
    if (snapshot && Array.isArray(snapshot.jsonLdTexts)) {
      attempt.jsonLdScripts = snapshot.jsonLdTexts.length;
    }
    if (config.reason) {
      attempt.reason = config.reason;
    }
    if (config.lookup) {
      attempt.lookup = config.lookup;
    }
    if (config.error) {
      attempt.error = getErrorMessage(config.error);
    }
    if (selected) {
      attempt.selected = selected;
    }

    debug.attempts.push(attempt);
    if (attempt.status === "selected" && selected) {
      debug.selectedSource = attempt.source;
      debug.dateRows = selected.dateRows;
    }

    return attempt;
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
    if (state === "missing" || state === "invalid" || state === "warning") {
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
    return scanDocument(parseHtmlDocument(htmlText, parser), pageContext);
  }

  function snapshotWithoutSelected(snapshot) {
    if (!snapshot || !snapshot.result) {
      return snapshot;
    }

    return Object.assign({}, snapshot, {
      result: Object.assign({}, snapshot.result, {
        selected: null
      })
    });
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

  function getHtmlFallbackUrl(currentUrl) {
    var original = String(currentUrl || "");
    var parsed;
    var hostname;

    try {
      parsed = new URL(original);
    } catch (error) {
      return original;
    }

    hostname = parsed.hostname.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(HTML_FALLBACK_CANONICALIZERS, hostname)) {
      return HTML_FALLBACK_CANONICALIZERS[hostname](parsed);
    }

    return original;
  }

  function getLinkedLeverFallbackUrl(doc) {
    var links;
    var index;
    var link;
    var href;
    var canonicalUrl;

    if (!doc || typeof doc.querySelectorAll !== "function") {
      return null;
    }

    links = Array.prototype.slice.call(doc.querySelectorAll("a[href]") || []);
    for (index = 0; index < links.length; index += 1) {
      link = links[index];
      href =
        link.href ||
        (typeof link.getAttribute === "function" ? link.getAttribute("href") : "");
      canonicalUrl = getCanonicalLeverPostingUrl(href);
      if (canonicalUrl) {
        return canonicalUrl;
      }
    }

    return null;
  }

  function parseWorkAtStartupDataPage(value) {
    try {
      return JSON.parse(String(value || ""));
    } catch (error) {
      return null;
    }
  }

  function getWorkAtStartupJobIdFromUrl(value) {
    var parsed;
    var match;
    var jobId;

    try {
      parsed = new URL(String(value || ""));
    } catch (error) {
      return null;
    }

    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "www.workatastartup.com") {
      return null;
    }

    match = parsed.pathname.match(/^\/jobs\/(\d+)\/?$/);
    if (!match) {
      return null;
    }

    jobId = Number(match[1]);
    return Number.isInteger(jobId) && jobId > 0 ? jobId : null;
  }

  function getDataPageAttributeValue(doc) {
    var node;
    var value;

    if (!doc || typeof doc.querySelector !== "function") {
      return "";
    }

    node = doc.querySelector("[data-page]");
    if (!node) {
      return "";
    }

    if (typeof node.getAttribute === "function") {
      value = node.getAttribute("data-page");
      if (value) {
        return value;
      }
    }

    if (node.dataset && node.dataset.page) {
      return node.dataset.page;
    }

    if (node.attributes && node.attributes["data-page"]) {
      return node.attributes["data-page"];
    }

    return "";
  }

  function getWorkAtStartupYcLookupRequest(doc, pageUrl) {
    var jobId = getWorkAtStartupJobIdFromUrl(pageUrl);
    var dataPage = parseWorkAtStartupDataPage(getDataPageAttributeValue(doc));
    var props = dataPage && dataPage.props ? dataPage.props : {};
    var pageJobId = props.job && Number(props.job.id);
    var companySlug = props.company && props.company.slug;

    if (!jobId || !Number.isInteger(pageJobId) || pageJobId !== jobId) {
      return null;
    }

    companySlug = String(companySlug || "").trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(companySlug)) {
      return null;
    }

    return {
      jobId: jobId,
      companySlug: companySlug
    };
  }

  function getNodeUrl(node) {
    if (!node) {
      return "";
    }

    return (
      node.src ||
      node.href ||
      (typeof node.getAttribute === "function"
        ? node.getAttribute("src") || node.getAttribute("href")
        : "")
    );
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

  function getAshbyUrlInfo(value, allowBoardRoot) {
    var parsed;
    var pathSegments;
    var boardSegment;
    var jobId = null;
    var baseUrl =
      typeof window !== "undefined" && window.location
        ? window.location.href
        : "https://example.com/";

    try {
      parsed = new URL(String(value || ""), baseUrl);
    } catch (error) {
      return null;
    }

    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== ASHBY_JOB_HOSTNAME) {
      return null;
    }

    pathSegments = parsed.pathname.split("/").filter(Boolean);
    boardSegment = normalizeAshbyBoardPathSegment(pathSegments[0]);
    if (!boardSegment) {
      return null;
    }

    if (pathSegments.length === 1 && allowBoardRoot) {
      return {
        boardPathSegment: boardSegment,
        boardUrl: parsed.origin + "/" + boardSegment,
        jobId: null,
        jobUrl: ""
      };
    }

    if (pathSegments.length !== 2) {
      return null;
    }

    if (pathSegments[1] && pathSegments[1] !== "embed") {
      jobId = normalizeAshbyJobId(pathSegments[1]);
      if (!jobId) {
        return null;
      }
    }

    return {
      boardPathSegment: boardSegment,
      boardUrl: parsed.origin + "/" + boardSegment,
      jobId: jobId,
      jobUrl: jobId ? parsed.origin + "/" + boardSegment + "/" + jobId + "?embed=js" : ""
    };
  }

  function getAshbyBoardUrlFromUrl(value) {
    var info = getAshbyUrlInfo(value);

    return info ? info.boardUrl : null;
  }

  function getAshbyBoardUrlFromDocument(doc) {
    var nodes = [];
    var boardUrl = null;

    if (!doc) {
      return null;
    }

    if (doc.scripts) {
      nodes = nodes.concat(Array.prototype.slice.call(doc.scripts || []));
    }
    if (typeof doc.querySelectorAll === "function") {
      nodes = nodes.concat(
        Array.prototype.slice.call(
          doc.querySelectorAll("iframe[src], script[src], link[href], a[href]") || []
        )
      );
    }

    nodes.some(function (node) {
      boardUrl = getAshbyBoardUrlFromUrl(getNodeUrl(node));
      return Boolean(boardUrl);
    });

    return boardUrl;
  }

  function getAshbyJobIdFromUrl(parsed) {
    return normalizeAshbyJobId(parsed.searchParams.get("ashby_jid"));
  }

  function getAshbyJobPostingUrl(boardUrl, jobId) {
    var info = getAshbyUrlInfo(boardUrl, true);
    var id = normalizeAshbyJobId(jobId);

    if (!info || !id) {
      return null;
    }

    return info.boardUrl + "/" + id + "?embed=js";
  }

  function getAshbyLookupRequest(doc, pageUrl) {
    var parsed;
    var boardUrl;
    var jobId;
    var jobUrl;

    try {
      parsed = new URL(String(pageUrl || ""));
    } catch (error) {
      return null;
    }

    if (parsed.protocol !== "https:") {
      return null;
    }

    jobId = getAshbyJobIdFromUrl(parsed);
    boardUrl = getAshbyBoardUrlFromDocument(doc);
    jobUrl = getAshbyJobPostingUrl(boardUrl, jobId);

    return jobUrl
      ? {
          boardUrl: boardUrl,
          jobId: jobId,
          jobUrl: jobUrl
        }
      : null;
  }

  function getAshbyLookupDebugInfo(doc, pageUrl) {
    var request = getAshbyLookupRequest(doc, pageUrl);
    var parsed;
    var boardUrl = "";
    var jobId = "";
    var reason = "";

    if (request) {
      return {
        request: request,
        lookup: {
          boardUrl: request.boardUrl,
          jobId: request.jobId,
          jobUrl: request.jobUrl
        },
        skipReason: ""
      };
    }

    try {
      parsed = new URL(String(pageUrl || ""));
    } catch (error) {
      return {
        request: null,
        lookup: {},
        skipReason: "invalid-url"
      };
    }

    if (parsed.protocol !== "https:") {
      return {
        request: null,
        lookup: {},
        skipReason: "unsupported-url"
      };
    }

    jobId = getAshbyJobIdFromUrl(parsed) || "";
    boardUrl = getAshbyBoardUrlFromDocument(doc) || "";
    if (!jobId) {
      reason = "missing-job-id";
    } else if (!boardUrl) {
      reason = "missing-board-url";
    } else {
      reason = "invalid-lookup";
    }

    return {
      request: null,
      lookup: {
        boardUrl: boardUrl,
        jobId: jobId
      },
      skipReason: reason
    };
  }

  function normalizeGreenhouseBoardToken(value) {
    var token = String(value || "").trim().toLowerCase();

    return /^[a-z0-9-]+$/.test(token) ? token : null;
  }

  function normalizeGreenhouseJobId(value) {
    var jobId = String(value || "").trim();

    return /^\d+$/.test(jobId) ? jobId : null;
  }

  function getGreenhouseApiUrl(boardToken, jobId) {
    var token = normalizeGreenhouseBoardToken(boardToken);
    var id = normalizeGreenhouseJobId(jobId);

    if (!token || !id) {
      return null;
    }

    return (
      GREENHOUSE_API_ORIGIN +
      "/v1/boards/" +
      encodeURIComponent(token) +
      "/jobs/" +
      encodeURIComponent(id)
    );
  }

  function getGreenhouseLookupFromUrl(value) {
    var parsed;
    var hostname;
    var pathSegments;
    var boardToken;
    var jobId;
    var baseUrl =
      typeof window !== "undefined" && window.location
        ? window.location.href
        : "https://example.com/";

    try {
      parsed = new URL(String(value || ""), baseUrl);
    } catch (error) {
      return null;
    }

    hostname = parsed.hostname.toLowerCase();
    if (hostname !== "job-boards.greenhouse.io" && hostname !== "boards.greenhouse.io") {
      return null;
    }

    pathSegments = parsed.pathname.split("/").filter(Boolean);

    if (pathSegments[0] === "embed") {
      boardToken = normalizeGreenhouseBoardToken(parsed.searchParams.get("for"));
      if (!boardToken) {
        return null;
      }
      if (pathSegments[1] === "job_app") {
        return {
          boardToken: boardToken,
          jobId: normalizeGreenhouseJobId(parsed.searchParams.get("token"))
        };
      }
      if (pathSegments[1] === "job_board") {
        return { boardToken: boardToken, jobId: null };
      }
      return null;
    }

    boardToken = normalizeGreenhouseBoardToken(pathSegments[0]);
    if (!boardToken) {
      return null;
    }
    jobId = pathSegments[1] === "jobs" ? normalizeGreenhouseJobId(pathSegments[2]) : null;

    // Plain boards.greenhouse.io links (board roots, section pages) are not
    // treated as token hints; only embed URLs and full posting URLs are.
    if (hostname === "boards.greenhouse.io" && !jobId) {
      return null;
    }

    return { boardToken: boardToken, jobId: jobId };
  }

  function getGreenhouseTokenFromUrl(value) {
    var lookup = getGreenhouseLookupFromUrl(value);

    return lookup ? lookup.boardToken : null;
  }

  function getGreenhouseNodeUrl(node) {
    if (!node) {
      return "";
    }

    return (
      node.src ||
      node.href ||
      (typeof node.getAttribute === "function"
        ? node.getAttribute("src") || node.getAttribute("href")
        : "")
    );
  }

  function getGreenhouseDocumentNodes(doc) {
    var nodes = [];

    if (!doc) {
      return nodes;
    }

    if (doc.scripts) {
      nodes = nodes.concat(Array.prototype.slice.call(doc.scripts || []));
    }
    if (typeof doc.querySelectorAll === "function") {
      nodes = nodes.concat(
        Array.prototype.slice.call(
          doc.querySelectorAll("iframe[src], script[src], link[href], a[href]") || []
        )
      );
    }

    return nodes;
  }

  function getGreenhouseBoardTokenFromDocument(doc) {
    var token = null;

    getGreenhouseDocumentNodes(doc).some(function (node) {
      token = getGreenhouseTokenFromUrl(getGreenhouseNodeUrl(node));
      return Boolean(token);
    });

    return token;
  }

  function getGreenhouseLookupFromDocument(doc) {
    var countsByKey = {};
    var pairsByKey = {};
    var orderedKeys = [];
    var bestKey = null;

    getGreenhouseDocumentNodes(doc).forEach(function (node) {
      var lookup = getGreenhouseLookupFromUrl(getGreenhouseNodeUrl(node));
      var key;

      if (!lookup || !lookup.boardToken || !lookup.jobId) {
        return;
      }

      key = lookup.boardToken + "/" + lookup.jobId;
      if (!Object.prototype.hasOwnProperty.call(countsByKey, key)) {
        countsByKey[key] = 0;
        pairsByKey[key] = lookup;
        orderedKeys.push(key);
      }
      countsByKey[key] += 1;
    });

    // Prefer the most linked posting; ties fall back to first occurrence so a
    // single "related roles" link cannot outrank the page's own apply links.
    orderedKeys.forEach(function (key) {
      if (bestKey === null || countsByKey[key] > countsByKey[bestKey]) {
        bestKey = key;
      }
    });

    return bestKey === null ? null : pairsByKey[bestKey];
  }

  function getGreenhouseJobIdFromUrl(parsed) {
    var pathSegments;
    var index;
    var queryJobId = normalizeGreenhouseJobId(parsed.searchParams.get("gh_jid"));

    if (queryJobId) {
      return queryJobId;
    }

    pathSegments = parsed.pathname.split("/").filter(Boolean);
    for (index = pathSegments.length - 1; index >= 0; index -= 1) {
      if (/^\d+$/.test(pathSegments[index])) {
        return pathSegments[index];
      }
    }

    return null;
  }

  function getGreenhouseLookupRequest(doc, pageUrl) {
    var parsed;
    var hostname;
    var pathSegments;
    var documentLookup;
    var boardToken = null;
    var jobId = null;
    var apiUrl;

    try {
      parsed = new URL(String(pageUrl || ""));
    } catch (error) {
      return null;
    }

    if (parsed.protocol !== "https:") {
      return null;
    }

    hostname = parsed.hostname.toLowerCase();
    pathSegments = parsed.pathname.split("/").filter(Boolean);

    if (hostname === "job-boards.greenhouse.io") {
      boardToken = pathSegments[0];
      if (pathSegments[1] === "jobs") {
        jobId = pathSegments[2];
      }
    } else if (hostname === "boards.greenhouse.io") {
      boardToken = pathSegments[0];
      if (pathSegments[1] === "jobs") {
        jobId = pathSegments[2];
      }
    } else {
      jobId = getGreenhouseJobIdFromUrl(parsed);
      documentLookup = getGreenhouseLookupFromDocument(doc);
      if (jobId) {
        if (documentLookup && documentLookup.jobId === jobId) {
          boardToken = documentLookup.boardToken;
        } else {
          boardToken = getGreenhouseBoardTokenFromDocument(doc);
        }
      } else if (documentLookup) {
        boardToken = documentLookup.boardToken;
        jobId = documentLookup.jobId;
      }
    }

    boardToken = normalizeGreenhouseBoardToken(boardToken);
    jobId = normalizeGreenhouseJobId(jobId);
    apiUrl = getGreenhouseApiUrl(boardToken, jobId);

    return apiUrl
      ? {
          boardToken: boardToken,
          jobId: jobId,
          apiUrl: apiUrl
        }
      : null;
  }

  function getGreenhouseLookupDebugInfo(doc, pageUrl) {
    var request = getGreenhouseLookupRequest(doc, pageUrl);
    var parsed;
    var hostname;
    var pathSegments;
    var documentLookup;
    var boardToken = "";
    var jobId = "";
    var reason = "";

    if (request) {
      return {
        request: request,
        lookup: {
          boardToken: request.boardToken,
          jobId: request.jobId,
          apiUrl: request.apiUrl
        },
        skipReason: ""
      };
    }

    try {
      parsed = new URL(String(pageUrl || ""));
    } catch (error) {
      return {
        request: null,
        lookup: {},
        skipReason: "invalid-url"
      };
    }

    if (parsed.protocol !== "https:") {
      return {
        request: null,
        lookup: {},
        skipReason: "unsupported-url"
      };
    }

    hostname = parsed.hostname.toLowerCase();
    pathSegments = parsed.pathname.split("/").filter(Boolean);
    if (hostname === "job-boards.greenhouse.io" || hostname === "boards.greenhouse.io") {
      boardToken = normalizeGreenhouseBoardToken(pathSegments[0]) || "";
      jobId =
        pathSegments[1] === "jobs" ? normalizeGreenhouseJobId(pathSegments[2]) || "" : "";
    } else {
      jobId = getGreenhouseJobIdFromUrl(parsed) || "";
      documentLookup = getGreenhouseLookupFromDocument(doc);
      if (jobId) {
        if (documentLookup && documentLookup.jobId === jobId) {
          boardToken = documentLookup.boardToken || "";
        } else {
          boardToken = getGreenhouseBoardTokenFromDocument(doc) || "";
        }
      } else if (documentLookup) {
        boardToken = documentLookup.boardToken || "";
        jobId = documentLookup.jobId || "";
      }
    }

    if (!jobId) {
      reason = "missing-job-id";
    } else if (!boardToken) {
      reason = "missing-board-token";
    } else {
      reason = "invalid-lookup";
    }

    return {
      request: null,
      lookup: {
        boardToken: boardToken,
        jobId: jobId
      },
      skipReason: reason
    };
  }

  function collectGreenhouseDateSources(job) {
    return [
      createDateSource({
        key: "posted",
        label: "Posted",
        raw: job && (job.first_published || job.published_at),
        source: "Greenhouse API",
        field: job && job.first_published ? "first_published" : "published_at",
        usage: "datePosted",
        priority: 110,
        showWhenMissing: true
      }),
      createDateSource({
        key: "deadline",
        label: "Deadline",
        raw: job && job.application_deadline,
        source: "Greenhouse API",
        field: "application_deadline",
        usage: "validThrough",
        priority: 100,
        showWhenMissing: true
      }),
      createDateSource({
        key: "updated",
        label: "Last updated",
        raw: job && job.updated_at,
        source: "Greenhouse API",
        field: "updated_at",
        usage: "datePosted",
        priority: 90
      })
    ];
  }

  function createGreenhouseCandidate(job, lookupRequest) {
    var dateSources = collectGreenhouseDateSources(job || {});

    return {
      node: job,
      sourceIndex: 0,
      path: "$.greenhouse",
      sourceProvider: "Greenhouse API",
      boardToken: lookupRequest && lookupRequest.boardToken,
      jobId: lookupRequest && lookupRequest.jobId,
      title: firstText(job && job.title),
      company: firstText(job && job.company_name),
      datePostedRaw: firstText(job && (job.first_published || job.published_at)),
      validThroughRaw: firstText(job && job.application_deadline),
      dateSources: dateSources
    };
  }

  function scanGreenhouseJobPosting(job, lookupRequest, pageContext) {
    var context = pageContext || {};
    var candidate = createGreenhouseCandidate(job, lookupRequest);
    var candidates = candidate.title || candidate.company ? [candidate] : [];
    var staleCandidates = candidates.filter(function (entry) {
      return isStaleJobPosting(entry, context);
    });

    return {
      candidates: candidates,
      selected: selectBestJobPosting(candidates, context),
      staleCandidates: staleCandidates,
      errors: []
    };
  }

  function createSnapshot(result, readyState) {
    return {
      jsonLdTexts: [],
      result: result,
      readyState: readyState || "complete"
    };
  }

  function isCrossOriginUrl(targetUrl, pageUrl) {
    var target;
    var page;

    try {
      target = new URL(String(targetUrl || ""));
      page = new URL(String(pageUrl || ""));
    } catch (error) {
      return false;
    }

    return target.origin !== page.origin;
  }

  function installBrowserApi() {
    var currentUrl = window.location.href;
    var currentRouteKey = getRouteKey(currentUrl);
    var collapsed = false;
    var noticeTimer = null;
    var activeScanId = 0;
    var lastScanDebug = null;
    var navigationApi = window.navigation || null;
    var navigationSessionActive = false;
    var navigationListenersInstalled = false;
    var pendingNavigation = null;
    var pendingAnimationFrameId = null;
    var activeRouteScan = null;
    var lastRenderedJsonLdTexts = null;
    var lastSuccessfulRouteKey = null;
    var staleDomFingerprint = null;

    function getRouteKey(value) {
      var parsed;

      try {
        parsed = new URL(String(value || ""), window.location.href);
      } catch (error) {
        return String(value || "").split("#")[0];
      }

      return parsed.origin + parsed.pathname + parsed.search;
    }

    function jsonLdTextsEqual(left, right) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
      }

      return left.every(function (text, index) {
        return text === right[index];
      });
    }

    function createTerminalScanSummary(reason) {
      return {
        found: false,
        candidates: 0,
        errors: 0,
        stale: 0,
        source: "",
        reason: reason || ""
      };
    }

    function createScanCompletion() {
      var resolvePromise;
      var rejectPromise;
      var completion = {
        settled: false,
        promise: null,
        resolve: null,
        reject: null
      };

      completion.promise = new Promise(function (resolve, reject) {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      completion.resolve = function (value) {
        if (completion.settled) {
          return;
        }
        completion.settled = true;
        resolvePromise(value);
      };
      completion.reject = function (error) {
        if (completion.settled) {
          return;
        }
        completion.settled = true;
        rejectPromise(error);
      };

      return completion;
    }

    function rememberStaleDomFingerprint(routeKey, jsonLdTexts) {
      if (!routeKey || !Array.isArray(jsonLdTexts)) {
        return;
      }

      staleDomFingerprint = {
        routeKey: routeKey,
        jsonLdTexts: jsonLdTexts.slice()
      };
    }

    function clearStaleDomFingerprint(routeKey) {
      if (staleDomFingerprint && staleDomFingerprint.routeKey === routeKey) {
        staleDomFingerprint = null;
      }
    }

    function getManualJsonLdGuard(routeKey) {
      if (staleDomFingerprint && staleDomFingerprint.routeKey === routeKey) {
        return staleDomFingerprint.jsonLdTexts.slice();
      }

      if (
        lastSuccessfulRouteKey &&
        routeKey !== lastSuccessfulRouteKey &&
        Array.isArray(lastRenderedJsonLdTexts)
      ) {
        return lastRenderedJsonLdTexts.slice();
      }

      return null;
    }

    function resetInteractionForNewUrl() {
      var routeKey = getRouteKey(window.location.href);

      if (routeKey !== currentRouteKey) {
        currentUrl = window.location.href;
        currentRouteKey = routeKey;
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

    function cancelPendingAnimationFrame() {
      if (pendingAnimationFrameId !== null) {
        window.cancelAnimationFrame(pendingAnimationFrameId);
        pendingAnimationFrameId = null;
      }
    }

    function supersedePendingNavigation() {
      var request = pendingNavigation;

      pendingNavigation = null;
      cancelPendingAnimationFrame();
      if (request && request.completion) {
        request.completion.resolve(createTerminalScanSummary("scan-superseded"));
      }
    }

    function supersedeActiveRouteScan() {
      var scan = activeRouteScan;

      activeRouteScan = null;
      if (scan && scan.completion) {
        scan.completion.resolve(createTerminalScanSummary("scan-superseded"));
      }
    }

    function removeNavigationListeners() {
      if (!navigationApi || !navigationListenersInstalled) {
        return;
      }

      navigationApi.removeEventListener("navigate", handleNavigate);
      navigationApi.removeEventListener("navigatesuccess", handleNavigateSuccess);
      navigationApi.removeEventListener("navigateerror", handleNavigateError);
      navigationListenersInstalled = false;
    }

    function requestBackgroundSessionStop() {
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        typeof chrome.runtime.sendMessage !== "function"
      ) {
        return;
      }

      try {
        chrome.runtime.sendMessage({ type: STOP_SESSION_MESSAGE }, function () {
          if (chrome.runtime) {
            void chrome.runtime.lastError;
          }
        });
      } catch (error) {
        return;
      }
    }

    function stopLens() {
      requestBackgroundSessionStop();
      navigationSessionActive = false;
      activeScanId += 1;
      supersedePendingNavigation();
      supersedeActiveRouteScan();
      staleDomFingerprint = null;
      removeNavigationListeners();
      removeNotice();
      removeBadge();
    }

    function startNavigationSession() {
      navigationSessionActive = true;

      if (
        !navigationApi ||
        navigationListenersInstalled ||
        typeof navigationApi.addEventListener !== "function"
      ) {
        return;
      }

      navigationApi.addEventListener("navigate", handleNavigate);
      navigationApi.addEventListener("navigatesuccess", handleNavigateSuccess);
      navigationApi.addEventListener("navigateerror", handleNavigateError);
      navigationListenersInstalled = true;
    }

    function getOrCreateBadge() {
      var badge = document.getElementById(BADGE_ID);

      if (!badge) {
        badge = document.createElement("aside");
        badge.id = BADGE_ID;
        badge.setAttribute("role", "status");
        badge.setAttribute("aria-live", "polite");
        document.body.appendChild(badge);
      }

      return badge;
    }

    function createIconButton(title, text, listener) {
      var button = document.createElement("button");

      button.type = "button";
      button.className = "jdl-icon-button";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.textContent = text;
      button.addEventListener("click", listener);
      return button;
    }

    function createBadgeHeader(statusText, scanResult, collapsible) {
      var header = document.createElement("div");
      var title = document.createElement("div");
      var status = document.createElement("div");
      var actions = document.createElement("div");
      var toggleButton;
      var closeButton;

      header.className = "jdl-header";
      title.className = "jdl-title";
      title.title = "JobDateLens";
      title.textContent = "JobDateLens";
      status.className = "jdl-status";
      status.textContent = statusText;
      actions.className = "jdl-actions";

      if (collapsible) {
        toggleButton = createIconButton(
          collapsed ? "Expand JobDateLens" : "Collapse JobDateLens",
          collapsed ? "v" : "^",
          function () {
            collapsed = !collapsed;
            renderBadge(scanResult);
          }
        );
        actions.appendChild(toggleButton);
      }

      closeButton = createIconButton("Close JobDateLens", "x", stopLens);
      actions.appendChild(closeButton);
      header.appendChild(title);
      header.appendChild(status);
      header.appendChild(actions);
      return header;
    }

    function createStateBody(message, helper, loading, action) {
      var body = document.createElement("div");
      var state = document.createElement("div");
      var spinner;
      var copy = document.createElement("div");
      var messageNode = document.createElement("div");
      var helperNode;
      var actionConfig =
        typeof action === "function"
          ? { label: "Retry", callback: action }
          : action;
      var actionButton;

      body.className = "jdl-body jdl-state-body";
      state.className = "jdl-state";

      if (loading) {
        spinner = document.createElement("span");
        spinner.className = "jdl-spinner";
        spinner.setAttribute("aria-hidden", "true");
        state.appendChild(spinner);
      }

      copy.className = "jdl-state-copy";
      messageNode.className = "jdl-state-message";
      messageNode.textContent = message;
      copy.appendChild(messageNode);

      if (helper) {
        helperNode = document.createElement("div");
        helperNode.className = "jdl-state-helper";
        helperNode.textContent = helper;
        copy.appendChild(helperNode);
      }

      if (actionConfig && typeof actionConfig.callback === "function") {
        actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "jdl-state-button";
        actionButton.textContent = actionConfig.label || "Retry";
        actionButton.addEventListener("click", actionConfig.callback);
        copy.appendChild(actionButton);
      }

      state.appendChild(copy);
      body.appendChild(state);
      return body;
    }

    function renderLoadingBadge() {
      var badge;

      if (!document.body) {
        return;
      }

      removeNotice();
      badge = getOrCreateBadge();
      badge.className = "jdl-badge jdl-status--loading";
      badge.setAttribute("aria-busy", "true");
      badge.replaceChildren(
        createBadgeHeader("Loading…", null, false),
        createStateBody(
          "Loading job dates…",
          "Checking this posting’s public date data.",
          true
        )
      );
    }

    function renderFailureBadge(helper, retryCallback) {
      var badge;

      if (!document.body) {
        return;
      }

      removeNotice();
      badge = getOrCreateBadge();
      badge.className = "jdl-badge jdl-status--warning";
      badge.setAttribute("aria-busy", "false");
      badge.replaceChildren(
        createBadgeHeader("Unavailable", null, false),
        createStateBody("Couldn’t load job dates", helper, false, retryCallback)
      );
    }

    function renderNoDataBadge(checkAgainCallback) {
      var badge;

      if (!document.body) {
        return;
      }

      removeNotice();
      badge = getOrCreateBadge();
      badge.className = "jdl-badge jdl-status--watching";
      badge.setAttribute("aria-busy", "false");
      badge.replaceChildren(
        createBadgeHeader("Watching", null, false),
        createStateBody(
          "No public job date data found",
          "JobDateLens is still active on this site. Open another job or check again.",
          false,
          {
            label: "Check again",
            callback: checkAgainCallback
          }
        )
      );
    }

    function renderBadge(scanResult) {
      var badge;
      var model;
      var body;

      if (!scanResult.selected) {
        removeBadge();
        return;
      }

      removeNotice();

      model = formatJobPosting(scanResult.selected, new Date());
      badge = getOrCreateBadge();

      badge.className =
        "jdl-badge jdl-status--" +
        model.status.kind +
        (collapsed ? " jdl-badge--collapsed" : "");

      badge.setAttribute("aria-busy", "false");

      body = document.createElement("div");
      body.className = "jdl-body";
      body.appendChild(createRow("Role", model.title, "", "valid"));
      body.appendChild(createRow("Company", model.company, "", "valid"));
      model.dateRows.forEach(function (row) {
        body.appendChild(createRow(row.label, row.value, row.helper, row.state));
      });

      badge.replaceChildren(createBadgeHeader(model.status.label, scanResult, true), body);
    }

    function getCurrentNavigationUrl() {
      if (navigationApi && navigationApi.currentEntry && navigationApi.currentEntry.url) {
        return navigationApi.currentEntry.url;
      }

      return window.location.href;
    }

    function handleNavigate(event) {
      var destination;
      var targetUrl;
      var targetRouteKey;

      if (!navigationSessionActive || !event) {
        return;
      }

      destination = event.destination;
      if (!destination || !destination.sameDocument || event.hashChange) {
        return;
      }

      targetUrl = destination.url || "";
      targetRouteKey = getRouteKey(targetUrl);
      if (!targetRouteKey || targetRouteKey === getRouteKey(window.location.href)) {
        return;
      }

      activeScanId += 1;
      supersedePendingNavigation();
      supersedeActiveRouteScan();
      collapsed = false;
      pendingNavigation = {
        generation: activeScanId,
        targetUrl: targetUrl,
        routeKey: targetRouteKey,
        previousJsonLdTexts: collectJsonLdScriptTexts(document),
        completion: createScanCompletion()
      };
      renderLoadingBadge();
    }

    function handleNavigateSuccess() {
      var routeKey;
      var request;

      if (!navigationSessionActive || !pendingNavigation) {
        return;
      }

      routeKey = getRouteKey(getCurrentNavigationUrl());
      if (routeKey !== pendingNavigation.routeKey) {
        return;
      }

      cancelPendingAnimationFrame();
      request = pendingNavigation;
      pendingAnimationFrameId = window.requestAnimationFrame(function () {
        pendingAnimationFrameId = null;
        if (
          !navigationSessionActive ||
          pendingNavigation !== request ||
          activeScanId !== request.generation ||
          getRouteKey(window.location.href) !== request.routeKey
        ) {
          if (pendingNavigation === request) {
            pendingNavigation = null;
            request.completion.resolve(
              createTerminalScanSummary("scan-superseded")
            );
          }
          return;
        }

        pendingNavigation = null;
        runNavigationScan(request).catch(function (error) {
          if (
            navigationSessionActive &&
            activeScanId === request.generation &&
            getRouteKey(window.location.href) === request.routeKey
          ) {
            renderFailureBadge(getErrorMessage(error), function () {
              retryNavigationScan(request.previousJsonLdTexts);
            });
          }
        });
      });
    }

    function handleNavigateError() {
      var request;

      if (!navigationSessionActive || !pendingNavigation) {
        return;
      }

      request = pendingNavigation;
      activeScanId += 1;
      pendingNavigation = null;
      cancelPendingAnimationFrame();
      request.completion.resolve(createTerminalScanSummary("navigation-failed"));
      renderFailureBadge("The page navigation did not complete.", scanOnce);
    }

    function recordSuccessfulScan(pageUrl) {
      currentUrl = pageUrl;
      currentRouteKey = getRouteKey(pageUrl);
      lastSuccessfulRouteKey = currentRouteKey;
      lastRenderedJsonLdTexts = collectJsonLdScriptTexts(document);
      startNavigationSession();
    }

    function getFailureHelper(notice) {
      var parts = [];

      if (notice && notice.message) {
        parts.push(notice.message);
      }
      if (notice && notice.helper) {
        parts.push(notice.helper);
      }

      return parts.join(" ") || "No trustworthy public job date data was found.";
    }

    function getRetryCallback(scanOptions) {
      var previousJsonLdTexts =
        scanOptions && Array.isArray(scanOptions.previousJsonLdTexts)
          ? scanOptions.previousJsonLdTexts.slice()
          : null;

      if (scanOptions && scanOptions.trigger === "navigation") {
        return function () {
          return retryNavigationScan(previousJsonLdTexts);
        };
      }

      return scanOnce;
    }

    function showScanFailure(notice, scanOptions) {
      renderFailureBadge(getFailureHelper(notice), getRetryCallback(scanOptions));
    }

    function showNoData(scanOptions) {
      renderNoDataBadge(getRetryCallback(scanOptions));
    }

    function runNavigationScan(request) {
      return startTrackedScan(
        {
          trigger: "navigation",
          generation: request.generation,
          expectedRouteKey: request.routeKey,
          previousJsonLdTexts: request.previousJsonLdTexts
        },
        request.completion
      );
    }

    function retryNavigationScan(previousJsonLdTexts) {
      var request;
      var routeKey;
      var jsonLdGuard;

      if (!navigationSessionActive) {
        return Promise.resolve(null);
      }

      if (pendingNavigation && !pendingNavigation.completion.settled) {
        return pendingNavigation.completion.promise;
      }

      routeKey = getRouteKey(window.location.href);
      if (
        activeRouteScan &&
        !activeRouteScan.completion.settled &&
        activeRouteScan.routeKey === routeKey
      ) {
        return activeRouteScan.completion.promise;
      }

      activeScanId += 1;
      supersedePendingNavigation();
      supersedeActiveRouteScan();
      collapsed = false;
      jsonLdGuard = Array.isArray(previousJsonLdTexts)
        ? previousJsonLdTexts.slice()
        : getManualJsonLdGuard(routeKey);
      request = {
        generation: activeScanId,
        targetUrl: window.location.href,
        routeKey: routeKey,
        previousJsonLdTexts: jsonLdGuard,
        completion: createScanCompletion()
      };
      renderLoadingBadge();
      return runNavigationScan(request);
    }

    function startTrackedScan(scanOptions, completion) {
      var scanCompletion = completion || createScanCompletion();
      var routeKey =
        scanOptions.expectedRouteKey || getRouteKey(window.location.href);
      var trackedScan = {
        generation: scanOptions.generation,
        routeKey: routeKey,
        completion: scanCompletion
      };

      activeRouteScan = trackedScan;
      scanPage(scanOptions).then(scanCompletion.resolve, scanCompletion.reject);
      scanCompletion.promise.then(
        function () {
          if (activeRouteScan === trackedScan) {
            activeRouteScan = null;
          }
        },
        function () {
          if (activeRouteScan === trackedScan) {
            activeRouteScan = null;
          }
        }
      );

      return scanCompletion.promise;
    }

    function summarizeScan(snapshot, source, reason, debug) {
      var summary = {
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

      if (debug) {
        summary.debug = debug;
      }
      if (reason !== "scan-superseded") {
        lastScanDebug = debug || null;
      }

      return summary;
    }

    function finishSelectedScan(snapshot, source, debug, pageUrl) {
      if (source === "dom") {
        clearStaleDomFingerprint(getRouteKey(pageUrl));
      }
      renderBadge(snapshot.result);
      recordSuccessfulScan(pageUrl);
      return summarizeScan(snapshot, source, "", debug);
    }

    function fetchCurrentPageHtml(url) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var options = {
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: HTML_ACCEPT_HEADER
        }
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

    function fetchCrossOriginFallbackHtml(url) {
      var timeoutId;

      return new Promise(function (resolve, reject) {
        var settled = false;

        function finish(callback) {
          return function (value) {
            if (settled) {
              return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            callback(value);
          };
        }

        var resolveOnce = finish(resolve);
        var rejectOnce = finish(reject);

        timeoutId = window.setTimeout(function () {
          rejectOnce(new Error("Timed out after " + HTML_FETCH_TIMEOUT_MS + "ms."));
        }, HTML_FETCH_TIMEOUT_MS);

        if (
          typeof chrome === "undefined" ||
          !chrome.runtime ||
          typeof chrome.runtime.sendMessage !== "function"
        ) {
          rejectOnce(new Error("Background HTML fetch is not available."));
          return;
        }

        try {
          chrome.runtime.sendMessage(
            {
              type: FETCH_HTML_FALLBACK_MESSAGE,
              url: url
            },
            function (response) {
              var lastError = chrome.runtime && chrome.runtime.lastError;

              if (lastError) {
                rejectOnce(new Error(lastError.message || "Background HTML fetch failed."));
                return;
              }

              if (!response || !response.ok) {
                rejectOnce(
                  new Error(
                    response && response.message
                      ? response.message
                      : "Background HTML fetch failed."
                  )
                );
                return;
              }

              resolveOnce(response.htmlText || "");
            }
          );
        } catch (error) {
          rejectOnce(error);
        }
      });
    }

    function fetchYcJobPostingFallbackHtml(lookupRequest) {
      var timeoutId;

      return new Promise(function (resolve, reject) {
        var settled = false;

        function finish(callback) {
          return function (value) {
            if (settled) {
              return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            callback(value);
          };
        }

        var resolveOnce = finish(resolve);
        var rejectOnce = finish(reject);

        timeoutId = window.setTimeout(function () {
          rejectOnce(new Error("Timed out after " + HTML_FETCH_TIMEOUT_MS + "ms."));
        }, HTML_FETCH_TIMEOUT_MS);

        if (
          typeof chrome === "undefined" ||
          !chrome.runtime ||
          typeof chrome.runtime.sendMessage !== "function"
        ) {
          rejectOnce(new Error("Background YC job fetch is not available."));
          return;
        }

        try {
          chrome.runtime.sendMessage(
            {
              type: FETCH_YC_JOB_POSTING_MESSAGE,
              jobId: lookupRequest.jobId,
              companySlug: lookupRequest.companySlug
            },
            function (response) {
              var lastError = chrome.runtime && chrome.runtime.lastError;

              if (lastError) {
                rejectOnce(new Error(lastError.message || "Background YC job fetch failed."));
                return;
              }

              if (!response || !response.ok) {
                rejectOnce(
                  new Error(
                    response && response.message
                      ? response.message
                      : "Background YC job fetch failed."
                  )
                );
                return;
              }

              resolveOnce(response.htmlText || "");
            }
          );
        } catch (error) {
          rejectOnce(error);
        }
      });
    }

    function fetchAshbyJobPostingFallbackHtml(lookupRequest) {
      var timeoutId;

      return new Promise(function (resolve, reject) {
        var settled = false;

        function finish(callback) {
          return function (value) {
            if (settled) {
              return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            callback(value);
          };
        }

        var resolveOnce = finish(resolve);
        var rejectOnce = finish(reject);

        timeoutId = window.setTimeout(function () {
          rejectOnce(new Error("Timed out after " + HTML_FETCH_TIMEOUT_MS + "ms."));
        }, HTML_FETCH_TIMEOUT_MS);

        if (
          typeof chrome === "undefined" ||
          !chrome.runtime ||
          typeof chrome.runtime.sendMessage !== "function"
        ) {
          rejectOnce(new Error("Background Ashby job fetch is not available."));
          return;
        }

        try {
          chrome.runtime.sendMessage(
            {
              type: FETCH_ASHBY_JOB_POSTING_MESSAGE,
              jobUrl: lookupRequest.jobUrl
            },
            function (response) {
              var lastError = chrome.runtime && chrome.runtime.lastError;

              if (lastError) {
                rejectOnce(new Error(lastError.message || "Background Ashby job fetch failed."));
                return;
              }

              if (!response || !response.ok) {
                rejectOnce(
                  new Error(
                    response && response.message
                      ? response.message
                      : "Background Ashby job fetch failed."
                  )
                );
                return;
              }

              resolveOnce(response.htmlText || "");
            }
          );
        } catch (error) {
          rejectOnce(error);
        }
      });
    }

    function fetchGreenhouseJobPosting(lookupRequest) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var options = {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: JSON_ACCEPT_HEADER
        }
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
          .fetch(lookupRequest.apiUrl, options)
          .then(function (response) {
            if (!response.ok) {
              throw new Error("HTTP " + response.status);
            }
            return response.json();
          })
          .then(
            function (json) {
              window.clearTimeout(timeoutId);
              resolve(json || {});
            },
            function (error) {
              window.clearTimeout(timeoutId);
              reject(error);
            }
          );
      });
    }

    function fetchHtmlFallback(url, pageUrl) {
      if (isCrossOriginUrl(url, pageUrl) && getCanonicalLeverPostingUrl(url) === url) {
        return fetchCrossOriginFallbackHtml(url);
      }

      return fetchCurrentPageHtml(url);
    }

    async function scanPage(options) {
      var scanOptions = options || { trigger: "manual" };
      var scanId = Number.isInteger(scanOptions.generation)
        ? scanOptions.generation
        : activeScanId + 1;
      var pageContext;
      var domSnapshot;
      var domJsonLdUnchanged = false;
      var htmlSnapshot;
      var notice;
      var pageUrl = window.location.href;
      var pageRouteKey = getRouteKey(pageUrl);
      var fallbackUrl;
      var linkedFallbackUrl;
      var ycLookupRequest;
      var ycLookupDebug;
      var ashbyLookupRequest;
      var ashbyLookupDebug;
      var greenhouseLookupDebug;
      var greenhouseLookupRequest;
      var greenhouseJson;
      var htmlText;
      var technicalNotice = null;
      var debug = createScanDebug(pageUrl);

      if (Number.isInteger(scanOptions.generation) && scanId !== activeScanId) {
        addDebugAttempt(debug, {
          source: "dom-jsonld",
          status: "superseded",
          reason: "scan-superseded"
        });
        return summarizeScan(null, "dom", "scan-superseded", debug);
      }

      activeScanId = scanId;

      if (
        scanOptions.expectedRouteKey &&
        pageRouteKey !== scanOptions.expectedRouteKey
      ) {
        addDebugAttempt(debug, {
          source: "dom-jsonld",
          status: "superseded",
          reason: "scan-superseded"
        });
        return summarizeScan(null, "dom", "scan-superseded", debug);
      }

      if (!document.body) {
        addDebugAttempt(debug, {
          source: "dom-jsonld",
          status: "skipped",
          reason: "document-not-ready"
        });
        return summarizeScan(null, "", "document-not-ready", debug);
      }

      resetInteractionForNewUrl();
      renderLoadingBadge();

      pageContext = getPageContext(document);
      domSnapshot = scanDocument(document, pageContext);
      domJsonLdUnchanged =
        Array.isArray(scanOptions.previousJsonLdTexts) &&
        jsonLdTextsEqual(domSnapshot.jsonLdTexts, scanOptions.previousJsonLdTexts);
      if (domJsonLdUnchanged) {
        rememberStaleDomFingerprint(pageRouteKey, domSnapshot.jsonLdTexts);
      }
      if (domJsonLdUnchanged && domSnapshot.result.selected) {
        domSnapshot = snapshotWithoutSelected(domSnapshot);
      }
      if (domJsonLdUnchanged) {
        technicalNotice = {
          message: "Structured job data looks stale",
          helper:
            "The current DOM's JobPosting JSON-LD is unchanged from the previous route."
        };
      } else if (
        domSnapshot.result.errors.length ||
        domSnapshot.result.staleCandidates.length
      ) {
        technicalNotice = getNoResultNotice(
          domSnapshot.result,
          domSnapshot.jsonLdTexts,
          domSnapshot.readyState
        );
      }
      addDebugAttempt(debug, {
        source: "dom-jsonld",
        status: domSnapshot.result.selected ? "selected" : "no-match",
        snapshot: domSnapshot,
        reason: domSnapshot.result.selected
          ? ""
          : domJsonLdUnchanged
            ? "unchanged-after-navigation"
            : "no-selected-jobposting"
      });

      if (domSnapshot.result.selected) {
        return finishSelectedScan(domSnapshot, "dom", debug, pageUrl);
      }

      if (
        !shouldFetchHtmlFallback(
          domSnapshot.result,
          domSnapshot.jsonLdTexts,
          domSnapshot.readyState
        )
      ) {
        addDebugAttempt(debug, {
          source: "html-fallback",
          status: "skipped",
          reason:
            domSnapshot.readyState && domSnapshot.readyState !== "complete"
              ? "document-not-ready"
              : "fallback-not-needed"
        });
        notice = getNoResultNotice(
          domSnapshot.result,
          domSnapshot.jsonLdTexts,
          domSnapshot.readyState
        );
        if (
          domSnapshot.readyState === "complete" &&
          !technicalNotice
        ) {
          showNoData(scanOptions);
        } else {
          showScanFailure(notice, scanOptions);
        }
        return summarizeScan(domSnapshot, "dom", "", debug);
      }

      greenhouseLookupDebug = getGreenhouseLookupDebugInfo(document, pageUrl);
      greenhouseLookupRequest = greenhouseLookupDebug.request;
      if (greenhouseLookupRequest) {
        try {
          greenhouseJson = await fetchGreenhouseJobPosting(greenhouseLookupRequest);
          if (scanId !== activeScanId) {
            addDebugAttempt(debug, {
              source: "greenhouse-api",
              status: "superseded",
              reason: "scan-superseded",
              lookup: greenhouseLookupDebug.lookup
            });
            return summarizeScan(null, "greenhouse-api", "scan-superseded", debug);
          }
          if (getRouteKey(window.location.href) !== pageRouteKey) {
            removeBadge();
            addDebugAttempt(debug, {
              source: "greenhouse-api",
              status: "superseded",
              reason: "scan-superseded",
              lookup: greenhouseLookupDebug.lookup
            });
            return summarizeScan(null, "greenhouse-api", "scan-superseded", debug);
          }

          htmlSnapshot = createSnapshot(
            scanGreenhouseJobPosting(greenhouseJson, greenhouseLookupRequest, pageContext)
          );
          if (htmlSnapshot.result.selected) {
            addDebugAttempt(debug, {
              source: "greenhouse-api",
              status: "selected",
              snapshot: htmlSnapshot,
              lookup: greenhouseLookupDebug.lookup
            });
            return finishSelectedScan(htmlSnapshot, "greenhouse-api", debug, pageUrl);
          }

          addDebugAttempt(debug, {
            source: "greenhouse-api",
            status: "no-match",
            reason: "greenhouse-no-match",
            snapshot: htmlSnapshot,
            lookup: greenhouseLookupDebug.lookup
          });
          notice = getGreenhouseNoResultNotice();
          showScanFailure(notice, scanOptions);
          return summarizeScan(htmlSnapshot, "greenhouse-api", "greenhouse-no-match", debug);
        } catch (error) {
          if (scanId !== activeScanId) {
            addDebugAttempt(debug, {
              source: "greenhouse-api",
              status: "superseded",
              reason: "scan-superseded",
              lookup: greenhouseLookupDebug.lookup
            });
            return summarizeScan(null, "greenhouse-api", "scan-superseded", debug);
          }
          if (getRouteKey(window.location.href) !== pageRouteKey) {
            removeBadge();
            addDebugAttempt(debug, {
              source: "greenhouse-api",
              status: "superseded",
              reason: "scan-superseded",
              lookup: greenhouseLookupDebug.lookup
            });
            return summarizeScan(null, "greenhouse-api", "scan-superseded", debug);
          }

          addDebugAttempt(debug, {
            source: "greenhouse-api",
            status: "failed",
            reason: "fetch-failed",
            lookup: greenhouseLookupDebug.lookup,
            error: error
          });
          technicalNotice = getProviderFetchFailureNotice("Greenhouse", error);
        }
      } else {
        addDebugAttempt(debug, {
          source: "greenhouse-api",
          status: "skipped",
          reason: greenhouseLookupDebug.skipReason || "no-lookup-request",
          lookup: greenhouseLookupDebug.lookup
        });
      }

      ashbyLookupDebug = getAshbyLookupDebugInfo(document, pageUrl);
      ashbyLookupRequest = ashbyLookupDebug.request;
      if (ashbyLookupRequest) {
        try {
          htmlText = await fetchAshbyJobPostingFallbackHtml(ashbyLookupRequest);
          if (scanId !== activeScanId) {
            addDebugAttempt(debug, {
              source: "ashby-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ashbyLookupDebug.lookup
            });
            return summarizeScan(null, "ashby-jsonld", "scan-superseded", debug);
          }
          if (getRouteKey(window.location.href) !== pageRouteKey) {
            removeBadge();
            addDebugAttempt(debug, {
              source: "ashby-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ashbyLookupDebug.lookup
            });
            return summarizeScan(null, "ashby-jsonld", "scan-superseded", debug);
          }

          htmlSnapshot = scanHtmlText(htmlText, null);
          if (htmlSnapshot.result.selected) {
            addDebugAttempt(debug, {
              source: "ashby-jsonld",
              status: "selected",
              snapshot: htmlSnapshot,
              lookup: ashbyLookupDebug.lookup
            });
            return finishSelectedScan(htmlSnapshot, "ashby-jsonld", debug, pageUrl);
          }

          addDebugAttempt(debug, {
            source: "ashby-jsonld",
            status: "no-match",
            reason: "ashby-jsonld-no-match",
            snapshot: htmlSnapshot,
            lookup: ashbyLookupDebug.lookup
          });
          technicalNotice = getHtmlFallbackNoResultNotice();
        } catch (error) {
          if (scanId !== activeScanId) {
            addDebugAttempt(debug, {
              source: "ashby-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ashbyLookupDebug.lookup
            });
            return summarizeScan(null, "ashby-jsonld", "scan-superseded", debug);
          }
          if (getRouteKey(window.location.href) !== pageRouteKey) {
            removeBadge();
            addDebugAttempt(debug, {
              source: "ashby-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ashbyLookupDebug.lookup
            });
            return summarizeScan(null, "ashby-jsonld", "scan-superseded", debug);
          }

          addDebugAttempt(debug, {
            source: "ashby-jsonld",
            status: "failed",
            reason: "fetch-failed",
            lookup: ashbyLookupDebug.lookup,
            error: error
          });
          technicalNotice = getProviderFetchFailureNotice("Ashby", error);
        }
      } else {
        addDebugAttempt(debug, {
          source: "ashby-jsonld",
          status: "skipped",
          reason: ashbyLookupDebug.skipReason || "no-lookup-request",
          lookup: ashbyLookupDebug.lookup
        });
      }

      ycLookupRequest = getWorkAtStartupYcLookupRequest(document, pageUrl);
      ycLookupDebug = ycLookupRequest
        ? {
            jobId: ycLookupRequest.jobId,
            companySlug: ycLookupRequest.companySlug
          }
        : null;
      if (ycLookupRequest) {
        try {
          htmlText = await fetchYcJobPostingFallbackHtml(ycLookupRequest);
          if (scanId !== activeScanId) {
            addDebugAttempt(debug, {
              source: "yc-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ycLookupDebug
            });
            return summarizeScan(null, "yc-jsonld", "scan-superseded", debug);
          }
          if (getRouteKey(window.location.href) !== pageRouteKey) {
            removeBadge();
            addDebugAttempt(debug, {
              source: "yc-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ycLookupDebug
            });
            return summarizeScan(null, "yc-jsonld", "scan-superseded", debug);
          }

          htmlSnapshot = scanHtmlText(htmlText, pageContext);
          if (htmlSnapshot.result.selected && htmlSnapshot.result.selected.datePostedRaw) {
            addDebugAttempt(debug, {
              source: "yc-jsonld",
              status: "selected",
              snapshot: htmlSnapshot,
              lookup: ycLookupDebug
            });
            return finishSelectedScan(htmlSnapshot, "yc-jsonld", debug, pageUrl);
          }

          htmlSnapshot = snapshotWithoutSelected(htmlSnapshot);
          addDebugAttempt(debug, {
            source: "yc-jsonld",
            status: "no-match",
            reason: "yc-jsonld-no-match",
            snapshot: htmlSnapshot,
            lookup: ycLookupDebug
          });
          notice = getHtmlFallbackNoResultNotice();
          showScanFailure(notice, scanOptions);
          return summarizeScan(htmlSnapshot, "yc-jsonld", "yc-jsonld-no-match", debug);
        } catch (error) {
          if (scanId !== activeScanId) {
            addDebugAttempt(debug, {
              source: "yc-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ycLookupDebug
            });
            return summarizeScan(null, "yc-jsonld", "scan-superseded", debug);
          }
          if (getRouteKey(window.location.href) !== pageRouteKey) {
            removeBadge();
            addDebugAttempt(debug, {
              source: "yc-jsonld",
              status: "superseded",
              reason: "scan-superseded",
              lookup: ycLookupDebug
            });
            return summarizeScan(null, "yc-jsonld", "scan-superseded", debug);
          }

          addDebugAttempt(debug, {
            source: "yc-jsonld",
            status: "failed",
            reason: "fetch-failed",
            lookup: ycLookupDebug,
            error: error
          });
          notice = getProviderFetchFailureNotice("YC", error);
          showScanFailure(notice, scanOptions);
          return summarizeScan(domSnapshot, "yc-jsonld", "yc-jsonld-no-match", debug);
        }
      } else {
        addDebugAttempt(debug, {
          source: "yc-jsonld",
          status: "skipped",
          reason: "no-lookup-request"
        });
      }

      fallbackUrl = getHtmlFallbackUrl(pageUrl);
      linkedFallbackUrl = getLinkedLeverFallbackUrl(document);
      if (fallbackUrl === pageUrl && linkedFallbackUrl) {
        fallbackUrl = linkedFallbackUrl;
      }
      try {
        htmlText = await fetchHtmlFallback(fallbackUrl, pageUrl);
        if (scanId !== activeScanId) {
          addDebugAttempt(debug, {
            source: "html-fallback",
            status: "superseded",
            reason: "scan-superseded",
            lookup: { url: fallbackUrl }
          });
          return summarizeScan(null, "html", "scan-superseded", debug);
        }
        if (getRouteKey(window.location.href) !== pageRouteKey) {
          removeBadge();
          addDebugAttempt(debug, {
            source: "html-fallback",
            status: "superseded",
            reason: "scan-superseded",
            lookup: { url: fallbackUrl }
          });
          return summarizeScan(null, "html", "scan-superseded", debug);
        }

        htmlSnapshot = scanHtmlText(htmlText, pageContext);
        if (htmlSnapshot.result.selected) {
          addDebugAttempt(debug, {
            source: "html-fallback",
            status: "selected",
            snapshot: htmlSnapshot,
            lookup: { url: fallbackUrl }
          });
          return finishSelectedScan(htmlSnapshot, "html", debug, pageUrl);
        }

        addDebugAttempt(debug, {
          source: "html-fallback",
          status: "no-match",
          reason: "html-no-match",
          snapshot: htmlSnapshot,
          lookup: { url: fallbackUrl }
        });
        if (
          !technicalNotice &&
          (htmlSnapshot.result.errors.length ||
            htmlSnapshot.result.staleCandidates.length)
        ) {
          technicalNotice = getNoResultNotice(
            htmlSnapshot.result,
            htmlSnapshot.jsonLdTexts,
            htmlSnapshot.readyState
          );
        }
        if (technicalNotice) {
          showScanFailure(technicalNotice, scanOptions);
        } else {
          showNoData(scanOptions);
        }
        return summarizeScan(htmlSnapshot, "html", "html-no-match", debug);
      } catch (error) {
        if (scanId !== activeScanId) {
          addDebugAttempt(debug, {
            source: "html-fallback",
            status: "superseded",
            reason: "scan-superseded",
            lookup: { url: fallbackUrl }
          });
          return summarizeScan(null, "html", "scan-superseded", debug);
        }
        if (getRouteKey(window.location.href) !== pageRouteKey) {
          removeBadge();
          addDebugAttempt(debug, {
            source: "html-fallback",
            status: "superseded",
            reason: "scan-superseded",
            lookup: { url: fallbackUrl }
          });
          return summarizeScan(null, "html", "scan-superseded", debug);
        }

        addDebugAttempt(debug, {
          source: "html-fallback",
          status: "failed",
          reason: "fetch-failed",
          lookup: { url: fallbackUrl },
          error: error
        });
        notice = getHtmlFetchFailureNotice(error);
        showScanFailure(notice, scanOptions);
        return summarizeScan(domSnapshot, "dom", "html-fetch-failed", debug);
      }
    }

    function scanOnce() {
      var routeKey;
      var request;

      startNavigationSession();

      if (pendingNavigation && !pendingNavigation.completion.settled) {
        return pendingNavigation.completion.promise;
      }

      routeKey = getRouteKey(window.location.href);
      if (
        activeRouteScan &&
        !activeRouteScan.completion.settled &&
        activeRouteScan.routeKey === routeKey
      ) {
        return activeRouteScan.completion.promise;
      }

      activeScanId += 1;
      supersedePendingNavigation();
      supersedeActiveRouteScan();
      collapsed = false;
      request = {
        trigger: "manual",
        generation: activeScanId,
        expectedRouteKey: routeKey,
        previousJsonLdTexts: getManualJsonLdGuard(routeKey)
      };

      return startTrackedScan(request, createScanCompletion());
    }

    window.JobDateLens = Object.assign({}, api, {
      scanOnce: scanOnce,
      getLastScanDebug: function () {
        return lastScanDebug;
      }
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
    createDateSource: createDateSource,
    normalizeDateSources: normalizeDateSources,
    collectSchemaDateSourcesFromNode: collectSchemaDateSourcesFromNode,
    collectGreenhouseDateSources: collectGreenhouseDateSources,
    createGreenhouseCandidate: createGreenhouseCandidate,
    scanGreenhouseJobPosting: scanGreenhouseJobPosting,
    getGreenhouseApiUrl: getGreenhouseApiUrl,
    getGreenhouseBoardTokenFromDocument: getGreenhouseBoardTokenFromDocument,
    getGreenhouseLookupFromUrl: getGreenhouseLookupFromUrl,
    getGreenhouseLookupFromDocument: getGreenhouseLookupFromDocument,
    getGreenhouseLookupRequest: getGreenhouseLookupRequest,
    getAshbyBoardUrlFromDocument: getAshbyBoardUrlFromDocument,
    getAshbyJobPostingUrl: getAshbyJobPostingUrl,
    getAshbyLookupRequest: getAshbyLookupRequest,
    getCanonicalLeverPostingUrl: getCanonicalLeverPostingUrl,
    getHtmlFallbackUrl: getHtmlFallbackUrl,
    getLinkedLeverFallbackUrl: getLinkedLeverFallbackUrl,
    getWorkAtStartupJobIdFromUrl: getWorkAtStartupJobIdFromUrl,
    getWorkAtStartupYcLookupRequest: getWorkAtStartupYcLookupRequest,
    parseWorkAtStartupDataPage: parseWorkAtStartupDataPage,
    formatJobPosting: formatJobPosting,
    isJsonLdType: isJsonLdType,
    HTML_ACCEPT_HEADER: HTML_ACCEPT_HEADER,
    JSON_ACCEPT_HEADER: JSON_ACCEPT_HEADER,
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
