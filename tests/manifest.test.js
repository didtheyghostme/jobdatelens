const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

test("manifest releases the Navigation API build for Chrome 102+", () => {
  assert.equal(manifest.version, "1.1.0");
  assert.equal(manifest.minimum_chrome_version, "102");
});

test("manifest keeps the existing permission and host-access surface", () => {
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://jobs.lever.co/*",
    "https://www.ycombinator.com/*",
    "https://jobs.ashbyhq.com/*"
  ]);
  assert.equal(manifest.storage, undefined);
});
