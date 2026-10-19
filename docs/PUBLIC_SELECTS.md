# Public dropdowns

`assets/public-select.js` enhances single-choice native selects only inside an
explicit `body[data-public-selects]` boundary. The Contact topic field opts in;
account and member screens do not load this public adapter. Load its stylesheet
and deferred script after the public icon runtime. Native field identity,
options, values, validation and form submission remain authoritative. Without
JavaScript the original field remains available.

Menus use the shared Huge chevron/check symbols and support keyboard selection,
Escape, outside dismissal and native form reset. Lists with more than 18 options
are searchable, or search can be enabled with `data-public-select-search`.
Search includes option labels and exact native values, with exact codes ranked
first. Styling uses the `--sl-select-*` variables so each public product can
match its existing surfaces without changing form clients.

## Regression checks

Final review passes against the shared module: 11 pure Node harness tests and 12
real Chromium fixture scenarios. The browser fixture uses a strict self-only
script/style CSP and produces no browser or CSP errors.

The files under `tests/` are:

- `public-select.test.mjs`: the existing member-control harness adapted to the
  public scope, plus search/code priority, IME, search Tab, first-invalid focus,
  dynamic labels and explicit native-option mutation refresh regressions.
- `public-select.browser.mjs`: a self-contained local HTTP fixture and optional
  Playwright runner for real native selection/FormData, label activation, search,
  keyboard tab order, popup scrolling, CSP and JavaScript-disabled fallback.

The default source path is `../assets/public-select.js` from the test file.
`PUBLIC_SELECT_SOURCE` can override that path for a pure Node test run.

```sh
node --test tests/public-select.test.mjs
```

The browser runner defaults to a sibling `../assets/` directory, installed local
Playwright and its bundled Chromium. Its optional arguments are an asset
directory, a node_modules directory, a Chromium executable and an icon-runtime
file, in that order. No browser UI tab or remote service is needed.

```sh
node tests/public-select.browser.mjs
node tests/public-select.browser.mjs path/to/assets path/to/node_modules path/to/chrome path/to/icons.js
```

The fixture only binds a random loopback port and closes its browser/server on
completion. It prints a JSON report and exits nonzero for any scenario, browser
or CSP failure. It writes a report only if `PUBLIC_SELECT_AUDIT_REPORT` names an
explicit output file. An absent optional icon runtime tests the component's SVG
fallback instead.

Direct batches that set native `option.selected` without dispatching a native
event should call `SautiPublicSelects.refresh()` once afterward. Native submitted
values remain authoritative; the explicit refresh updates display without
inventing input/change events or patching option prototypes.
