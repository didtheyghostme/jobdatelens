const assert = require("node:assert/strict");
const test = require("node:test");

const background = require("../background.js");

test("detects when the execute action shortcut is unassigned", () => {
  assert.equal(
    background.isCommandShortcutUnassigned(
      [
        {
          name: background.EXECUTE_ACTION_COMMAND,
          shortcut: ""
        }
      ],
      background.EXECUTE_ACTION_COMMAND
    ),
    true
  );
});

test("does not treat an assigned execute action shortcut as unassigned", () => {
  assert.equal(
    background.isCommandShortcutUnassigned(
      [
        {
          name: background.EXECUTE_ACTION_COMMAND,
          shortcut: "Command+Shift+E"
        }
      ],
      background.EXECUTE_ACTION_COMMAND
    ),
    false
  );
});

test("ignores unassigned shortcuts for other commands", () => {
  assert.equal(
    background.isCommandShortcutUnassigned(
      [
        {
          name: "other-command",
          shortcut: ""
        }
      ],
      background.EXECUTE_ACTION_COMMAND
    ),
    false
  );
});

test("does not infer an unassigned shortcut when the command is missing", () => {
  assert.equal(
    background.isCommandShortcutUnassigned([], background.EXECUTE_ACTION_COMMAND),
    false
  );
  assert.equal(
    background.isCommandShortcutUnassigned(null, background.EXECUTE_ACTION_COMMAND),
    false
  );
});

test("canonicalizes only supported Lever posting fallback URLs", () => {
  const applyUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054/apply?source=binance";
  const canonicalUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054";

  assert.equal(background.getCanonicalLeverPostingUrl(applyUrl), canonicalUrl);
  assert.equal(background.getCanonicalLeverPostingUrl(canonicalUrl), canonicalUrl);
  assert.equal(background.getCanonicalLeverPostingUrl("https://jobs.lever.co/binance"), null);
  assert.equal(
    background.getCanonicalLeverPostingUrl("https://jobs.lever.co/binance/posting/extra"),
    null
  );
  assert.equal(
    background.getCanonicalLeverPostingUrl("https://jobs.lever.co.evil.com/binance/posting"),
    null
  );
  assert.equal(
    background.getCanonicalLeverPostingUrl("http://jobs.lever.co/binance/posting"),
    null
  );
  assert.equal(background.getCanonicalLeverPostingUrl("not a url"), null);
});

test("fetches validated Lever fallback HTML through the background handler", async () => {
  const applyUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054/apply";
  const canonicalUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054";
  let fetchedUrl = "";
  let fetchOptions = null;

  const response = await background.handleFetchHtmlFallbackMessage(
    {
      type: background.FETCH_HTML_FALLBACK_MESSAGE,
      url: applyUrl
    },
    async (url, options) => {
      fetchedUrl = url;
      fetchOptions = options;
      return {
        ok: true,
        text: async () => "<!doctype html>"
      };
    }
  );

  assert.equal(fetchedUrl, canonicalUrl);
  assert.deepEqual(fetchOptions, {
    cache: "no-store",
    credentials: "omit"
  });
  assert.deepEqual(response, {
    ok: true,
    htmlText: "<!doctype html>",
    url: canonicalUrl
  });
});

test("rejects unsupported background fallback URLs without fetching", async () => {
  let fetchCalled = false;
  const response = await background.handleFetchHtmlFallbackMessage(
    {
      type: background.FETCH_HTML_FALLBACK_MESSAGE,
      url: "https://jobs.lever.co.evil.com/binance/posting/apply"
    },
    async () => {
      fetchCalled = true;
      return {
        ok: true,
        text: async () => ""
      };
    }
  );

  assert.equal(fetchCalled, false);
  assert.deepEqual(response, {
    ok: false,
    message: "Unsupported fallback URL."
  });
});
