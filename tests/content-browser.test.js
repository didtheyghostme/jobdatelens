const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { browserFixtures } = require("./provider-fixtures");
const PRIMARY_HEADING_SELECTOR = 'h1, [role="heading"][aria-level="1"]';

function createFakeElement(document, tagName) {
  const childNodes = [];
  const eventListeners = new Map();
  let elementId = "";

  const element = {
    tagName: tagName.toUpperCase(),
    className: "",
    textContent: "",
    title: "",
    type: "",
    attributes: {},
    parentNode: null,
    appendChild(child) {
      child.parentNode = this;
      childNodes.push(child);
      return child;
    },
    replaceChildren(...children) {
      childNodes.forEach((child) => {
        child.parentNode = null;
      });
      childNodes.length = 0;
      children.forEach((child) => this.appendChild(child));
    },
    remove() {
      if (this.parentNode) {
        const index = this.parentNode.childNodes.indexOf(this);
        if (index !== -1) {
          this.parentNode.childNodes.splice(index, 1);
        }
        this.parentNode = null;
      }
      if (elementId) {
        delete document.elementsById[elementId];
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "id") {
        this.id = value;
      }
    },
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, new Set());
      }
      eventListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (eventListeners.has(type)) {
        eventListeners.get(type).delete(listener);
      }
    },
    dispatchEvent(event) {
      const normalizedEvent = event || {};

      normalizedEvent.type = normalizedEvent.type || "";
      normalizedEvent.target = normalizedEvent.target || this;
      (eventListeners.get(normalizedEvent.type) || []).forEach((listener) => {
        listener.call(this, normalizedEvent);
      });
      return true;
    },
    click() {
      this.dispatchEvent({ type: "click" });
    },
    get childNodes() {
      return childNodes;
    }
  };

  Object.defineProperty(element, "id", {
    get() {
      return elementId;
    },
    set(value) {
      if (elementId) {
        delete document.elementsById[elementId];
      }
      elementId = String(value || "");
      if (elementId) {
        document.elementsById[elementId] = element;
      }
    }
  });

  return element;
}

function getElementText(element) {
  if (!element) {
    return "";
  }

  return [element.textContent]
    .concat(element.childNodes.map((child) => getElementText(child)))
    .filter(Boolean)
    .join(" ");
}

function findElement(element, predicate) {
  if (!element) {
    return null;
  }
  if (predicate(element)) {
    return element;
  }

  for (const child of element.childNodes) {
    const match = findElement(child, predicate);

    if (match) {
      return match;
    }
  }

  return null;
}

function findButtonByText(element, text) {
  return findElement(
    element,
    (candidate) => candidate.tagName === "BUTTON" && candidate.textContent === text
  );
}

function findButtonByTitle(element, title) {
  return findElement(
    element,
    (candidate) => candidate.tagName === "BUTTON" && candidate.title === title
  );
}

function createFakeNavigation(initialUrl) {
  const listeners = new Map();

  return {
    currentEntry: {
      url: initialUrl
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) {
        listeners.get(type).delete(listener);
      }
    },
    dispatch(type, event = {}) {
      (listeners.get(type) || []).forEach((listener) => listener(event));
    },
    listenerCount(type) {
      return (listeners.get(type) || new Set()).size;
    }
  };
}

function createAnimationFrameHarness() {
  const callbacks = new Map();
  let nextId = 1;

  return {
    requestAnimationFrame(callback) {
      const id = nextId;

      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      callbacks.delete(id);
    },
    runNext() {
      const next = callbacks.entries().next();

      if (next.done) {
        return false;
      }
      callbacks.delete(next.value[0]);
      next.value[1](0);
      return true;
    },
    pendingCount() {
      return callbacks.size;
    }
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createJobPostingJsonLd(
  title,
  datePosted,
  company = "Meticulous",
  overrides = {}
) {
  return JSON.stringify(
    Object.assign(
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title,
        datePosted,
        hiringOrganization: {
          "@type": "Organization",
          name: company
        }
      },
      overrides
    )
  );
}

function createFakePrimaryHeading(text, options = {}) {
  const attributes = Object.assign({}, options.attributes);
  const tagName = (options.tagName || "h1").toUpperCase();

  if (tagName !== "H1") {
    attributes.role = attributes.role || "heading";
    attributes["aria-level"] = attributes["aria-level"] || "1";
  }

  return {
    tagName,
    textContent: text,
    hidden: Boolean(options.hidden),
    attributes,
    computedStyle: Object.assign(
      { display: "block", visibility: "visible" },
      options.computedStyle
    ),
    parentElement: options.parentElement || null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null;
    }
  };
}

function setFakeJobPage(document, title, options = {}) {
  document.currentHeading = title;
  document.primaryHeadings =
    options.primaryHeadings || [createFakePrimaryHeading(title)];
  document.title = `${title} | ${options.company || "Meticulous"}`;
  document.body.innerText = `${title} ${options.company || "Meticulous"}`;
  document.body.textContent = document.body.innerText;
  if (options.jsonLdText !== undefined) {
    document.scripts = options.jsonLdText
      ? [
          {
            type: "application/ld+json",
            textContent: options.jsonLdText
          }
        ]
      : [];
  }
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return (
        document.primaryHeadings.find((heading) => heading.tagName === "H1") ||
        null
      );
    }
    return null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === PRIMARY_HEADING_SELECTOR) {
      return document.primaryHeadings;
    }
    if (selector === "a[href]") {
      return document.links;
    }
    return [];
  };
}

function createMappedDomParser(documentsByHtml) {
  return class {
    parseFromString(htmlText, type) {
      const config = documentsByHtml[htmlText];

      assert.equal(type, "text/html");
      assert.ok(config, `Unexpected HTML fixture: ${htmlText}`);
      return createJsonLdDocument(config.jsonLdText || "", {
        title: config.title || "",
        heading: config.title || "",
        visibleText: `${config.title || ""} ${config.company || "Meticulous"}`
      });
    }
  };
}

function createFakeDocument() {
  const document = {
    elementsById: {},
    links: [],
    readyState: "complete",
    title: "Careers | Example",
    scripts: [],
    body: null,
    createElement(tagName) {
      return createFakeElement(document, tagName);
    },
    getElementById(id) {
      return this.elementsById[id] || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "a[href]") {
        return this.links;
      }
      return [];
    }
  };

  document.body = createFakeElement(document, "body");
  document.body.innerText = "";
  document.body.textContent = "";

  return document;
}

function createJsonLdDocument(jsonLdText, options = {}) {
  const document = createFakeDocument();
  const jsonLdTexts = Array.isArray(jsonLdText)
    ? jsonLdText
    : jsonLdText
      ? [jsonLdText]
      : [];

  document.title = options.title || "";
  document.body.innerText = options.visibleText || "";
  document.body.textContent = document.body.innerText;
  document.scripts = jsonLdTexts.map((text) => ({
    type: "application/ld+json",
    textContent: text
  }));
  document.querySelector = (selector) => {
    if (selector === "h1" && options.heading) {
      return createFakePrimaryHeading(options.heading);
    }
    return null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === PRIMARY_HEADING_SELECTOR && options.heading) {
      return [createFakePrimaryHeading(options.heading)];
    }
    return [];
  };

  return document;
}

function createDocumentFromFixture(fixture) {
  const document = createFakeDocument();
  const page = fixture.page || {};
  const jsonLdScripts = (page.jsonLdTexts || []).map((text) => ({
    type: "application/ld+json",
    textContent: text
  }));
  const extraScripts = page.scripts || [];
  const iframes = page.iframes || [];

  document.title = page.title || "";
  document.body.innerText = page.visibleText || "";
  document.body.textContent = document.body.innerText;
  document.scripts = jsonLdScripts.concat(extraScripts);
  document.links = page.links || [];
  document.querySelector = (selector) => {
    if (selector === "h1" && page.heading) {
      return { textContent: page.heading };
    }
    if (selector === "[data-page]" && page.dataPage) {
      return {
        getAttribute(name) {
          assert.equal(name, "data-page");
          return JSON.stringify(page.dataPage);
        }
      };
    }
    return null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === PRIMARY_HEADING_SELECTOR && page.heading) {
      return [createFakePrimaryHeading(page.heading)];
    }
    if (selector === "a[href]") {
      return document.links;
    }
    if (selector === "script[src], link[href], a[href]") {
      return extraScripts.concat(page.links || [], page.assets || []);
    }
    if (selector === "iframe[src], script[src], link[href], a[href]") {
      return iframes.concat(extraScripts, page.links || [], page.assets || []);
    }
    return [];
  };

  return document;
}

function getFixtureParser(fixture) {
  const fetchConfig = fixture.fetch || fixture.background || {};
  const htmlText = fetchConfig.htmlText || "";
  const parsedJsonLdTexts = fetchConfig.parsedJsonLdTexts || [];
  const parsedPage = fetchConfig.parsedPage || {};

  return class {
    parseFromString(actualHtmlText, type) {
      assert.equal(actualHtmlText, htmlText, fixture.name);
      assert.equal(type, "text/html", fixture.name);
      return createJsonLdDocument(parsedJsonLdTexts, parsedPage);
    }
  };
}

function createFixtureChrome(fixture, capture) {
  if (!fixture.background) {
    return undefined;
  }

  return {
    runtime: {
      lastError: null,
      sendMessage(request, callback) {
        capture.backgroundRequest = request;
        assert.equal(request.type, fixture.background.expectedType, fixture.name);
        if (fixture.background.expectedJobUrl) {
          assert.equal(request.jobUrl, fixture.background.expectedJobUrl, fixture.name);
        }
        callback({
          ok: true,
          htmlText: fixture.background.htmlText,
          url:
            fixture.background.responseUrl ||
            fixture.background.expectedJobUrl,
          finalUrl:
            fixture.background.finalUrl ||
            fixture.background.responseUrl ||
            fixture.background.expectedJobUrl
        });
      }
    }
  };
}

