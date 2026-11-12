/* Astryx browser regression. Run only with a disposable TDS_DATA_DIR backend. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  const base = process.env.TDS_UI_URL;
  if (!base) throw Error("TDS_UI_URL must identify a disposable backend");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  async function menu(name) {
    await button("Workspace menu").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  try {
    await page.goto(base);
    await page.locator("[data-node-id]").first().waitFor();
    await button("Components").click();
    const preset = page.getByRole("combobox", {
      name: "Architecture preset",
      exact: true,
    });
    await preset.click();
    await page.getByRole("listbox", { name: "Architecture preset" }).waitFor();
    assert.ok((await page.getByRole("option").count()) >= 4);
    await preset.press("Escape");
    assert.equal(await preset.getAttribute("aria-expanded"), "false");
    await page
      .getByRole("searchbox", { name: "Search components" })
      .fill("cache");
    const count = await page.locator("[data-node-id]").count();
    await button("Cache").click();
    assert.equal(await page.locator("[data-node-id]").count(), count + 1);
    await button("Undo design edit").click();
    assert.equal(await page.locator("[data-node-id]").count(), count);
    await button("Experiment and results").click();
    await button("Edit events").click();
    await page
      .getByRole("spinbutton", { name: "At second", exact: true })
      .first()
      .fill("16");
    await button("Cancel scenario changes").click();
    await button("Edit events").click();
    assert.equal(
      await page
        .getByRole("spinbutton", { name: "At second", exact: true })
        .first()
        .inputValue(),
      "15",
    );
    await button("Cancel scenario changes").click();
    const host = await button("Run simulation").getAttribute("data-ui-host");
    const nodeHosts = await page
      .locator("[data-node-id]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-ui-host")));
    const response = page.waitForResponse(
      (r) =>
        r.url() === base + "/api/simulate" && r.request().method() === "POST",
    );
    await button("Run simulation").click();
    assert.equal((await response).status(), 200);
    await page.getByRole("slider", { name: "Simulation time" }).waitFor();
    assert.equal(
      await button("Run simulation").getAttribute("data-ui-host"),
      host,
    );
    const time = page.getByRole("spinbutton", {
      name: "Selected simulated time · seconds",
      exact: true,
    });
    await time.fill("25");
    await time.press("Tab");
    await page.locator(".diagram-node.is-down").waitFor();
    assert.deepEqual(
      await page
        .locator("[data-node-id]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-ui-host")),
        ),
      nodeHosts,
    );
    await button("Run simulation").hover();
    assert.equal(
      await button("Run simulation").evaluate(
        (el) => getComputedStyle(el).cursor,
      ),
      "pointer",
    );
    for (const width of [1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const overlaps = await page.evaluate(() => {
        const a = document
            .querySelector(".camera-toolbar")
            .getBoundingClientRect(),
          b = document.querySelector(".playback-dock").getBoundingClientRect();
        return (
          a.right > b.left &&
          a.left < b.right &&
          a.bottom > b.top &&
          a.top < b.bottom
        );
      });
      assert.equal(overlaps, false);
    }
    await button("Pin this run as baseline").click();
    await button("Close experiment details").click();
    await page
      .getByRole("textbox", { name: "Project name", exact: true })
      .fill("Astryx automated QA");
    await button("Save").click();
    await button("Projects").click();
    await page.getByRole("dialog", { name: "Your local projects" }).waitFor();
    await page
      .getByRole("table", { name: "Local saved projects" })
      .waitFor()
      .catch(() => page.getByRole("table").waitFor());
    await button("Close").click();
    await menu("Workspace settings");
    await page
      .getByRole("combobox", { name: "Appearance", exact: true })
      .click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await button("Close").click();
    await page.screenshot({ path: "/tmp/tds-astryx-dark.png" });
    await menu("Measurements and calibration");
    const json = page.getByRole("textbox", {
      name: "Measurement JSON",
      exact: true,
    });
    await json.fill("{bad");
    await button("Review calibration proposal").click();
    await page
      .getByRole("alert")
      .filter({ hasText: /JSON|Unexpected|Expected/ })
      .first()
      .waitFor();
    await json.fill(
      JSON.stringify([
        {
          node_id: "app_a",
          source: "Synthetic browser regression fixture",
          samples_ms: Array(10).fill(20),
        },
      ]),
    );
    await button("Review calibration proposal").click();
    await button("Apply reviewed calibration").waitFor();
    assert.match(
      await page.getByRole("dialog").innerText(),
      /0 ms heldout mean absolute error/,
    );
    await button("Cancel calibration review").click();
    await button("Close").click();
    await menu("Factory status");
    await page
      .getByRole("dialog", { name: "Local factory · read only" })
      .waitFor();
    await button("Close").click();
    const download = page.waitForEvent("download");
    await menu("Export design and evidence");
    const exported = JSON.parse(
      await fs.readFile(await (await download).path(), "utf8"),
    );
    assert.ok(exported._workspace.baseline_run);
    await page
      .getByLabel("Import project JSON", { exact: true })
      .setInputFiles({
        name: "roundtrip.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(exported)),
      });
    await button("Experiment and results").click();
    await page
      .getByRole("tab", { name: "Results & comparison", exact: true })
      .click();
    await page
      .getByText(/Unverified external evidence/)
      .first()
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS Astryx library, controls, stable hosts, scenario cancellation, simulation, desktop geometry, save, theme, calibration, factory and evidence roundtrip",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
