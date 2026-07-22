const assert = require("node:assert/strict");
const test = require("node:test");

const background = require("../background.js");

function createSessionChrome(tabs) {
  const values = {};
  const tabValues = new Map(
    (tabs || []).map((tab) => [tab.id, Object.assign({}, tab)])
  );

  return {
    storage: {
      session: {
        async get(key) {
          return Object.prototype.hasOwnProperty.call(values, key)
            ? { [key]: values[key] }
            : {};
        },
        async set(items) {
          Object.assign(values, items);
        },
        async remove(key) {
          delete values[key];
        }
      }
    },
    tabs: {
      async get(tabId) {
        const tab = tabValues.get(tabId);

        if (!tab) {
          throw new Error("No tab");
        }
        return Object.assign({}, tab);
      }
    },
    setTab(tab) {
      tabValues.set(tab.id, Object.assign({}, tab));
    },
    values
  };
}

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

test("canonicalizes only supported Ashby job posting URLs", () => {
  const jobId = "0cd9781c-e158-4b0c-9979-04ead270933a";
  const canonicalUrl = `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}?embed=js`;

  assert.equal(
    background.getCanonicalAshbyJobPostingUrl(
      `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}`
    ),
    canonicalUrl
  );
  assert.equal(
    background.getCanonicalAshbyJobPostingUrl(`${canonicalUrl}&utm_source=test`),
    canonicalUrl
  );
  assert.equal(
    background.getCanonicalAshbyJobPostingUrl(
      `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/embed?version=2`
    ),
    null
  );
  assert.equal(
    background.getCanonicalAshbyJobPostingUrl(
      `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/not-a-uuid`
    ),
    null
  );
  assert.equal(
    background.getCanonicalAshbyJobPostingUrl(
      `https://jobs.ashbyhq.com.evil.com/8090%20Solutions%20Inc/${jobId}`
    ),
    null
  );
  assert.equal(
    background.getCanonicalAshbyJobPostingUrl(
      `http://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}`
    ),
    null
  );
});

test("fetches validated Ashby job HTML through the background handler", async () => {
  const jobId = "0cd9781c-e158-4b0c-9979-04ead270933a";
  const jobUrl = `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}?embed=js`;
  let fetchedUrl = "";
  let fetchOptions = null;

  const response = await background.handleFetchAshbyJobPostingMessage(
    {
      type: background.FETCH_ASHBY_JOB_POSTING_MESSAGE,
      jobUrl: `${jobUrl}&ignored=1`
    },
    async (url, options) => {
      fetchedUrl = url;
      fetchOptions = options;
      return {
        ok: true,
        text: async () => "<!doctype html><script></script>"
      };
    }
  );

  assert.equal(fetchedUrl, jobUrl);
  assert.deepEqual(fetchOptions, {
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: background.HTML_ACCEPT_HEADER
    }
  });
  assert.deepEqual(response, {
    ok: true,
    htmlText: "<!doctype html><script></script>",
    url: jobUrl
  });
});

test("rejects unsupported Ashby lookup URLs without fetching", async () => {
  let fetchCalled = false;
  const response = await background.handleFetchAshbyJobPostingMessage(
    {
      type: background.FETCH_ASHBY_JOB_POSTING_MESSAGE,
      jobUrl: "https://example.com/8090/0cd9781c-e158-4b0c-9979-04ead270933a"
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
    message: "Unsupported Ashby job lookup."
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

test("manual activation stores a minimal tab session before scanning a no-data page", async () => {
  const tab = {
    id: 17,
    status: "complete",
    url: "https://careers.example.com/jobs?team=eng"
  };
  const chromeApi = createSessionChrome([tab]);
  const scans = [];
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "session-17",
    scanTab: async (scannedTab) => {
      scans.push(scannedTab.url);
      return { found: false, reason: "html-no-match" };
    }
  });

  const result = await controller.activate(tab);
  const key = background.getSessionStorageKey(tab.id);

  assert.equal(result.found, false);
  assert.deepEqual(scans, [tab.url]);
  assert.deepEqual(chromeApi.values[key], {
    origin: "https://careers.example.com",
    sessionToken: "session-17",
    navigationGeneration: 0
  });
  assert.deepEqual(Object.keys(chromeApi.values[key]).sort(), [
    "navigationGeneration",
    "origin",
    "sessionToken"
  ]);
});

test("repeated manual activation keeps the session token but performs a fresh scan", async () => {
  const tab = {
    id: 19,
    status: "complete",
    url: "https://careers.example.com/jobs/one"
  };
  const chromeApi = createSessionChrome([tab]);
  let tokenCalls = 0;
  let scanCalls = 0;
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => `token-${++tokenCalls}`,
    scanTab: async () => {
      scanCalls += 1;
      return { found: true };
    }
  });

  await controller.activate(tab);
  await controller.activate(tab);

  assert.equal(tokenCalls, 1);
  assert.equal(scanCalls, 2);
  assert.equal(
    chromeApi.values[background.getSessionStorageKey(tab.id)].sessionToken,
    "token-1"
  );
});