function createFixtureWindow(fixture, capture) {
  return {
    location: {
      href: fixture.url
    },
    setTimeout,
    clearTimeout,
    fetch(url, options) {
      capture.fetchRequest = { url, options };
      if (!fixture.fetch) {
        return Promise.reject(new Error("Fixture did not expect window.fetch"));
      }
      assert.equal(url, fixture.fetch.expectedUrl, fixture.name);
      if (fixture.fetch.json) {
        return Promise.resolve({
          ok: true,
          json() {
            return Promise.resolve(fixture.fetch.json);
          }
        });
      }
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(fixture.fetch.htmlText || "");
        }
      });
    }
  };
}

function assertFixtureAttempts(debug, expectedAttempts, fixtureName) {
  expectedAttempts.forEach(([source, status, reason]) => {
    const attempt = debug.attempts.find((entry) => entry.source === source);

    assert.ok(attempt, `${fixtureName}: missing ${source} debug attempt`);
    assert.equal(attempt.status, status, `${fixtureName}: ${source} status`);
    if (reason) {
      assert.equal(attempt.reason, reason, `${fixtureName}: ${source} reason`);
    }
  });
}

async function runBrowserFixture(fixture) {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const document = createDocumentFromFixture(fixture);
  const capture = {};
  const fakeWindow = createFixtureWindow(fixture, capture);
  const fakeChrome = createFixtureChrome(fixture, capture);
  const context = vm.createContext({
    chrome: fakeChrome,
    console,
    document,
    DOMParser: getFixtureParser(fixture),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  return {
    capture,
    document,
    result: await fakeWindow.JobDateLens.scanOnce(),
    window: fakeWindow
  };
}

test("provider browser fixtures expose expected diagnostics", async () => {
  for (const fixture of browserFixtures) {
    const { result, window } = await runBrowserFixture(fixture);

    assert.equal(result.found, fixture.expected.found, fixture.name);
    assert.equal(result.source, fixture.expected.source, fixture.name);
    if (fixture.expected.reason) {
      assert.equal(result.reason, fixture.expected.reason, fixture.name);
    }
    assert.ok(result.debug, `${fixture.name}: missing debug payload`);
    assert.equal(result.debug.pageUrl, fixture.url, fixture.name);
    assert.equal(result.debug.selectedSource, fixture.expected.selectedSource, fixture.name);
    assert.deepEqual(
      Array.from(result.debug.dateRows, (row) => [row.key, row.state]),
      fixture.expected.dateRows,
      fixture.name
    );
    assertFixtureAttempts(result.debug, fixture.expected.attempts, fixture.name);
    assert.equal(window.JobDateLens.getLastScanDebug(), result.debug, fixture.name);
  }
});

test("manual scans keep the panel visible and busy until the result is ready", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://example.com/jobs/platform-engineer";
  const html = "platform-engineer-html";
  const title = "Platform Engineer";
  const document = createFakeDocument();
  let resolveFetch;

  setFakeJobPage(document, title, { jsonLdText: "" });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch() {
      return new Promise((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            text() {
              return Promise.resolve(html);
            }
          });
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [html]: {
        title,
        jsonLdText: createJobPostingJsonLd(title, "2026-07-01")
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const scanPromise = fakeWindow.JobDateLens.scanOnce();
  let badge = document.getElementById("jobdatelens-badge");

  assert.equal(badge.attributes["aria-busy"], "true");
  assert.match(getElementText(badge), /Loading…/);
  assert.match(getElementText(badge), /Loading job dates…/);
  assert.match(getElementText(badge), /Checking this posting’s public date data\./);
  assert.ok(findButtonByTitle(badge, "Close JobDateLens"));
  assert.equal(findButtonByTitle(badge, "Collapse JobDateLens"), null);
  assert.ok(findElement(badge, (element) => element.className === "jdl-spinner"));

  resolveFetch();
  const result = await scanPromise;
  badge = document.getElementById("jobdatelens-badge");

  assert.equal(result.found, true);
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), new RegExp(title));
  assert.ok(findButtonByTitle(badge, "Collapse JobDateLens"));
});

test("a clean no-data scan stays active in the neutral Watching state", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://careers.example.com/openings";
  const emptyHtml = "careers-listing-html";
  const document = createFakeDocument();
  const sentMessages = [];
  let fetchCalls = 0;

  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch() {
      fetchCalls += 1;
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(emptyHtml);
        }
      });
    }
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage(request, callback) {
        sentMessages.push(request);
        if (callback) {
          callback({ ok: true });
        }
      }
    }
  };
  const context = vm.createContext({
    chrome: fakeChrome,
    console,
    document,
    DOMParser: createMappedDomParser({
      [emptyHtml]: { title: "Careers", jsonLdText: "" }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();
  let badge = document.getElementById("jobdatelens-badge");

  assert.equal(result.found, false);
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), /Watching/);
  assert.match(getElementText(badge), /No public job date data found/);
  assert.match(
    getElementText(badge),
    /JobDateLens is still active on this site\. Open another job or check again\./
  );
  assert.equal(findElement(badge, (element) => element.className === "jdl-spinner"), null);
  assert.equal(findButtonByTitle(badge, "Collapse JobDateLens"), null);
  const checkAgainButton = findButtonByText(badge, "Check again");
  assert.ok(checkAgainButton);
  assert.ok(findButtonByTitle(badge, "Close JobDateLens"));

  checkAgainButton.click();
  checkAgainButton.click();
  await flushAsyncWork();
  assert.equal(fetchCalls, 2);
  badge = document.getElementById("jobdatelens-badge");
  assert.match(getElementText(badge), /Watching/);

  findButtonByTitle(badge, "Close JobDateLens").click();
  assert.equal(document.getElementById("jobdatelens-badge"), null);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, "jobdatelens:stopSession");
});

