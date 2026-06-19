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