test("failed content injection clears the newly started session", async () => {
  const tab = {
    id: 21,
    status: "complete",
    url: "https://careers.example.com/jobs"
  };
  const chromeApi = createSessionChrome([tab]);
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "failed-token",
    logger: { warn() {} },
    scanTab: async () => {
      throw new Error("Cannot access contents of the page");
    }
  });

  assert.equal(await controller.activate(tab), null);
  assert.equal(chromeApi.values[background.getSessionStorageKey(tab.id)], undefined);
});

test("a recreated worker follows same-origin full loads from storage.session", async () => {
  const tabId = 23;
  const startTab = {
    id: tabId,
    status: "complete",
    url: "https://jobs.example.com/openings"
  };
  const chromeApi = createSessionChrome([startTab]);
  const firstController = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "persisted-token",
    scanTab: async () => ({ found: false })
  });

  await firstController.activate(startTab);

  const scans = [];
  const restartedController = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "unused-token",
    scanTab: async (tab) => {
      scans.push(tab.url);
      return { found: true };
    }
  });
  const loadingTab = {
    id: tabId,
    status: "loading",
    url: "https://jobs.example.com/openings/platform"
  };
  chromeApi.setTab(loadingTab);
  await restartedController.handleTabUpdated(tabId, { status: "loading" }, loadingTab);

  const completeTab = Object.assign({}, loadingTab, { status: "complete" });
  chromeApi.setTab(completeTab);
  await restartedController.handleTabUpdated(tabId, { status: "complete" }, completeTab);

  assert.deepEqual(scans, [completeTab.url]);
  assert.equal(
    chromeApi.values[background.getSessionStorageKey(tabId)].navigationGeneration,
    1
  );
});

test("same-origin reloads scan once per generation and duplicate completes coalesce", async () => {
  const tab = {
    id: 29,
    status: "complete",
    url: "https://jobs.example.com/roles/one"
  };
  const chromeApi = createSessionChrome([tab]);
  let scanCount = 0;
  let releaseScan;
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "reload-token",
    scanTab: async () => {
      scanCount += 1;
      await new Promise((resolve) => {
        releaseScan = resolve;
      });
      return { found: true };
    }
  });

  const activation = controller.activate(tab);
  await new Promise((resolve) => setImmediate(resolve));
  releaseScan();
  await activation;

  const loadingTab = Object.assign({}, tab, { status: "loading" });
  chromeApi.setTab(loadingTab);
  await controller.handleTabUpdated(tab.id, { status: "loading" }, loadingTab);
  chromeApi.setTab(tab);

  const firstComplete = controller.handleTabUpdated(
    tab.id,
    { status: "complete" },
    tab
  );
  const duplicateComplete = controller.handleTabUpdated(
    tab.id,
    { status: "complete" },
    tab
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(scanCount, 2);
  releaseScan();
  await Promise.all([firstComplete, duplicateComplete]);

  await controller.handleTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(scanCount, 2);
});

