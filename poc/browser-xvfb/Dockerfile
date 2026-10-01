# Browser-worker feasibility POC: real headed Google Chrome on Linux under Xvfb.
# Build from the repository root (x86-64 only — Google Chrome has no Linux arm64 build):
#   docker build --platform linux/amd64 -f poc/browser-xvfb/Dockerfile -t marko-browser-poc .
# Mode C (headed Chrome on a virtual display — the proposal):
#   docker run --rm --platform linux/amd64 --shm-size=1g marko-browser-poc
# Mode B (headless, for comparison):
#   docker run --rm --platform linux/amd64 --shm-size=1g -e CHATGPT_BROWSER_HEADLESS=true -e POC_MODE=B-linux-headless marko-browser-poc npx vitest run --config poc/browser-xvfb/vitest.config.mts
# Official Playwright image: Node, browser system deps and xvfb preinstalled.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
# Branded Google Chrome (MARKO's providers launch channel "chrome", not bundled Chromium).
RUN npx -y playwright@1.63.0 install --with-deps chrome
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY poc/browser-xvfb ./poc/browser-xvfb
ENV POC_MODE=C-linux-xvfb-headed
# xvfb-run provides DISPLAY; Chrome runs headed (CHATGPT_BROWSER_HEADLESS unset) and draws to the virtual screen.
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x900x24", "npx", "vitest", "run", "--config", "poc/browser-xvfb/vitest.config.mts"]