test("a no-data listings page follows a later same-document job navigation", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const listingsUrl = "https://careers.example.com/openings";
  const jobUrl = "https://careers.example.com/openings/platform-engineer";
  const emptyHtml = "empty-listings-html";
  const title = "Platform Engineer";
  const document = createFakeDocument();
  const navigation = createFakeNavigation(listingsUrl);
  const frames = createAnimationFrameHarness();
  let fetchCalls = 0;

  const fakeWindow = {
    location: { href: listingsUrl },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch() {
      fetchCalls += 1;
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(emptyHtml);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [emptyHtml]: { title: "Careers", jsonLdText: "" }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  assert.equal(navigation.listenerCount("navigate"), 1);
  navigation.dispatch("navigate", {
    destination: { url: jobUrl, sameDocument: true },
    hashChange: false
  });
  let badge = document.getElementById("jobdatelens-badge");
  assert.match(getElementText(badge), /Loading job dates…/);

  fakeWindow.location.href = jobUrl;
  navigation.currentEntry.url = jobUrl;
  setFakeJobPage(document, title, {
    jsonLdText: createJobPostingJsonLd(title, "2026-07-20", "Meticulous", {
      url: jobUrl
    })
  });
  navigation.dispatch("navigatesuccess");
  assert.equal(frames.pendingCount(), 1);
  frames.runNext();
  await flushAsyncWork();

  badge = document.getElementById("jobdatelens-badge");
  const navigationDebug = fakeWindow.JobDateLens.getLastScanDebug();
  const fastDomAttempt = navigationDebug.attempts.find(
    (attempt) => attempt.source === "dom-jsonld"
  );

  assert.match(getElementText(badge), new RegExp(title));
  assert.equal(fetchCalls, 1);
  assert.equal(fastDomAttempt.status, "selected");
  assert.equal(fastDomAttempt.phase, "navigation-fast-path");
  assert.equal(fastDomAttempt.reason, "route-identity-matched");
  assert.equal(fastDomAttempt.routeAttestation.proof, "schema-url");
  assert.equal(
    navigationDebug.attempts.find((attempt) => attempt.source === "html-fallback"),
    undefined
  );
});

test("a technical failure keeps watching for the next same-document job", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const failedUrl = "https://careers.example.com/unavailable";
  const jobUrl = "https://careers.example.com/jobs/recovered";
  const title = "Recovered Engineer";
  const document = createFakeDocument();
  const navigation = createFakeNavigation(failedUrl);
  const frames = createAnimationFrameHarness();
  let fetchCalls = 0;

  const fakeWindow = {
    location: { href: failedUrl },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch() {
      fetchCalls += 1;
      return Promise.reject(new Error("network unavailable"));
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({}),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  let badge = document.getElementById("jobdatelens-badge");
  assert.match(getElementText(badge), /Couldn’t load job dates/);
  assert.equal(navigation.listenerCount("navigate"), 1);

  navigation.dispatch("navigate", {
    destination: { url: jobUrl, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = jobUrl;
  navigation.currentEntry.url = jobUrl;
  setFakeJobPage(document, title, {
    jsonLdText: createJobPostingJsonLd(title, "2026-07-21", "Meticulous", {
      url: jobUrl
    })
  });
  navigation.dispatch("navigatesuccess");
  frames.runNext();
  await flushAsyncWork();

  badge = document.getElementById("jobdatelens-badge");
  assert.match(getElementText(badge), new RegExp(title));
  assert.equal(fetchCalls, 1);
});

test("automatic SPA navigation fetches when live DOM attestation fails", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const cases = [
    {
      name: "missing-route-identity",
      reason: "route-identity-missing",
      liveJsonLd(routeUrl, title) {
        return createJobPostingJsonLd(title, "2026-01-01");
      }
    },
    {
      name: "title-mismatch",
      reason: "title-mismatch",
      liveJsonLd(routeUrl) {
        return createJobPostingJsonLd(
          "Previous Route Engineer",
          "2026-01-01",
          "Meticulous",
          { url: routeUrl }
        );
      }
    },
    {
      name: "multiple-postings",
      reason: "multiple-jobpostings",
      liveJsonLd(routeUrl, title) {
        return JSON.stringify([
          JSON.parse(
            createJobPostingJsonLd(title, "2026-01-01", "Meticulous", {
              url: routeUrl
            })
          ),
          JSON.parse(
            createJobPostingJsonLd("Related Engineer", "2026-01-02", "Meticulous", {
              url: `${routeUrl}/related`
            })
          )
        ]);
      }
    }
  ];

  for (const testCase of cases) {
    const routeA = `https://careers.example.com/${testCase.name}/listing`;
    const routeB = `https://careers.example.com/${testCase.name}/job`;
    const title = "Current Route Engineer";
    const htmlA = `${testCase.name}-initial-html`;
    const htmlB = `${testCase.name}-fresh-html`;
    const document = createFakeDocument();
    const navigation = createFakeNavigation(routeA);
    const frames = createAnimationFrameHarness();
    const requests = [];

    setFakeJobPage(document, "Careers", { jsonLdText: "" });
    const fakeWindow = {
      location: { href: routeA },
      navigation,
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame,
      setTimeout,
      clearTimeout,
      fetch(url) {
        requests.push(url);
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(url === routeA ? htmlA : htmlB);
          }
        });
      }
    };
    const context = vm.createContext({
      console,
      document,
      DOMParser: createMappedDomParser({
        [htmlA]: {
          title: "Initial Engineer",
          jsonLdText: createJobPostingJsonLd("Initial Engineer", "2026-06-01")
        },
        [htmlB]: {
          title,
          jsonLdText: createJobPostingJsonLd(title, "2026-07-23")
        }
      }),
      URL,
      window: fakeWindow
    });

    vm.runInContext(source, context);
    await fakeWindow.JobDateLens.scanOnce();

    navigation.dispatch("navigate", {
      destination: { url: routeB, sameDocument: true },
      hashChange: false
    });
    fakeWindow.location.href = routeB;
    navigation.currentEntry.url = routeB;
    setFakeJobPage(document, title, {
      jsonLdText: testCase.liveJsonLd(routeB, title)
    });
    navigation.dispatch("navigatesuccess");
    frames.runNext();
    await flushAsyncWork();

    const debug = fakeWindow.JobDateLens.getLastScanDebug();
    const domAttempts = debug.attempts.filter(
      (attempt) => attempt.source === "dom-jsonld"
    );

    assert.deepEqual(requests, [routeA, routeB], testCase.name);
    assert.equal(domAttempts.length, 1, testCase.name);
    assert.equal(domAttempts[0].phase, "navigation-fast-path", testCase.name);
    assert.equal(domAttempts[0].reason, testCase.reason, testCase.name);
    assert.equal(
      debug.attempts.find((attempt) => attempt.source === "html-fallback").status,
      "selected",
      testCase.name
    );
  }
});

test("every manual activation uses fresh data instead of same-title live DOM", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://example.com/jobs/software-engineer";
  const title = "Software Engineer";
  const html = "fresh-same-title-job-html";
  const staleJsonLd = createJobPostingJsonLd(title, "2026-01-01", "Meticulous", {
    url: pageUrl
  });
  const freshJsonLd = createJobPostingJsonLd(title, "2026-07-22");
  const document = createFakeDocument();
  const requests = [];

  setFakeJobPage(document, title, { jsonLdText: staleJsonLd });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch(url) {
      requests.push(url);
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(html);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [html]: { title, jsonLdText: freshJsonLd }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const firstResult = await fakeWindow.JobDateLens.scanOnce();
  const repeatedResult = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(firstResult.source, "html");
  assert.equal(repeatedResult.source, "html");
  assert.deepEqual(requests, [pageUrl, pageUrl]);
  assert.equal(
    repeatedResult.debug.attempts.find((attempt) => attempt.source === "dom-jsonld"),
    undefined
  );

  setFakeJobPage(document, title, { jsonLdText: freshJsonLd });
  const updatedDomResult = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(updatedDomResult.source, "html");
  assert.deepEqual(requests, [pageUrl, pageUrl, pageUrl]);
});

test("a page-load scan finishes from attested live DOM without fetching", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://example.com/jobs/platform-engineer";
  const title = "Platform Engineer";
  const html = "page-load-fresh-html";
  const document = createFakeDocument();
  const requests = [];

  setFakeJobPage(document, title, {
    jsonLdText: createJobPostingJsonLd(title, "2026-07-30", "Meticulous", {
      url: pageUrl
    })
  });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch(url) {
      requests.push(url);
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(html);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [html]: {
        title,
        jsonLdText: createJobPostingJsonLd(title, "2026-07-30")
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const pageLoadResult = await fakeWindow.JobDateLens.scanOnce({
    trigger: "page-load"
  });
  const domAttempts = pageLoadResult.debug.attempts.filter(
    (attempt) => attempt.source === "dom-jsonld"
  );

  assert.equal(pageLoadResult.found, true);
  assert.equal(pageLoadResult.source, "dom");
  assert.deepEqual(requests, []);
  assert.equal(domAttempts.length, 1);
  assert.equal(domAttempts[0].phase, "page-load-fast-path");
  assert.equal(domAttempts[0].status, "selected");
  assert.equal(domAttempts[0].reason, "route-identity-matched");
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    new RegExp(title)
  );

  const clickHandlerResult = await fakeWindow.JobDateLens.scanOnce({
    type: "click"
  });

  assert.equal(clickHandlerResult.source, "html");
  assert.deepEqual(requests, [pageUrl]);
});

test("page-load scans without live route proof fall back to fresh data", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const title = "Current Route Engineer";
  const cases = [
    {
      name: "missing-route-identity",
      reason: "route-identity-missing",
      liveJsonLd(routeUrl) {
        return createJobPostingJsonLd(title, "2026-01-01");
      }
    },
    {
      name: "title-mismatch",
      reason: "title-mismatch",
      liveJsonLd(routeUrl) {
        return createJobPostingJsonLd(
          "Previous Route Engineer",
          "2026-01-01",
          "Meticulous",
          { url: routeUrl }
        );
      }
    }
  ];

  for (const testCase of cases) {
    const pageUrl = `https://careers.example.com/${testCase.name}/job`;
    const html = `${testCase.name}-page-load-html`;
    const document = createFakeDocument();
    const requests = [];

    setFakeJobPage(document, title, {
      jsonLdText: testCase.liveJsonLd(pageUrl)
    });
    const fakeWindow = {
      location: { href: pageUrl },
      setTimeout,
      clearTimeout,
      fetch(url) {
        requests.push(url);
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(html);
          }
        });
      }
    };
    const context = vm.createContext({
      console,
      document,
      DOMParser: createMappedDomParser({
        [html]: {
          title,
          jsonLdText: createJobPostingJsonLd(title, "2026-07-30")
        }
      }),
      URL,
      window: fakeWindow
    });

    vm.runInContext(source, context);

    const result = await fakeWindow.JobDateLens.scanOnce({
      trigger: "page-load"
    });
    const domAttempts = result.debug.attempts.filter(
      (attempt) => attempt.source === "dom-jsonld"
    );

    assert.equal(result.found, true, testCase.name);
    assert.equal(result.source, "html", testCase.name);
    assert.deepEqual(requests, [pageUrl], testCase.name);
    assert.equal(domAttempts.length, 1, testCase.name);
    assert.equal(domAttempts[0].phase, "page-load-fast-path", testCase.name);
    assert.equal(domAttempts[0].reason, testCase.reason, testCase.name);
  }
});

test("Greenhouse page-load scans stay API-first", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://job-boards.greenhouse.io/pallet/jobs/5169663007";
  const apiUrl = "https://boards-api.greenhouse.io/v1/boards/pallet/jobs/5169663007";
  const title = "Forward Deployed Product Engineer";
  const document = createFakeDocument();
  const requests = [];

  setFakeJobPage(document, title, {
    jsonLdText: createJobPostingJsonLd(title, "2026-06-01", "Pallet", {
      url: pageUrl
    })
  });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch(url) {
      requests.push(url);
      return Promise.resolve({
        ok: true,
        url,
        json() {
          return Promise.resolve({
            title,
            company_name: "Pallet",
            first_published: "2026-06-19T12:45:42-04:00"
          });
        }
      });
    }
  };
  const context = vm.createContext({ console, document, URL, window: fakeWindow });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce({ trigger: "page-load" });

  assert.equal(result.found, true);
  assert.equal(result.source, "greenhouse-api");
  assert.deepEqual(requests, [apiUrl]);
  assert.equal(
    result.debug.attempts.find((attempt) => attempt.source === "dom-jsonld"),
    undefined
  );
});

test("fresh current-URL data does not require a matching live primary heading", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const title = "Current Route Engineer";
  const staleJsonLd = createJobPostingJsonLd("Previous Route Engineer", "2026-01-01");
  const freshJsonLd = createJobPostingJsonLd(title, "2026-07-22");
  const cases = [
    { name: "missing", headings: [] },
    {
      name: "conflicting",
      headings: [createFakePrimaryHeading("Different Visible Role")]
    }
  ];

  for (const testCase of cases) {
    const pageUrl = `https://example.com/jobs/fresh-${testCase.name}`;
    const html = `fresh-${testCase.name}-html`;
    const document = createFakeDocument();

    setFakeJobPage(document, title, {
      jsonLdText: staleJsonLd,
      primaryHeadings: testCase.headings
    });
    const fakeWindow = {
      location: { href: pageUrl },
      setTimeout,
      clearTimeout,
      fetch() {
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(html);
          }
        });
      }
    };
    const context = vm.createContext({
      console,
      document,
      DOMParser: createMappedDomParser({
        [html]: { title, jsonLdText: freshJsonLd }
      }),
      URL,
      window: fakeWindow
    });

    vm.runInContext(source, context);
    const result = await fakeWindow.JobDateLens.scanOnce();

    assert.equal(result.source, "html", testCase.name);
    assert.equal(result.found, true, testCase.name);
    assert.equal(
      result.debug.attempts.find((attempt) => attempt.source === "dom-jsonld"),
      undefined,
      testCase.name
    );
    assert.match(
      getElementText(document.getElementById("jobdatelens-badge")),
      new RegExp(title),
      testCase.name
    );
  }
});

