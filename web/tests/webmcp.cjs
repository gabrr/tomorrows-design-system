/* Disposable-data browser regression. Native WebMCP is tested only when this browser exposes the consumer API. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const base = process.env.TDS_UI_URL;
  if (!base) throw Error("Set TDS_UI_URL to a disposable backend");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const menu = async (name) => {
    await button("Workspace menu").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  try {
    await page.goto(base);
    await page.locator("[data-node-id]").first().waitFor();
    await menu("Review architecture JSON");
    const field = page.getByRole("textbox", {
        name: "Architecture JSON",
        exact: true,
      }),
      proposal = JSON.parse(await field.inputValue());
    for (const id of ["app_a", "app_b"])
      proposal.nodes.find((n) => n.id === id).config.capacity_rps = 300;
    await field.fill(JSON.stringify(proposal));
    await button("Validate and review architecture").click();
    await page
      .getByRole("dialog", { name: "Review architecture changes", exact: true })
      .waitFor();
    assert.match(
      await page
        .getByRole("list", { name: "Reviewed architecture changes" })
        .innerText(),
      /App A/,
    );
    assert.match(
      await page
        .getByRole("list", { name: "Reviewed architecture changes" })
        .innerText(),
      /App B/,
    );
    assert.equal(
      await page
        .locator('[data-node-id="app_a"]')
        .innerText()
        .then((t) => t.includes("Capacity 100/s")),
      true,
    );
    await button("Apply reviewed architecture").click();
    assert.match(
      await page.locator('[data-node-id="app_a"]').innerText(),
      /Capacity 300\/s/,
    );
    assert.match(
      await page.locator('[data-node-id="app_b"]').innerText(),
      /Capacity 300\/s/,
    );
    await button("Undo design edit").click();
    assert.match(
      await page.locator('[data-node-id="app_a"]').innerText(),
      /Capacity 100\/s/,
    );
    assert.match(
      await page.locator('[data-node-id="app_b"]').innerText(),
      /Capacity 100\/s/,
    );
    // Use the actual card buttons and controls, with one undo per group action.
    const node = (id) =>
      page.locator(`[data-node-id="${id}"]`).getByRole("button");
    await node("app_a").click();
    await node("app_b").click({ modifiers: ["Shift"] });
    await page
      .getByRole("heading", { name: "2 components", exact: true })
      .waitFor();
    const capacity = page.getByRole("spinbutton", {
      name: "Capacity · requests / second",
      exact: true,
    });
    await capacity.fill("250");
    await capacity.press("Tab");
    await button("Apply to 2 components").click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-node-id="app_a"]')
        .textContent.includes("Capacity 250/s"),
    );
    assert.match(
      await page.locator('[data-node-id="app_b"]').innerText(),
      /Capacity 250\/s/,
    );
    assert.match(
      await page.locator('[data-node-id="balancer"]').innerText(),
      /Capacity 100\/s/,
    );
    await button("Duplicate selection").click();
    assert.equal(await page.locator("[data-node-id]").count(), 5);
    await button("Delete selection").click();
    assert.equal(await page.locator("[data-node-id]").count(), 3);
    await button("Undo design edit").click();
    assert.equal(await page.locator("[data-node-id]").count(), 5);
    await button("Undo design edit").click();
    assert.equal(await page.locator("[data-node-id]").count(), 3);
    await button("Undo design edit").click();
    assert.match(
      await page.locator('[data-node-id="app_a"]').innerText(),
      /Capacity 100\/s/,
    );
    await node("app_a").click();
    await button("Connect from App A").click();
    await button("Connect from App A").press("Escape");
    assert.equal(await button("Connection App A to App B").count(), 0);
    await button("Connect from App A").press("Enter");
    await button("Connect into App B").press("Enter");
    await button("Connection App A to App B").waitFor();
    await button("Undo design edit").click();
    assert.equal(await button("Connection App A to App B").count(), 0);
    console.log(
      "PASS direct multi-selection, batch edit, group duplicate/delete/undo and keyboard connection",
    );
    const native = await page.evaluate(() => {
      const context = document.modelContext || navigator.modelContext;
      return !!(
        context &&
        typeof context.getTools === "function" &&
        typeof context.executeTool === "function"
      );
    });
    if (native) {
      const result = await page.evaluate(async () => {
        const context = document.modelContext || navigator.modelContext;
        const tools = await context.getTools();
        const tool = tools.find((t) => t.name === "tds_inspect_workspace");
        if (!tool) throw Error("Native workspace inspection tool missing");
        const data = await context.executeTool(tool, {});
        const response = typeof data === "string" ? JSON.parse(data) : data;
        return {
          count: tools.filter((t) => t.name.startsWith("tds_")).length,
          reading: JSON.parse(response.content[0].text),
        };
      });
      assert.equal(result.count, 15);
      assert.equal(result.reading.ok, true);
      assert.ok(result.reading.result.pendingReview === null);
      console.log("PASS native browser WebMCP registration and inspection");
    } else
      console.log(
        "UNVERIFIED native consumer path: browser does not expose getTools/executeTool; shared UI review still tested",
      );
    await menu("Agent tools and activity");
    await page
      .getByRole("dialog", { name: "Agent tools and activity", exact: true })
      .waitFor();
    const table = page.getByRole("table", {
      name: "Recent agent actions",
      exact: true,
    });
    const bounds = await table.evaluate((el) => {
      const a = el.getBoundingClientRect(),
        b = el.closest(".data-grid").getBoundingClientRect();
      return {
        top: a.top,
        parentTop: b.top,
        height: a.height,
        parentHeight: b.height,
      };
    });
    assert.ok(bounds.top >= bounds.parentTop - 1);
    assert.ok(bounds.parentHeight >= bounds.height - 1);
    await page.screenshot({ path: "/tmp/tds-webmcp-activity.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS shared multi-element review/apply/undo and visible non-clipped activity table",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
