const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { browserFixtures } = require("./provider-fixtures");

function createFakeElement(document, tagName) {
  const childNodes = [];
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
    addEventListener() {},
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
      return { textContent: options.heading };
    }
    return null;
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
          htmlText: fixture.background.htmlText
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
    if (selector === "script[src], link[href], a[href]") {
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
  assert.equal(document.getElementById("jobdatelens-badge"), null);
  assert.equal(document.getElementById("jobdatelens-notice").tagName, "ASIDE");
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