test("fresh failure re-reads and verifies the latest live primary heading", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://example.com/jobs/late-live-fallback";
  const title = "Late Platform Engineer";
  const document = createFakeDocument();
  let rejectFetch;

  setFakeJobPage(document, "Loading", { jsonLdText: "", primaryHeadings: [] });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    getComputedStyle(element) {
      return element.computedStyle;
    },
    fetch() {
      return new Promise((resolve, reject) => {
        rejectFetch = reject;
      });
    }
  };
  const context = vm.createContext({ console, document, URL, window: fakeWindow });

  vm.runInContext(source, context);
  const scanPromise = fakeWindow.JobDateLens.scanOnce();

  setFakeJobPage(document, title, {
    jsonLdText: createJobPostingJsonLd(title, "2026-07-22", "Meticulous", {
      url: pageUrl
    }),
    primaryHeadings: [
      createFakePrimaryHeading("Hidden Previous Role", { hidden: true }),
      createFakePrimaryHeading(title, { tagName: "div" })
    ]
  });
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    /Loading job dates…/
  );
  assert.ok(
    !getElementText(document.getElementById("jobdatelens-badge")).includes(title)
  );

  rejectFetch(new Error("Network unavailable"));
  const result = await scanPromise;
  const domAttempts = result.debug.attempts.filter(
    (attempt) => attempt.source === "dom-jsonld"
  );

  assert.equal(result.source, "dom");
  assert.equal(result.found, true);
  assert.equal(domAttempts.length, 1);
  assert.equal(domAttempts[0].phase, "post-fetch");
  assert.equal(domAttempts[0].reason, "route-identity-matched");
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    new RegExp(title)
  );
});

test("unverifiable primary headings cannot authorize a live fallback", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const title = "Software Engineer";
  const liveJsonLd = createJobPostingJsonLd(title, "2026-07-22");
  const cases = [
    {
      name: "hidden",
      headings: [createFakePrimaryHeading(title, { hidden: true })],
      reason: "missing-heading",
      notice: /Structured job data could not be verified/
    },
    {
      name: "css-hidden",
      headings: [
        createFakePrimaryHeading(title, {
          computedStyle: { display: "none" }
        })
      ],
      reason: "missing-heading",
      notice: /Structured job data could not be verified/
    },
    {
      name: "generic",
      headings: [createFakePrimaryHeading("Job details")],
      reason: "generic-heading",
      notice: /Structured job data could not be verified/
    },
    {
      name: "missing",
      headings: [],
      reason: "missing-heading",
      notice: /Structured job data could not be verified/
    },
    {
      name: "decorated",
      headings: [createFakePrimaryHeading("Software Engineer — London")],
      reason: "title-mismatch",
      notice: /Structured job data looks stale/
    },
    {
      name: "conflicting",
      headings: [createFakePrimaryHeading("Product Manager")],
      reason: "title-mismatch",
      notice: /Structured job data looks stale/
    }
  ];

  for (const testCase of cases) {
    const pageUrl = `https://example.com/jobs/unverified-${testCase.name}`;
    const html = `empty-${testCase.name}-html`;
    const document = createFakeDocument();

    setFakeJobPage(document, title, {
      jsonLdText: liveJsonLd,
      primaryHeadings: testCase.headings
    });
    const fakeWindow = {
      location: { href: pageUrl },
      setTimeout,
      clearTimeout,
      getComputedStyle(element) {
        return element.computedStyle;
      },
      fetch() {
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(html);
          }
        });
      }
    };
    const context = vm.createContext({
      console,
      document,
      DOMParser: createMappedDomParser({
        [html]: { title, jsonLdText: "" }
      }),
      URL,
      window: fakeWindow
    });

    vm.runInContext(source, context);
    const result = await fakeWindow.JobDateLens.scanOnce();
    const domAttempt = result.debug.attempts.find(
      (attempt) => attempt.source === "dom-jsonld"
    );

    assert.equal(result.found, false, testCase.name);
    assert.equal(domAttempt.reason, testCase.reason, testCase.name);
    assert.match(
      getElementText(document.getElementById("jobdatelens-badge")),
      testCase.notice,
      testCase.name
    );
  }
});

test("fresh failure falls back to verified live DOM and Close makes reopening fresh-first", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl = "https://example.com/jobs/platform-engineer";
  const title = "Platform Engineer";
  const document = createFakeDocument();
  let fetchCalls = 0;

  setFakeJobPage(document, title, {
    jsonLdText: createJobPostingJsonLd(title, "2026-07-22", "Meticulous", {
      url: pageUrl
    })
  });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch() {
      fetchCalls += 1;
      return Promise.reject(new Error("Network unavailable"));
    }
  };
  const context = vm.createContext({ console, document, URL, window: fakeWindow });

  vm.runInContext(source, context);

  const firstResult = await fakeWindow.JobDateLens.scanOnce();
  const sameSessionResult = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(firstResult.source, "dom");
  assert.equal(firstResult.found, true);
  assert.equal(sameSessionResult.source, "dom");
  assert.equal(fetchCalls, 2);

  findButtonByTitle(
    document.getElementById("jobdatelens-badge"),
    "Close JobDateLens"
  ).click();
  const reopenedResult = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(reopenedResult.source, "dom");
  assert.equal(reopenedResult.found, true);
  assert.equal(fetchCalls, 3);
});

test("generic headings and multiple JobPostings remain failures when fresh data cannot resolve them", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const genericUrl = "https://example.com/jobs/generic-heading";
  const multipleUrl = "https://example.com/jobs/ambiguous";
  const emptyHtml = "generic-empty-html";
  const multipleHtml = "multiple-jobposting-html";
  const title = "Software Engineer";
  const firstPosting = createJobPostingJsonLd(title, "2026-07-01");
  const attestedLivePosting = createJobPostingJsonLd(
    title,
    "2026-07-01",
    "Meticulous",
    { url: multipleUrl }
  );
  const secondPosting = createJobPostingJsonLd("Product Engineer", "2026-07-02");
  const multipleJsonLd = JSON.stringify([
    JSON.parse(firstPosting),
    JSON.parse(secondPosting)
  ]);

  async function runFailure(pageUrl, heading, liveJsonLd, html, freshJsonLd) {
    const document = createFakeDocument();

    setFakeJobPage(document, heading, { jsonLdText: liveJsonLd });
    const fakeWindow = {
      location: { href: pageUrl },
      setTimeout,
      clearTimeout,
      fetch() {
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(html);
          }
        });
      }
    };
    const context = vm.createContext({
      console,
      document,
      DOMParser: createMappedDomParser({
        [html]: { title: heading, jsonLdText: freshJsonLd }
      }),
      URL,
      window: fakeWindow
    });

    vm.runInContext(source, context);
    const result = await fakeWindow.JobDateLens.scanOnce();
    return { document, result };
  }

  const generic = await runFailure(
    genericUrl,
    "Job details",
    firstPosting,
    emptyHtml,
    ""
  );
  assert.equal(generic.result.found, false);
  assert.match(
    getElementText(generic.document.getElementById("jobdatelens-badge")),
    /Structured job data could not be verified/
  );

  const multiple = await runFailure(
    multipleUrl,
    title,
    attestedLivePosting,
    multipleHtml,
    multipleJsonLd
  );
  assert.equal(multiple.result.found, false);
  assert.equal(
    multiple.result.debug.attempts.find(
      (attempt) => attempt.source === "dom-jsonld"
    ),
    undefined
  );
  assert.match(
    getElementText(multiple.document.getElementById("jobdatelens-badge")),
    /Multiple job entries found/
  );
});