test("origin changes, tab close, and sender-tab Close clear only that tab session", async () => {
  const firstTab = {
    id: 31,
    status: "complete",
    url: "https://jobs.example.com/one"
  };
  const secondTab = {
    id: 32,
    status: "complete",
    url: "https://jobs.example.com/two"
  };
  const chromeApi = createSessionChrome([firstTab, secondTab]);
  let token = 0;
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => `token-${++token}`,
    scanTab: async () => ({ found: false })
  });

  await controller.activate(firstTab);
  await controller.activate(secondTab);

  const crossOriginTab = Object.assign({}, firstTab, {
    status: "loading",
    url: "https://apply.example.net/one"
  });
  chromeApi.setTab(crossOriginTab);
  await controller.handleTabUpdated(
    firstTab.id,
    { status: "loading", url: crossOriginTab.url },
    crossOriginTab
  );
  assert.equal(chromeApi.values[background.getSessionStorageKey(firstTab.id)], undefined);
  assert.ok(chromeApi.values[background.getSessionStorageKey(secondTab.id)]);

  assert.equal(await controller.stopFromSender({}), false);
  assert.equal(await controller.stopFromSender({ tab: { id: secondTab.id } }), true);
  assert.equal(chromeApi.values[background.getSessionStorageKey(secondTab.id)], undefined);

  await controller.activate(secondTab);
  await controller.handleTabRemoved(secondTab.id);
  assert.equal(chromeApi.values[background.getSessionStorageKey(secondTab.id)], undefined);
});

test("protocol, hostname, subdomain, and port are exact origin boundaries", async () => {
  const destinations = [
    "http://jobs.example.com/one",
    "https://www.jobs.example.com/one",
    "https://apply.example.com/one",
    "https://jobs.example.com:8443/one"
  ];

  for (let index = 0; index < destinations.length; index += 1) {
    const tab = {
      id: 40 + index,
      status: "complete",
      url: "https://jobs.example.com/one"
    };
    const chromeApi = createSessionChrome([tab]);
    const controller = background.createSameOriginSessionController(chromeApi, {
      createToken: () => `origin-token-${index}`,
      scanTab: async () => ({ found: true })
    });

    await controller.activate(tab);
    const destinationTab = Object.assign({}, tab, {
      status: "loading",
      url: destinations[index]
    });
    chromeApi.setTab(destinationTab);
    await controller.handleTabUpdated(
      tab.id,
      { status: "loading", url: destinationTab.url },
      destinationTab
    );

    assert.equal(
      chromeApi.values[background.getSessionStorageKey(tab.id)],
      undefined,
      destinations[index]
    );
  }
});

test("an untracked new tab never inherits another tab's session", async () => {
  const trackedTab = {
    id: 51,
    status: "complete",
    url: "https://jobs.example.com/one"
  };
  const newTab = {
    id: 52,
    status: "complete",
    url: "https://jobs.example.com/two"
  };
  const chromeApi = createSessionChrome([trackedTab, newTab]);
  const scans = [];
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "tab-token",
    scanTab: async (tab) => {
      scans.push(tab.id);
      return { found: true };
    }
  });

  await controller.activate(trackedTab);
  scans.length = 0;
  await controller.handleTabUpdated(newTab.id, { status: "complete" }, newTab);

  assert.deepEqual(scans, []);
  assert.equal(chromeApi.values[background.getSessionStorageKey(newTab.id)], undefined);
  assert.ok(chromeApi.values[background.getSessionStorageKey(trackedTab.id)]);
});

test("late full-page work cannot scan a superseded same-origin destination", async () => {
  const tabId = 37;
  const tabA = {
    id: tabId,
    status: "complete",
    url: "https://jobs.example.com/a"
  };
  const chromeApi = createSessionChrome([tabA]);
  const scans = [];
  const controller = background.createSameOriginSessionController(chromeApi, {
    createToken: () => "rapid-token",
    scanTab: async (tab) => {
      scans.push(tab.url);
      return { found: true };
    }
  });

  await controller.activate(tabA);
  scans.length = 0;

  const tabBLoading = {
    id: tabId,
    status: "loading",
    url: "https://jobs.example.com/b"
  };
  chromeApi.setTab(tabBLoading);
  await controller.handleTabUpdated(tabId, { status: "loading" }, tabBLoading);

  const tabBComplete = Object.assign({}, tabBLoading, { status: "complete" });
  chromeApi.setTab(tabBComplete);
  const bCompletion = controller.handleTabUpdated(
    tabId,
    { status: "complete" },
    tabBComplete
  );

  const tabCLoading = {
    id: tabId,
    status: "loading",
    url: "https://jobs.example.com/c"
  };
  chromeApi.setTab(tabCLoading);
  await controller.handleTabUpdated(tabId, { status: "loading" }, tabCLoading);
  const tabCComplete = Object.assign({}, tabCLoading, { status: "complete" });
  chromeApi.setTab(tabCComplete);
  await controller.handleTabUpdated(tabId, { status: "complete" }, tabCComplete);
  await bCompletion;

  assert.deepEqual(scans, [tabCComplete.url]);
});
