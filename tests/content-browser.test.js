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
  assert.equal(result.found, false);
  assert.equal(result.reason, "html-no-match");
});