test("Ashby SPA navigation and later manual scans always refresh the current route", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA =
    "https://jobs.ashbyhq.com/meticulous/e6d1e0ab-8a28-49ee-94ed-d232886cd7d5";
  const routeB =
    "https://jobs.ashbyhq.com/meticulous/9b592dc5-6262-42ff-bbd7-f1b2ae8e7543";
  const titleA = "Forward Deployed Engineer (New Grad)";
  const titleB = "Forward Deployed Engineer, London";
  const htmlA = "ashby-job-a-html";
  const htmlB = "ashby-job-b-html";
  const jsonLdA = createJobPostingJsonLd(titleA, "2026-06-01");
  const jsonLdB = createJobPostingJsonLd(titleB, "2026-07-02");
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();
  const currentPageRequests = [];
  let intervalCalls = 0;

  setFakeJobPage(document, titleA, { jsonLdText: jsonLdA });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval() {
      intervalCalls += 1;
      throw new Error("SPA navigation must not use polling");
    },
    clearInterval,
    fetch(url) {
      currentPageRequests.push(url);
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(url === routeA ? htmlA : htmlB);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [htmlA]: { title: titleA, jsonLdText: jsonLdA },
      [htmlB]: { title: titleB, jsonLdText: jsonLdB }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  const directRepeat = await fakeWindow.JobDateLens.scanOnce();
  assert.equal(directRepeat.source, "html");
  assert.deepEqual(currentPageRequests, [routeA, routeA]);

  let badge = document.getElementById("jobdatelens-badge");
  findButtonByTitle(badge, "Collapse JobDateLens").click();
  assert.match(badge.className, /jdl-badge--collapsed/);
  assert.equal(navigation.listenerCount("navigate"), 1);

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  badge = document.getElementById("jobdatelens-badge");

  assert.equal(badge.attributes["aria-busy"], "true");
  assert.match(getElementText(badge), /Loading job dates…/);
  assert.ok(!getElementText(badge).includes(titleA));
  assert.ok(!badge.className.includes("jdl-badge--collapsed"));
  assert.equal(findButtonByTitle(badge, "Collapse JobDateLens"), null);

  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  setFakeJobPage(document, titleB);
  navigation.dispatch("navigatesuccess");

  assert.equal(frames.pendingCount(), 1);
  assert.equal(currentPageRequests.length, 2);
  assert.equal(frames.runNext(), true);
  await flushAsyncWork();

  badge = document.getElementById("jobdatelens-badge");
  const debug = fakeWindow.JobDateLens.getLastScanDebug();

  assert.deepEqual(currentPageRequests, [routeA, routeA, routeB]);
  const fastDomAttempt = debug.attempts.find(
    (attempt) =>
      attempt.source === "dom-jsonld" &&
      attempt.phase === "navigation-fast-path"
  );
  assert.equal(fastDomAttempt.status, "no-match");
  assert.equal(fastDomAttempt.reason, "unchanged-after-navigation");
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), new RegExp(titleB));
  assert.ok(!getElementText(badge).includes(titleA));
  assert.ok(findButtonByTitle(badge, "Collapse JobDateLens"));
  assert.equal(intervalCalls, 0);

  const firstManualRefresh = fakeWindow.JobDateLens.scanOnce();
  badge = document.getElementById("jobdatelens-badge");

  assert.equal(badge.attributes["aria-busy"], "true");
  assert.ok(!getElementText(badge).includes(titleA));

  const firstManualResult = await firstManualRefresh;
  badge = document.getElementById("jobdatelens-badge");

  assert.equal(firstManualResult.source, "html");
  assert.deepEqual(currentPageRequests, [routeA, routeA, routeB, routeB]);
  assert.match(getElementText(badge), new RegExp(titleB));
  assert.ok(!getElementText(badge).includes(titleA));

  const secondManualResult = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(secondManualResult.source, "html");
  assert.deepEqual(currentPageRequests, [routeA, routeA, routeB, routeB, routeB]);
  assert.match(getElementText(badge), new RegExp(titleB));
  assert.ok(!getElementText(badge).includes(titleA));

  setFakeJobPage(document, titleB, { jsonLdText: jsonLdB });
  const updatedDomResult = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(updatedDomResult.source, "html");
  assert.deepEqual(currentPageRequests, [
    routeA,
    routeA,
    routeB,
    routeB,
    routeB,
    routeB
  ]);
  assert.match(getElementText(badge), new RegExp(titleB));

  const updatedDomRepeat = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(updatedDomRepeat.source, "html");
  assert.deepEqual(currentPageRequests, [
    routeA,
    routeA,
    routeB,
    routeB,
    routeB,
    routeB,
    routeB
  ]);
});

test("a route stale fingerprint survives fresh success and blocks a same-title live fallback", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA = "https://example.com/jobs/software-engineer-a";
  const routeB = "https://example.com/jobs/software-engineer-b";
  const title = "Software Engineer";
  const htmlA = "same-title-job-a-html";
  const htmlB = "same-title-job-b-html";
  const jsonLdA = createJobPostingJsonLd(title, "2026-06-01");
  const jsonLdB = createJobPostingJsonLd(title, "2026-07-02");
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();
  const requests = [];
  let failRouteB = false;

  setFakeJobPage(document, title, { jsonLdText: jsonLdA });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch(url) {
      requests.push(url);
      if (failRouteB && url === routeB) {
        return Promise.reject(new Error("Network unavailable"));
      }
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(url === routeA ? htmlA : htmlB);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [htmlA]: { title, jsonLdText: jsonLdA },
      [htmlB]: { title, jsonLdText: jsonLdB }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  setFakeJobPage(document, title);
  navigation.dispatch("navigatesuccess");
  frames.runNext();
  await flushAsyncWork();

  assert.deepEqual(requests, [routeA, routeB]);
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    new RegExp(title)
  );

  failRouteB = true;
  const failedRefresh = await fakeWindow.JobDateLens.scanOnce();
  const domAttempt = failedRefresh.debug.attempts.find(
    (attempt) => attempt.source === "dom-jsonld"
  );

  assert.equal(failedRefresh.found, false);
  assert.deepEqual(requests, [routeA, routeB, routeB]);
  assert.equal(domAttempt.reason, "unchanged-after-navigation");
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    /Structured job data looks stale/
  );
});

test("manual activation shares a pending SPA frame and in-flight route scan", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA =
    "https://jobs.ashbyhq.com/meticulous/e6d1e0ab-8a28-49ee-94ed-d232886cd7d5";
  const routeB =
    "https://jobs.ashbyhq.com/meticulous/9b592dc5-6262-42ff-bbd7-f1b2ae8e7543";
  const titleA = "Forward Deployed Engineer (New Grad)";
  const titleB = "Forward Deployed Engineer, London";
  const htmlA = "coalesced-ashby-job-a-html";
  const htmlB = "coalesced-ashby-job-b-html";
  const jsonLdA = createJobPostingJsonLd(titleA, "2026-06-01");
  const jsonLdB = createJobPostingJsonLd(titleB, "2026-07-02");
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();
  let fetchCalls = 0;
  let resolveFetch;

  setFakeJobPage(document, titleA, {
    jsonLdText: jsonLdA
  });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch(url) {
      fetchCalls += 1;
      if (url === routeA) {
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(htmlA);
          }
        });
      }
      return new Promise((resolve) => {
        resolveFetch = () =>
          resolve({
            ok: true,
            text() {
              return Promise.resolve(htmlB);
            }
          });
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [htmlA]: {
        title: titleA,
        jsonLdText: jsonLdA
      },
      [htmlB]: {
        title: titleB,
        jsonLdText: jsonLdB
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  setFakeJobPage(document, titleB, {
    jsonLdText: createJobPostingJsonLd(titleB, "2026-01-01", "Meticulous", {
      url: routeB
    })
  });
  navigation.dispatch("navigatesuccess");

  const pendingFrameScan = fakeWindow.JobDateLens.scanOnce();
  const duplicatePendingFrameScan = fakeWindow.JobDateLens.scanOnce();

  assert.strictEqual(duplicatePendingFrameScan, pendingFrameScan);
  assert.equal(frames.pendingCount(), 1);
  assert.equal(fetchCalls, 1);

  assert.equal(frames.runNext(), true);
  await flushAsyncWork();
  assert.equal(fetchCalls, 2);

  const inFlightScan = fakeWindow.JobDateLens.scanOnce();
  assert.strictEqual(inFlightScan, pendingFrameScan);
  assert.equal(fetchCalls, 2);

  resolveFetch();
  const [pendingResult, duplicateResult, inFlightResult] = await Promise.all([
    pendingFrameScan,
    duplicatePendingFrameScan,
    inFlightScan
  ]);

  assert.strictEqual(duplicateResult, pendingResult);
  assert.strictEqual(inFlightResult, pendingResult);
  assert.equal(pendingResult.source, "html");
  assert.equal(fetchCalls, 2);
  assert.equal(
    pendingResult.debug.attempts.find(
      (attempt) => attempt.phase === "navigation-fast-path"
    ),
    undefined
  );
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    new RegExp(titleB)
  );
});

test("manual activation guards a changed route when its Navigation API event was missed", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA =
    "https://jobs.ashbyhq.com/meticulous/e6d1e0ab-8a28-49ee-94ed-d232886cd7d5";
  const routeB =
    "https://jobs.ashbyhq.com/meticulous/9b592dc5-6262-42ff-bbd7-f1b2ae8e7543";
  const titleA = "Forward Deployed Engineer (New Grad)";
  const titleB = "Forward Deployed Engineer, London";
  const htmlA = "missed-navigation-ashby-job-a-html";
  const htmlB = "missed-navigation-ashby-job-b-html";
  const jsonLdA = createJobPostingJsonLd(titleA, "2026-06-01");
  const jsonLdB = createJobPostingJsonLd(titleB, "2026-07-02");
  const document = createFakeDocument();
  const requests = [];
  let failRouteB = false;

  setFakeJobPage(document, titleA, {
    jsonLdText: jsonLdA
  });
  const fakeWindow = {
    location: { href: routeA },
    setTimeout,
    clearTimeout,
    fetch(url) {
      requests.push(url);
      if (failRouteB && url === routeB) {
        return Promise.reject(new Error("Network unavailable"));
      }
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(url === routeA ? htmlA : htmlB);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [htmlA]: {
        title: titleA,
        jsonLdText: jsonLdA
      },
      [htmlB]: {
        title: titleB,
        jsonLdText: jsonLdB
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  fakeWindow.location.href = routeB;
  setFakeJobPage(document, titleB);
  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(result.source, "html");
  assert.deepEqual(requests, [routeA, routeB]);
  assert.equal(
    result.debug.attempts.find((attempt) => attempt.source === "dom-jsonld"),
    undefined
  );
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    new RegExp(titleB)
  );

  failRouteB = true;
  const failedRefresh = await fakeWindow.JobDateLens.scanOnce();
  const domAttempt = failedRefresh.debug.attempts.find(
    (attempt) => attempt.source === "dom-jsonld"
  );

  assert.equal(failedRefresh.found, false);
  assert.deepEqual(requests, [routeA, routeB, routeB]);
  assert.equal(domAttempt.reason, "unchanged-after-navigation");
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    /Structured job data looks stale/
  );
});

