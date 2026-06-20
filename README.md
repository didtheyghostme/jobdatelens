# JobDateLens

Chrome extension that shows public job posting dates on job pages.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Use

JobDateLens does not scan every page automatically. It checks the current page only when you trigger it:

- macOS: press `Command+Shift+E`.
- Other platforms: press `Alt+Shift+E`.
- Or click the JobDateLens toolbar icon.

Chrome shortcuts can be changed at `chrome://extensions/shortcuts`.
If Chrome leaves the JobDateLens shortcut unassigned when the extension is installed, JobDateLens shows a small `!` badge on its toolbar icon and updates the icon title with a shortcut setup hint.
Chrome leaves JobDateLens unassigned rather than letting it overwrite another extension's existing shortcut.
This detects only JobDateLens's own unassigned Chrome extension command. Chrome extensions cannot inspect every system, browser, or user-defined shortcut, and some Chrome or operating system shortcuts may take priority.

The extension scans the active page for public job date data. Most sites are read locally from `<script type="application/ld+json">` blocks. Greenhouse-backed pages may trigger a public, unauthenticated request to Greenhouse's Job Board API for the current job id so JobDateLens can read `first_published`, `updated_at`, and `application_deadline`. Custom company Greenhouse pages are supported when the page exposes a public Greenhouse board token, such as a `boards.greenhouse.io/embed/job_board/js?for=<board>` script.

JobDateLens does not call a JobDateLens backend, send data to a private service, or request storage permissions.

## Public date sources

| Provider/source | Current source | Public date fields shown |
| --- | --- | --- |
| Generic `schema.org JobPosting` | Page JSON-LD | `datePosted`, `validThrough`, `jobStartDate` when present |
| Greenhouse | Public Job Board API | `first_published`, `updated_at`, `application_deadline` |
| Lever | Page JSON-LD, including existing apply-page fallback | Same `schema.org JobPosting` fields |
| Ashby | Page JSON-LD | Same `schema.org JobPosting` fields |
| YC / Work at a Startup | Derived YC job page JSON-LD fallback | Same `schema.org JobPosting` fields |

Only public job-page or public job-board API fields are used. Authenticated employer APIs such as Greenhouse Harvest are out of scope.

## Test

Run the parser tests with Node:

```sh
npm test
```

The tests use inline JSON-LD samples and cover standard JSON-LD, arrays, `@graph`, multiple candidates, missing or invalid dates, expired postings, malformed JSON, and non-job structured data.

For manual UI testing, load the extension unpacked in Chrome and visit a real job posting page that includes `JobPosting` JSON-LD.
