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
    credentials: "omit",
    headers: {
      Accept: background.HTML_ACCEPT_HEADER
    }
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

test("extracts a YC job URL only when the WAAS job id matches exactly", () => {
  const companyHtml = `
    <script>
      {"jobPostings":[
        {"id":95230,"title":"Founding Engineer","url":"/companies/ruma-care/jobs/GYlx8TV-founding-member-of-technical-staff-product-engineer","applyUrl":"https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D95230&defaults%5Bwaas_company%5D=31085"},
        {"id":97127,"title":"Product Engineer","url":"/companies/ruma-care/jobs/fUj2G2Y-product-engineer","applyUrl":"https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D97127&defaults%5Bwaas_company%5D=31085"}
      ]}
    </script>`;

  assert.equal(
    background.extractYcJobPostingUrlFromCompanyHtml(companyHtml, 97127, "ruma-care"),
    "https://www.ycombinator.com/companies/ruma-care/jobs/fUj2G2Y-product-engineer"
  );
  assert.equal(
    background.extractYcJobPostingUrlFromCompanyHtml(companyHtml, 97128, "ruma-care"),
    null
  );
});

test("does not trust a YC job URL without a nearby exact WAAS job id", () => {
  const companyHtml = `
    <a href="/companies/ruma-care/jobs/fUj2G2Y-product-engineer">Product Engineer</a>
    <a href="https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D95230">Apply</a>`;

  assert.equal(
    background.extractYcJobPostingUrlFromCompanyHtml(companyHtml, 97127, "ruma-care"),
    null
  );
});

test("fetches YC job HTML after finding an exact WAAS job id on the YC company page", async () => {
  const companyUrl = "https://www.ycombinator.com/companies/ruma-care";
  const jobUrl = "https://www.ycombinator.com/companies/ruma-care/jobs/fUj2G2Y-product-engineer";
  const companyHtml = `
    <script>
      {"jobPostings":[{"id":97127,"title":"Product Engineer","url":"/companies/ruma-care/jobs/fUj2G2Y-product-engineer","applyUrl":"https://account.ycombinator.com/authenticate?continue=https%3A%2F%2Fwww.workatastartup.com%2Fapplication%3Fsignup_job_id%3D97127&defaults%5Bwaas_company%5D=31085"}]}
    </script>`;
  const jobHtml = '<script type="application/ld+json">{"@type":"JobPosting"}</script>';
  const fetches = [];

  const response = await background.handleFetchYcJobPostingMessage(
    {
      type: background.FETCH_YC_JOB_POSTING_MESSAGE,
      jobId: 97127,
      companySlug: "ruma-care"
    },
    async (url, options) => {
      fetches.push({ url, options });
      return {
        ok: true,
        text: async () => (url === companyUrl ? companyHtml : jobHtml)
      };
    }
  );

  assert.deepEqual(fetches, [
    {
      url: companyUrl,
      options: {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: background.HTML_ACCEPT_HEADER
        }
      }
    },
    {
      url: jobUrl,
      options: {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: background.HTML_ACCEPT_HEADER
        }
      }
    }
  ]);
  assert.deepEqual(response, {
    ok: true,
    htmlText: jobHtml,
    url: jobUrl
  });
});

test("does not fetch a YC job page when the YC company page has no exact WAAS id match", async () => {
  const fetches = [];
  const response = await background.handleFetchYcJobPostingMessage(
    {
      type: background.FETCH_YC_JOB_POSTING_MESSAGE,
      jobId: 97127,
      companySlug: "ruma-care"
    },
    async (url) => {
      fetches.push(url);
      return {
        ok: true,
        text: async () =>
          '{"jobPostings":[{"id":95230,"url":"/companies/ruma-care/jobs/other-product-engineer"}]}'
      };
    }
  );

  assert.deepEqual(fetches, ["https://www.ycombinator.com/companies/ruma-care"]);
  assert.deepEqual(response, {
    ok: false,
    message: "No exact YC job match."
  });
});

test("returns a YC lookup failure when the YC company fetch fails", async () => {
  const response = await background.handleFetchYcJobPostingMessage(
    {
      type: background.FETCH_YC_JOB_POSTING_MESSAGE,
      jobId: 97127,
      companySlug: "ruma-care"
    },
    async () => {
      return {
        ok: false,
        status: 503,
        text: async () => ""
      };
    }
  );

  assert.deepEqual(response, {
    ok: false,
    message: "HTTP 503"
  });
});
