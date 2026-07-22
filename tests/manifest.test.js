const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

test("manifest requires Chrome 102+ for Navigation API and chrome.storage.session", () => {
  assert.equal(manifest.minimum_chrome_version, "102");
});

test("manifest adds only session storage to the existing permission surface", () => {
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://jobs.lever.co/*",
    "https://www.ycombinator.com/*",
    "https://jobs.ashbyhq.com/*"
  ]);
  assert.equal(manifest.storage, undefined);
});