test("navigation filtering ignores hashes and full documents, and Close cancels a pending frame", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA =
    "https://jobs.ashbyhq.com/meticulous/e6d1e0ab-8a28-49ee-94ed-d232886cd7d5";
  const routeB = `${routeA}?department=engineering`;
  const titleA = "Product Engineer";
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();

  setFakeJobPage(document, titleA, {
    jsonLdText: createJobPostingJsonLd(titleA, "2026-06-01", "Meticulous", {
      url: routeA
    })
  });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch() {
      return Promise.reject(new Error("Unexpected fetch"));
    }
  };
  const context = vm.createContext({ console, document, URL, window: fakeWindow });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  navigation.dispatch("navigate", {
    destination: { url: `${routeA}#details`, sameDocument: true },
    hashChange: true
  });
  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: false },
    hashChange: false
  });

  let badge = document.getElementById("jobdatelens-badge");
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), new RegExp(titleA));
  assert.equal(frames.pendingCount(), 0);

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  navigation.dispatch("navigatesuccess");

  assert.equal(frames.pendingCount(), 1);
  const pendingScan = fakeWindow.JobDateLens.scanOnce();
  badge = document.getElementById("jobdatelens-badge");
  findButtonByTitle(badge, "Close JobDateLens").click();
  const closedResult = await pendingScan;

  assert.equal(document.getElementById("jobdatelens-badge"), null);
  assert.equal(closedResult.reason, "scan-superseded");
  assert.equal(frames.pendingCount(), 0);
  assert.equal(navigation.listenerCount("navigate"), 0);
  assert.equal(navigation.listenerCount("navigatesuccess"), 0);
  assert.equal(navigation.listenerCount("navigateerror"), 0);
});

