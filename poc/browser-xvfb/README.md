# Browser worker feasibility POC — headed Chrome on Linux under Xvfb

Isolated experiment, not part of the app. Delete this folder to remove it.
Nothing here is wired into MARKO, and `npm test` never runs it (the probe is
named `*.poc.ts`).

**Question:** can MARKO's ChatGPT Browser provider run as *headed* Google
Chrome (`headless: false`) on a Linux server with an Xvfb virtual display,
behaving like the visible Chrome that works on macOS, but with no window on
any user's screen?

**What runs:** `chatgpt-probe.poc.ts` asks one real question through the
unmodified provider (`src/lib/aiVisibility/providers/chatgptBrowser.ts`).
It reports status, time, answer and source counts, and peak memory of the
Playwright-launched Chrome processes. There is no stealth, no fingerprint or
`navigator.webdriver` changes, and no CAPTCHA or Cloudflare handling.

## Results so far (2026-10-01, measured)

| Mode | Environment | Result | Time | Peak Chrome RSS |
|---|---|---|---|---|
| A | macOS arm64, headed Chrome (visible window) | completed: 3,363-char answer, 5 unique sources | 16 s | ~1.2 GB |
| B | macOS arm64, headless Chrome | failed: Cloudflare verification | 31 s (timeout) | ~1.4 GB |
| C | Linux x86-64 + Xvfb, headed Chrome | **not yet run**: no Linux/Docker available on the dev Mac | — | — |

A full four-provider Browser run for one question (macOS, measured) took
33 s wall time, with summed Chrome RSS peaking at about 5.6 GB (an
overestimate, since RSS double-counts shared memory) and summed CPU peaking
at about 5.6 cores.

## Running mode C

Requires an x86-64 Linux host or Docker (Google Chrome has no Linux arm64
build). From the repository root:

```bash
docker build --platform linux/amd64 -f poc/browser-xvfb/Dockerfile -t marko-browser-poc .
# C: headed Chrome on a virtual display (the proposal)
docker run --rm --platform linux/amd64 --shm-size=1g marko-browser-poc
# B on Linux, for comparison
docker run --rm --platform linux/amd64 --shm-size=1g -e CHATGPT_BROWSER_HEADLESS=true \
  -e POC_MODE=B-linux-headless marko-browser-poc npx vitest run --config poc/browser-xvfb/vitest.config.mts
```

Without Docker, on an Ubuntu x86-64 VM: install Node 20+,
`npx playwright install --with-deps chrome`, `apt-get install xvfb`,
`npm ci`, then
`xvfb-run -a --server-args="-screen 0 1280x900x24" npx vitest run --config poc/browser-xvfb/vitest.config.mts`.

Each run prints one `POC_RESULT {...}` line. Run each mode once or twice
only; this probes behavior, it is not load testing.

**Note:** the Docker/VM IP is a data-center address. If ChatGPT blocks mode
C, that may be due to the IP's reputation, the display mode, or both. A
truthful failure is a valid outcome, and it is not something to work around.
