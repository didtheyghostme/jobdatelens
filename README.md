# JobDateLens

Chrome extension that shows public job posting dates on job pages.

https://github.com/user-attachments/assets/eaa16414-8030-4939-9729-60d1cff5b36a

## Install

1. Download `jobdatelens-v<version>.zip` from the latest GitHub release.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted folder.

## Use

JobDateLens does not watch a site until you explicitly activate it. You can activate it on an individual job or on a careers listing page:

- macOS: press `Command+Shift+E`.
- Other platforms: press `Alt+Shift+E`.
- Or click the JobDateLens toolbar icon.

Chrome shortcuts can be changed at `chrome://extensions/shortcuts`.
If Chrome leaves the JobDateLens shortcut unassigned when the extension is installed, JobDateLens shows a small `!` badge on its toolbar icon and updates the icon title with a shortcut setup hint.
Chrome leaves JobDateLens unassigned rather than letting it overwrite another extension's existing shortcut.
This detects only JobDateLens's own unassigned Chrome extension command. Chrome extensions cannot inspect every system, browser, or user-defined shortcut, and some Chrome or operating system shortcuts may take priority.

After activation, the lens follows the exact website origin in that tab. This includes both SPA navigation and normal full-page loads on the same protocol, hostname, and port. When an SPA changes to another path or query, JobDateLens immediately clears the previous role, company, and dates, shows `Loading…`, and scans the destination. After a normal same-origin page load, it restores the panel and scans as soon as Chrome reports that the destination is complete. Hash-only changes are ignored, and JobDateLens does not poll the URL or use fixed scan delays.

If a clean scan finds no usable public `JobPosting` data, the panel shows **Watching** and **No public job date data found**. The session remains active, so opening another same-origin job will scan automatically. **Check again** performs one fresh scan. A malformed, stale, mismatched, or unavailable data source instead shows the specific failure reason with **Retry** and **Close**. Neither action starts an automatic retry loop.

Close ends the session. Closing the tab, opening a different origin (including another subdomain, protocol, or port), restarting the browser, or reloading/updating the extension also ends it. New tabs never inherit a session. Collapse applies only to the currently displayed job, and navigation expands the next result. Pressing the shortcut or toolbar button again performs a fresh coalesced scan; it does not toggle watching off.

The extension scans the active page for public job date data. Most sites are read locally from `<script type="application/ld+json">` blocks. Greenhouse-backed pages may trigger a public, unauthenticated request to Greenhouse's Job Board API for the current job id so JobDateLens can read `first_published`, `updated_at`, and `application_deadline`. Custom company Greenhouse pages are supported when the page exposes a public Greenhouse board token, such as a `boards.greenhouse.io/embed/job_board/js?for=<board>` script. Custom Ashby pages are supported when the page exposes a public `jobs.ashbyhq.com/<board>/embed` or Ashby job URL and the current URL includes an `ashby_jid` UUID; JobDateLens then reads the public Ashby-hosted job page's `JobPosting` JSON-LD.

JobDateLens does not call a JobDateLens backend or send data to a private service. It uses Chrome's memory-only `storage.session` to remember which tab and exact origin are active while the browser is running and the extension remains loaded. Each record contains only the origin, a random session token, and a navigation generation. It never stores job data, full URLs, or browsing history.

## Public date sources

| Provider/source | Current source | Public date fields shown |
| --- | --- | --- |
| Generic `schema.org JobPosting` | Page JSON-LD | `datePosted`, `validThrough`, `jobStartDate` when present |
| Greenhouse | Public Job Board API | `first_published`, `updated_at`, `application_deadline` |
| Lever | Page JSON-LD, including existing apply-page fallback | Same `schema.org JobPosting` fields |
| Ashby | Page JSON-LD, including embedded public Ashby job-page fallback | Same `schema.org JobPosting` fields |
| YC / Work at a Startup | Derived YC job page JSON-LD fallback | Same `schema.org JobPosting` fields |

Many job sites publish machine-readable dates using the [Schema.org `JobPosting`](https://schema.org/JobPosting) format. Google uses the same format for its [job posting search features](https://developers.google.com/search/docs/appearance/structured-data/job-posting). JobDateLens reads the available dates directly from the page.

Only public job-page or public job-board API fields are used. Authenticated employer APIs such as Greenhouse Harvest or private Ashby APIs are out of scope.

## Test

Run the automated tests with Node:

```sh
npm test
```

The suite covers parsing, provider fallbacks, SPA and full-page same-origin navigation, memory-only tab sessions, exact-origin termination, stale JSON-LD rejection, rapid-navigation cancellation, neutral no-data behavior, Retry, Check again, Close, loading accessibility, reduced-motion styling, and badge layout. Parser cases include standard JSON-LD, arrays, `@graph`, multiple candidates, missing or invalid dates, expired postings, malformed JSON, and non-job structured data.

For manual UI testing, select this repository folder in Chrome's **Load unpacked** dialog, activate JobDateLens on a careers listing or job posting, and use the site's own links to navigate between postings. Verify both SPA changes and a normal same-origin reload, then confirm that a new tab does not inherit the lens and a cross-origin navigation ends the session.

## Package a release

`manifest.json` is the only source of truth for the extension version. Before a release, update its `version` field using [Chrome's extension version format](https://developer.chrome.com/docs/extensions/reference/manifest/version).

Create the release ZIP on macOS or Linux:

```sh
npm run package:extension
```

The command runs the full test suite, reads `manifest.json.version` directly, and then recreates `dist/jobdatelens-v<version>.zip`. It does not change `manifest.json`. The ZIP contains only the four runtime files at its root: `manifest.json`, `background.js`, `content.js`, and `content.css`.

Create a GitHub Release with the tag `v<version>` and manually attach that ZIP.