test("rapid SPA navigation cancels old frames and discards late provider results", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA =
    "https://jobs.ashbyhq.com/meticulous/e6d1e0ab-8a28-49ee-94ed-d232886cd7d5";
  const routeB =
    "https://jobs.ashbyhq.com/meticulous/18ab8f7f-e950-4f8d-a525-9e21c7f8940d";
  const routeC =
    "https://jobs.ashbyhq.com/meticulous/c6e38f33-b36d-4453-8f89-3db74b94da1f";
  const routeD =
    "https://jobs.ashbyhq.com/meticulous/5a0bf6c6-09f2-4fe1-aab2-7f249bb75c33";
  const titleA = "Job A";
  const titleC = "Job C";
  const titleD = "Job D";
  const htmlA = "ashby-job-a-html";
  const htmlC = "ashby-job-c-html";
  const htmlD = "ashby-job-d-html";
  const jsonLdA = createJobPostingJsonLd(titleA, "2026-06-01");
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();
  const pendingResponses = [];

  setFakeJobPage(document, titleA, {
    jsonLdText: jsonLdA
  });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch(url) {
      if (url === routeA) {
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(htmlA);
          }
        });
      }
      return new Promise((resolve) => {
        pendingResponses.push({ url, resolve });
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [htmlA]: {
        title: titleA,
        jsonLdText: jsonLdA
      },
      [htmlC]: {
        title: titleC,
        jsonLdText: createJobPostingJsonLd(titleC, "2026-07-03")
      },
      [htmlD]: {
        title: titleD,
        jsonLdText: createJobPostingJsonLd(titleD, "2026-07-04")
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  setFakeJobPage(document, "Job B");
  navigation.dispatch("navigatesuccess");
  assert.equal(frames.pendingCount(), 1);

  navigation.dispatch("navigate", {
    destination: { url: routeC, sameDocument: true },
    hashChange: false
  });
  assert.equal(frames.pendingCount(), 0);
  fakeWindow.location.href = routeC;
  navigation.currentEntry.url = routeC;
  setFakeJobPage(document, titleC);
  navigation.dispatch("navigatesuccess");
  frames.runNext();
  assert.equal(pendingResponses.length, 1);
  assert.equal(pendingResponses[0].url, routeC);

  navigation.dispatch("navigate", {
    destination: { url: routeD, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeD;
  navigation.currentEntry.url = routeD;
  setFakeJobPage(document, titleD);
  navigation.dispatch("navigatesuccess");
  frames.runNext();
  assert.equal(pendingResponses.length, 2);
  assert.equal(pendingResponses[1].url, routeD);

  pendingResponses[1].resolve({
    ok: true,
    text() {
      return Promise.resolve(htmlD);
    }
  });
  await flushAsyncWork();
  let badge = document.getElementById("jobdatelens-badge");
  assert.match(getElementText(badge), new RegExp(titleD));

  pendingResponses[0].resolve({
    ok: true,
    text() {
      return Promise.resolve(htmlC);
    }
  });
  await flushAsyncWork();
  badge = document.getElementById("jobdatelens-badge");

  assert.match(getElementText(badge), new RegExp(titleD));
  assert.ok(!getElementText(badge).includes(titleC));
  assert.equal(fakeWindow.JobDateLens.getLastScanDebug().pageUrl, routeD);
  assert.equal(frames.pendingCount(), 0);
});

test("failed SPA refresh offers one user-triggered Retry and keeps Close available", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA =
    "https://jobs.ashbyhq.com/meticulous/e6d1e0ab-8a28-49ee-94ed-d232886cd7d5";
  const routeB =
    "https://jobs.ashbyhq.com/meticulous/18ab8f7f-e950-4f8d-a525-9e21c7f8940d";
  const titleA = "Initial Job";
  const titleB = "Recovered Job";
  const htmlA = "ashby-initial-html";
  const emptyHtml = "ashby-empty-html";
  const validHtml = "ashby-retry-html";
  const jsonLdA = createJobPostingJsonLd(titleA, "2026-06-01");
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();
  let fetchCalls = 0;
  let routeBFetchCalls = 0;

  setFakeJobPage(document, titleA, {
    jsonLdText: jsonLdA
  });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch(url) {
      fetchCalls += 1;
      if (url === routeA) {
        return Promise.resolve({
          ok: true,
          text() {
            return Promise.resolve(htmlA);
          }
        });
      }
      routeBFetchCalls += 1;
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(routeBFetchCalls === 1 ? emptyHtml : validHtml);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [htmlA]: { title: titleA, jsonLdText: jsonLdA },
      [emptyHtml]: { title: titleB, jsonLdText: "" },
      [validHtml]: {
        title: titleB,
        jsonLdText: createJobPostingJsonLd(titleB, "2026-07-05")
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  setFakeJobPage(document, titleB);
  navigation.dispatch("navigatesuccess");
  frames.runNext();
  await flushAsyncWork();

  let badge = document.getElementById("jobdatelens-badge");
  assert.equal(fetchCalls, 2);
  assert.equal(routeBFetchCalls, 1);
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), /Couldn’t load job dates/);
  assert.match(getElementText(badge), /Structured job data looks stale/);
  assert.ok(findButtonByTitle(badge, "Close JobDateLens"));
  const retryButton = findButtonByText(badge, "Retry");
  assert.ok(retryButton);

  setFakeJobPage(document, titleB, {
    jsonLdText: createJobPostingJsonLd(titleB, "2026-01-01", "Meticulous", {
      url: routeB
    })
  });
  retryButton.click();
  retryButton.click();
  badge = document.getElementById("jobdatelens-badge");
  assert.equal(badge.attributes["aria-busy"], "true");
  assert.equal(fetchCalls, 3);
  assert.equal(routeBFetchCalls, 2);
  await flushAsyncWork();

  badge = document.getElementById("jobdatelens-badge");
  assert.equal(fetchCalls, 3);
  assert.equal(routeBFetchCalls, 2);
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), new RegExp(titleB));
  assert.equal(findButtonByText(badge, "Retry"), null);
  assert.equal(fakeWindow.JobDateLens.getLastScanDebug().selectedSource, "html-fallback");
  assert.equal(
    fakeWindow.JobDateLens.getLastScanDebug().attempts.find(
      (attempt) => attempt.phase === "navigation-fast-path"
    ),
    undefined
  );
});

test("scanOnce treats failed HTML fallback after navigation as superseded", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const document = createFakeDocument();
  const fakeWindow = {
    location: {
      href: "https://example.com/jobs/old-role"
    },
    setTimeout,
    clearTimeout,
    fetch() {
      return new Promise((resolve, reject) => {
        fakeWindow.setTimeout(() => {
          fakeWindow.location.href = "https://example.com/jobs/new-role";
          reject(new Error("Network unavailable"));
        }, 0);
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(result.reason, "scan-superseded");
  assert.equal(document.getElementById("jobdatelens-notice"), null);
});

test("scanOnce fetches canonical Lever job HTML from apply pages", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const applyUrl =
    "https://jobs.lever.co/shopback-2/4e119b8f-3c8d-47e6-9dde-f232930e752c/apply";
  const canonicalUrl =
    "https://jobs.lever.co/shopback-2/4e119b8f-3c8d-47e6-9dde-f232930e752c";
  const html = "<!doctype html><title>Lever Job</title>";
  const jsonLdText = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Software Engineer Intern - Backend (May - Dec 2026)",
    datePosted: "2026-01-28",
    hiringOrganization: {
      "@type": "Organization",
      name: "ShopBack"
    }
  });
  const document = createFakeDocument();
  const parsedDocument = createJsonLdDocument(jsonLdText);
  let fetchedUrl = "";

  document.title = "ShopBack - Software Engineer Intern - Backend (May - Dec 2026)";
  document.body.innerText =
    "Submit your application Software Engineer Intern - Backend (May - Dec 2026) ShopBack";
  document.body.textContent = document.body.innerText;

  const fakeWindow = {
    location: {
      href: applyUrl
    },
    setTimeout,
    clearTimeout,
    fetch(url) {
      fetchedUrl = url;
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(html);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: class {
      parseFromString(htmlText, type) {
        assert.equal(htmlText, html);
        assert.equal(type, "text/html");
        return parsedDocument;
      }
    },
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(fetchedUrl, canonicalUrl);
  assert.equal(result.found, true);
  assert.equal(result.source, "html");
  assert.equal(document.getElementById("jobdatelens-badge").tagName, "ASIDE");
});

test("scanOnce keeps non-Lever apply pages on current URL HTML fallback", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const currentUrl = "https://example.com/shopback-2/posting-id/apply";
  const html = "<!doctype html><title>No JSON-LD</title>";
  const document = createFakeDocument();
  const parsedDocument = createJsonLdDocument("");
  let fetchedUrl = "";
  let fetchOptions = null;

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch(url, options) {
      fetchedUrl = url;
      fetchOptions = options;
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(html);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: class {
      parseFromString(htmlText, type) {
        assert.equal(htmlText, html);
        assert.equal(type, "text/html");
        return parsedDocument;
      }
    },
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(fetchedUrl, currentUrl);
  assert.equal(fetchOptions.cache, "no-store");
  assert.equal(fetchOptions.credentials, "include");
  assert.equal(fetchOptions.headers.Accept, fakeWindow.JobDateLens.HTML_ACCEPT_HEADER);
  assert.equal(result.found, false);
  assert.equal(result.reason, "html-no-match");
});

test("canonical response redirects remain trusted", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const pageUrl =
    "https://careers.example.com/jobs/platform/?utm_source=email&gclid=click#details";
  const finalUrl = "https://careers.example.com/jobs/platform";
  const html = "canonical-redirect-html";
  const title = "Platform Engineer";
  const document = createFakeDocument();

  setFakeJobPage(document, title, { jsonLdText: "" });
  const fakeWindow = {
    location: { href: pageUrl },
    setTimeout,
    clearTimeout,
    fetch() {
      return Promise.resolve({
        ok: true,
        url: finalUrl,
        text() {
          return Promise.resolve(html);
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    DOMParser: createMappedDomParser({
      [html]: {
        title,
        jsonLdText: createJobPostingJsonLd(title, "2026-07-23")
      }
    }),
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);
  const result = await fakeWindow.JobDateLens.scanOnce();
  const htmlAttempt = result.debug.attempts.find(
    (attempt) => attempt.source === "html-fallback"
  );

  assert.equal(result.found, true);
  assert.equal(result.source, "html");
  assert.equal(htmlAttempt.response.route, "response-route-matched");
  assert.equal(htmlAttempt.response.finalUrl, finalUrl);
});

test("login, checkpoint, generic, and different-job redirects fail route validation", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const cases = [
    ["login", "https://careers.example.com/login"],
    ["checkpoint", "https://careers.example.com/checkpoint/security"],
    ["generic", "https://careers.example.com/jobs"],
    ["different-job", "https://careers.example.com/jobs/other-role"]
  ];

  for (const [name, finalUrl] of cases) {
    const pageUrl = `https://careers.example.com/jobs/${name}-engineer`;
    const document = createFakeDocument();
    let bodyRead = false;

    setFakeJobPage(document, `${name} Engineer`, { jsonLdText: "" });
    const fakeWindow = {
      location: { href: pageUrl },
      setTimeout,
      clearTimeout,
      fetch() {
        return Promise.resolve({
          ok: true,
          url: finalUrl,
          text() {
            bodyRead = true;
            return Promise.resolve("untrusted-redirect-html");
          }
        });
      }
    };
    const context = vm.createContext({ console, document, URL, window: fakeWindow });

    vm.runInContext(source, context);
    const result = await fakeWindow.JobDateLens.scanOnce();
    const htmlAttempt = result.debug.attempts.find(
      (attempt) => attempt.source === "html-fallback"
    );
    const domAttempts = result.debug.attempts.filter(
      (attempt) => attempt.source === "dom-jsonld"
    );

    assert.equal(result.found, false, name);
    assert.equal(result.reason, "response-route-mismatch", name);
    assert.equal(htmlAttempt.status, "failed", name);
    assert.equal(htmlAttempt.reason, "response-route-mismatch", name);
    assert.equal(htmlAttempt.response.finalUrl, finalUrl, name);
    assert.equal(domAttempts.length, 1, name);
    assert.equal(domAttempts[0].phase, "post-fetch", name);
    assert.equal(bodyRead, false, name);
  }
});

test("Greenhouse SPA navigation stays API-first and then accepts attested live DOM", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const routeA = "https://job-boards.greenhouse.io/pallet/jobs/5169663007";
  const routeB = "https://job-boards.greenhouse.io/pallet/jobs/5169663008";
  const apiA = "https://boards-api.greenhouse.io/v1/boards/pallet/jobs/5169663007";
  const apiB = "https://boards-api.greenhouse.io/v1/boards/pallet/jobs/5169663008";
  const titleA = "Initial Greenhouse Engineer";
  const titleB = "New Greenhouse Engineer";
  const document = createFakeDocument();
  const navigation = createFakeNavigation(routeA);
  const frames = createAnimationFrameHarness();
  const requests = [];

  setFakeJobPage(document, titleA, { jsonLdText: "" });
  const fakeWindow = {
    location: { href: routeA },
    navigation,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    fetch(url) {
      requests.push(url);
      assert.ok(url === apiA || url === apiB);
      return Promise.resolve({
        ok: true,
        url,
        json() {
          return Promise.resolve(
            url === apiA
              ? {
                  title: titleA,
                  company_name: "Pallet",
                  first_published: "2026-06-01T10:00:00Z"
                }
              : {}
          );
        }
      });
    }
  };
  const context = vm.createContext({ console, document, URL, window: fakeWindow });

  vm.runInContext(source, context);
  await fakeWindow.JobDateLens.scanOnce();

  navigation.dispatch("navigate", {
    destination: { url: routeB, sameDocument: true },
    hashChange: false
  });
  fakeWindow.location.href = routeB;
  navigation.currentEntry.url = routeB;
  setFakeJobPage(document, titleB, {
    jsonLdText: createJobPostingJsonLd(titleB, "2026-07-22", "Pallet", {
      url: routeB
    })
  });
  navigation.dispatch("navigatesuccess");
  frames.runNext();
  await flushAsyncWork();

  const debug = fakeWindow.JobDateLens.getLastScanDebug();
  const greenhouseAttempt = debug.attempts.find(
    (attempt) => attempt.source === "greenhouse-api"
  );
  const domAttempts = debug.attempts.filter(
    (attempt) => attempt.source === "dom-jsonld"
  );

  assert.deepEqual(requests, [apiA, apiB]);
  assert.equal(greenhouseAttempt.status, "no-match");
  assert.equal(domAttempts.length, 1);
  assert.equal(domAttempts[0].phase, "post-fetch");
  assert.equal(domAttempts[0].status, "selected");
  assert.equal(domAttempts[0].reason, "route-identity-matched");
  assert.match(
    getElementText(document.getElementById("jobdatelens-badge")),
    new RegExp(titleB)
  );
});

test("scanOnce fetches direct Greenhouse public API dates", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const currentUrl = "https://job-boards.greenhouse.io/pallet/jobs/5169663007";
  const document = createFakeDocument();
  let fetchedUrl = "";
  let fetchOptions = null;

  document.title = "Job Application for Forward Deployed Product Engineer at Pallet";
  document.body.innerText = "Forward Deployed Product Engineer Pallet San Francisco or New York";
  document.body.textContent = document.body.innerText;
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return {
        textContent: "Forward Deployed Product Engineer"
      };
    }
    return null;
  };

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch(url, options) {
      fetchedUrl = url;
      fetchOptions = options;
      return Promise.resolve({
        ok: true,
        json() {
          return Promise.resolve({
            title: "Forward Deployed Product Engineer",
            company_name: "Pallet",
            first_published: "2026-06-19T12:45:42-04:00",
            updated_at: "2026-06-19T12:45:42-04:00",
            application_deadline: null
          });
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();
  const badge = document.getElementById("jobdatelens-badge");
  const rows = badge.childNodes[1].childNodes.map((row) => [
    row.childNodes[0].textContent,
    row.childNodes[1].childNodes[0].textContent
  ]);

  assert.equal(fetchedUrl, "https://boards-api.greenhouse.io/v1/boards/pallet/jobs/5169663007");
  assert.equal(fetchOptions.cache, "no-store");
  assert.equal(fetchOptions.credentials, "omit");
  assert.equal(fetchOptions.headers.Accept, fakeWindow.JobDateLens.JSON_ACCEPT_HEADER);
  assert.equal(result.found, true);
  assert.equal(result.source, "greenhouse-api");
  assert.deepEqual(
    rows.map((row) => row[0]),
    ["Role", "Company", "Posted", "Deadline", "Last updated"]
  );
  assert.deepEqual(rows.find((row) => row[0] === "Deadline"), ["Deadline", "Not provided"]);
});

test("scanOnce finds Greenhouse board token from custom page embed hints", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const currentUrl = "https://ripple.com/careers/all-jobs/job/7724653/?gh_jid=7724653";
  const document = createFakeDocument();
  let fetchedUrl = "";

  document.title = "Open Role - Senior Software Engineer (Full Stack) | Ripple";
  document.body.innerText = "Senior Software Engineer Full Stack Ripple";
  document.body.textContent = document.body.innerText;
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return {
        textContent: "Senior Software Engineer (Full Stack)"
      };
    }
    return null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === "iframe[src], script[src], link[href], a[href]") {
      return [
        {
          href: "https://boards.greenhouse.io/embed/job_board/js?for=ripple"
        }
      ];
    }
    if (selector === "a[href]") {
      return [];
    }
    return [];
  };

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch(url) {
      fetchedUrl = url;
      return Promise.resolve({
        ok: true,
        json() {
          return Promise.resolve({
            title: "Senior Software Engineer (Full Stack)",
            company_name: "Ripple ",
            first_published: "2026-03-17T12:09:44-04:00",
            updated_at: "2026-06-05T19:22:10-04:00",
            application_deadline: null
          });
        }
      });
    }
  };
  const context = vm.createContext({
    console,
    document,
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(fetchedUrl, "https://boards-api.greenhouse.io/v1/boards/ripple/jobs/7724653");
  assert.equal(result.found, true);
  assert.equal(result.source, "greenhouse-api");
});

test("scanOnce falls through to current page HTML after Ashby no-match", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const jobId = "0cd9781c-e158-4b0c-9979-04ead270933a";
  const currentUrl = `https://www.8090.ai/careers?ashby_jid=${jobId}`;
  const ashbyHtml = "<!doctype html><title>Ashby Job</title>";
  const currentHtml = "<!doctype html><title>Current Job</title>";
  const jsonLdText = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Full Stack Engineer",
    datePosted: "2026-05-04",
    hiringOrganization: {
      "@type": "Organization",
      name: "8090 Solutions Inc"
    }
  });
  const document = createFakeDocument();
  const ashbyDocument = createJsonLdDocument([]);
  const currentPageDocument = createJsonLdDocument(jsonLdText);
  let message = null;
  let fetchedUrl = "";

  document.title = "Full Stack Engineer | 8090";
  document.body.innerText = "Full Stack Engineer 8090 Solutions Inc";
  document.body.textContent = document.body.innerText;
  document.scripts = [
    {
      src: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc/embed?version=2"
    }
  ];
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return {
        textContent: "Full Stack Engineer"
      };
    }
    return null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === "iframe[src], script[src], link[href], a[href]") {
      return document.scripts;
    }
    if (selector === "a[href]" || selector === "script[src], link[href], a[href]") {
      return [];
    }
    return [];
  };

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch(url) {
      fetchedUrl = url;
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(currentHtml);
        }
      });
    }
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage(request, callback) {
        message = request;
        callback({
          ok: true,
          htmlText: ashbyHtml
        });
      }
    }
  };
  const context = vm.createContext({
    chrome: fakeChrome,
    console,
    document,
    DOMParser: class {
      parseFromString(htmlText, type) {
        assert.equal(type, "text/html");
        if (htmlText === ashbyHtml) {
          return ashbyDocument;
        }
        if (htmlText === currentHtml) {
          return currentPageDocument;
        }
        throw new Error(`Unexpected HTML fixture: ${htmlText}`);
      }
    },
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();
  const ashbyAttempt = result.debug.attempts.find((attempt) => attempt.source === "ashby-jsonld");
  const htmlAttempt = result.debug.attempts.find((attempt) => attempt.source === "html-fallback");

  assert.equal(message.type, "jobdatelens:fetchAshbyJobPosting");
  assert.equal(
    message.jobUrl,
    `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}?embed=js`
  );
  assert.equal(fetchedUrl, currentUrl);
  assert.equal(result.found, true);
  assert.equal(result.source, "html");
  assert.equal(ashbyAttempt.status, "no-match");
  assert.equal(ashbyAttempt.reason, "ashby-jsonld-no-match");
  assert.equal(htmlAttempt.status, "selected");
  assert.equal(document.getElementById("jobdatelens-badge").tagName, "ASIDE");
});

