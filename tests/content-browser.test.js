const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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

  document.title = options.title || "";
  document.body.innerText = options.visibleText || "";
  document.body.textContent = document.body.innerText;
  document.scripts = jsonLdText
    ? [
        {
          type: "application/ld+json",
          textContent: jsonLdText
        }
      ]
    : [];
  document.querySelector = (selector) => {
    if (selector === "h1" && options.heading) {
      return { textContent: options.heading };
    }
    return null;
  };

  return document;
}

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
