# Scenario engine — Death-workflow walkthrough recording

The pod cannot capture video. This recipe lets a teammate produce the
required 90-second screen recording on their own machine in ~30 minutes.

## What this captures

Per `MOBILE_AGENT_SCENARIO_ENGINE_HANDOFF.md` §10 (Definition of Done) bullet
on the ESCALATE workflow:

> Intro → all steps → contact card — proof that the ESCALATE path renders
> correctly.

The Playwright script at `scripts/scenario-death-walkthrough.spec.ts` drives
the mobile web build through:

1. Login as `cathy@example.com` / `testpass123`
2. Switch active participant (Patricia)
3. Navigate to **More → Guided workflows → Death workflow**
4. Assert the ESCALATE `ContactCard` renders and the tel buttons (sourced
   from `schema.boundaries.contacts`, never hard-coded) are visible
5. Step through every page via the `workflow-death-continue` test ID
6. Hold on the destination Timeline screen so the recorder catches it

## Run it

```bash
# 1. On a teammate's machine (macOS / Linux):
git pull
cd app
yarn add -D @playwright/test
npx playwright install chromium

# 2. Capture the run as MP4 (Playwright records as .webm by default):
WAYLY_PREVIEW=https://aged-care-os.preview.emergentagent.com \
WAYLY_EMAIL=cathy@example.com \
WAYLY_PASS=testpass123 \
npx playwright test scripts/scenario-death-walkthrough.spec.ts \
  --headed --video=on --workers=1

# 3. Convert the result to MP4:
ffmpeg -i test-results/*/video.webm -c:v libx264 -crf 23 \
  -preset slow -pix_fmt yuv420p wayly-death-workflow.mp4
```

Drop the resulting `wayly-death-workflow.mp4` into the PR description
alongside the validation report.

## If the test fails partway

Most failures are pressable-click timing in headless mode. The script uses
`{ force: true }` to suppress overlay interception. If it still fails:

- Increase `await page.waitForTimeout(...)` on the offending step.
- Run with `--ui` to step through visually and re-record once the path is
  proven manually.
- Check that the preview tunnel is alive: `curl -i https://aged-care-os.preview.emergentagent.com/api/scenario/schema` must return 200.

## Why not record on the pod

The pod has no GPU, no display server, and no `ffmpeg`-with-x11 stack. The
existing `mcp_screenshot_tool` produces single JPEGs, which is fine for
acceptance screenshots but cannot stitch a 90-second video.