test("scanOnce fetches derived YC JobPosting HTML through the background service worker", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const currentUrl = "https://www.workatastartup.com/jobs/97127";
  const dataPage = JSON.stringify({
    props: {
      job: {
        id: 97127
      },
      company: {
        slug: "ruma-care"
      }
    }
  });
  const ycHtml = "<!doctype html><title>YC Job</title>";
  const jsonLdText = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Product Engineer",
    datePosted: "2026-06-19T07:42:33Z",
    hiringOrganization: {
      "@type": "Organization",
      name: "Ruma Care"
    }
  });
  const document = createFakeDocument();
  const parsedDocument = createJsonLdDocument(jsonLdText);
  let message = null;
  let currentPageFetchCalled = false;

  document.title = "Product Engineer at Ruma Care";
  document.body.innerText = "Product Engineer Ruma Care";
  document.body.textContent = document.body.innerText;
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return {
        textContent: "Product Engineer"
      };
    }
    if (selector === "[data-page]") {
      return {
        getAttribute(name) {
          assert.equal(name, "data-page");
          return dataPage;
        }
      };
    }
    return null;
  };

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch() {
      currentPageFetchCalled = true;
      return Promise.reject(new Error("Current page fetch should not run"));
    }
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage(request, callback) {
        message = request;
        callback({
          ok: true,
          htmlText: ycHtml,
          url: "https://www.ycombinator.com/companies/ruma-care/jobs/fUj2G2Y-product-engineer"
        });
      }
    }
  };
  const context = vm.createContext({
    chrome: fakeChrome,
    console,
    document,
    DOMParser: class {
      parseFromString(htmlText, type) {
        assert.equal(htmlText, ycHtml);
        assert.equal(type, "text/html");
        return parsedDocument;
      }
    },
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(message.type, "jobdatelens:fetchYcJobPosting");
  assert.equal(message.jobId, 97127);
  assert.equal(message.companySlug, "ruma-care");
  assert.equal(currentPageFetchCalled, false);
  assert.equal(result.found, true);
  assert.equal(result.source, "yc-jsonld");
  assert.equal(document.getElementById("jobdatelens-badge").tagName, "ASIDE");
});

test("scanOnce treats derived YC JobPosting HTML without datePosted as no data", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const currentUrl = "https://www.workatastartup.com/jobs/97127";
  const dataPage = JSON.stringify({
    props: {
      job: {
        id: 97127
      },
      company: {
        slug: "ruma-care"
      }
    }
  });
  const ycHtml = "<!doctype html><title>YC Job</title>";
  const jsonLdText = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Product Engineer",
    hiringOrganization: {
      "@type": "Organization",
      name: "Ruma Care"
    }
  });
  const document = createFakeDocument();
  const parsedDocument = createJsonLdDocument(jsonLdText);
  let currentPageFetchCalled = false;

  document.title = "Product Engineer at Ruma Care";
  document.body.innerText = "Product Engineer Ruma Care";
  document.body.textContent = document.body.innerText;
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return {
        textContent: "Product Engineer"
      };
    }
    if (selector === "[data-page]") {
      return {
        getAttribute() {
          return dataPage;
        }
      };
    }
    return null;
  };

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch() {
      currentPageFetchCalled = true;
      return Promise.reject(new Error("Current page fetch should not run"));
    }
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage(request, callback) {
        callback({
          ok: true,
          htmlText: ycHtml,
          url: "https://www.ycombinator.com/companies/ruma-care/jobs/fUj2G2Y-product-engineer"
        });
      }
    }
  };
  const context = vm.createContext({
    chrome: fakeChrome,
    console,
    document,
    DOMParser: class {
      parseFromString(htmlText, type) {
        assert.equal(htmlText, ycHtml);
        assert.equal(type, "text/html");
        return parsedDocument;
      }
    },
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(currentPageFetchCalled, false);
  assert.equal(result.found, false);
  assert.equal(result.source, "yc-jsonld");
  assert.equal(result.reason, "yc-jsonld-no-match");
  const badge = document.getElementById("jobdatelens-badge");

  assert.equal(badge.tagName, "ASIDE");
  assert.equal(badge.attributes["aria-busy"], "false");
  assert.match(getElementText(badge), /Couldn’t load job dates/);
  assert.ok(findButtonByText(badge, "Retry"));
  assert.equal(document.getElementById("jobdatelens-notice"), null);
});

test("scanOnce fetches linked Lever job HTML through the background service worker", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const currentUrl =
    "https://www.binance.com/en/careers/job?id=b3f90add-c407-45c9-b306-05b06d9a8054";
  const leverApplyUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054/apply";
  const leverCanonicalUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054";
  const html = "<!doctype html><title>Lever Job</title>";
  const jsonLdText = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Binance Accelerator Program - AI Intelligence Efficiency Engineer",
    datePosted: "2026-04-20",
    hiringOrganization: {
      "@type": "Organization",
      name: "Binance"
    }
  });
  const document = createFakeDocument();
  const parsedDocument = createJsonLdDocument(jsonLdText);
  let message = null;
  let currentPageFetchCalled = false;

  document.title = "Binance Job Details";
  document.body.innerText =
    "Binance Accelerator Program - AI Intelligence Efficiency Engineer Apply for this Job";
  document.body.textContent = document.body.innerText;
  document.links = [
    {
      href: leverApplyUrl
    }
  ];
  document.querySelector = (selector) => {
    if (selector === "h1") {
      return {
        textContent: "Binance Accelerator Program - AI Intelligence Efficiency Engineer"
      };
    }
    return null;
  };

  const fakeWindow = {
    location: {
      href: currentUrl
    },
    setTimeout,
    clearTimeout,
    fetch() {
      currentPageFetchCalled = true;
      return Promise.reject(new Error("Current page fetch should not run"));
    }
  };
  const fakeChrome = {
    runtime: {
      lastError: null,
      sendMessage(request, callback) {
        message = request;
        callback({
          ok: true,
          htmlText: html,
          url: leverCanonicalUrl
        });
      }
    }
  };
  const context = vm.createContext({
    chrome: fakeChrome,
    console,
    document,
    DOMParser: class {
      parseFromString(htmlText, type) {
        assert.equal(htmlText, html);
        assert.equal(type, "text/html");
        return parsedDocument;
      }
    },
    URL,
    window: fakeWindow
  });

  vm.runInContext(source, context);

  const result = await fakeWindow.JobDateLens.scanOnce();

  assert.equal(message.type, "jobdatelens:fetchHtmlFallback");
  assert.equal(message.url, leverCanonicalUrl);
  assert.equal(currentPageFetchCalled, false);
  assert.equal(result.found, true);
  assert.equal(result.source, "html");
  assert.equal(document.getElementById("jobdatelens-badge").tagName, "ASIDE");
});
