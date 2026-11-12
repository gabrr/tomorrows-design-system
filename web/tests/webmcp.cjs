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
    const review = page.getByRole("dialog", {
      name: "Review architecture changes",
      exact: true,
    });
    await review.waitFor();
    // Native and AI reviews share the accessible Changes summary. Check the
    // actual before/proposed values, not the removed implementation-specific list.
    const summary = await review
      .getByLabel("Proposed change summary", { exact: true })
      .innerText();
    assert.match(summary, /App A · Capacity: 100 req\/s → 300 req\/s/);
    assert.match(summary, /App B · Capacity: 100 req\/s → 300 req\/s/);
    await review.getByRole("button", { name: /Complete diff/ }).waitFor();
    assert.equal(
      await page
        .locator('[data-node-id="app_a"]')
        .innerText()
        .then((t) => t.includes("Capacity 100/s")),
      true,
    );
    assert.match(
      await page.locator('[data-node-id="app_b"]').innerText(),
      /Capacity 100\/s/,
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
    // Click the visible Astryx pressable card, not its hidden keyboard proxy.
    // Keep native pointer dispatch and hit testing; do not force/bypass overlays.
    const node = (id) => page.locator(`[data-node-id="${id}"]`);
    await node("app_a").click();
    await node("app_b").click({ modifiers: ["Shift"] });
    await page
      .getByRole("heading", { name: "2 components", exact: true })
      .waitFor();
    const capacity = page.getByLabel("Capacity · requests / second", {
      exact: true,
    });
    // Keep focus in the raw draft: the first pointer click must apply, not
    // merely blur/commit the field and move a previously disabled button.
    await capacity.fill("");
    await capacity.pressSequentially("250");
    assert.equal(await button("Apply to 2 components").isEnabled(), true);
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
    // Hidden/closed selector layers must not swallow the inspector's Escape.
    // An invalid raw draft survives closing without changing either component.
    const groupHeading = page.getByRole("heading", {
      name: "2 components",
      exact: true,
    });
    await capacity.fill("");
    await capacity.pressSequentially("1e");
    assert.equal(await capacity.inputValue(), "1e");
    assert.equal(await button("Apply to 2 components").isEnabled(), false);
    await capacity.press("Escape");
    await groupHeading.waitFor({ state: "hidden" });
    await button("Inspector").click();
    await groupHeading.waitFor();
    assert.equal(await capacity.inputValue(), "1e");
    await page.getByText("Pending Capacity rps: 1e", { exact: true }).waitFor();
    assert.equal(await button("Apply to 2 components").isEnabled(), false);
    for (const id of ["app_a", "app_b"])
      assert.match(await node(id).innerText(), /Capacity 250\/s/);
    await button("Reset group edit").click();
    assert.equal(await capacity.inputValue(), "250");
    // A genuinely open popup owns the first Escape; only the second closes
    // the inspector after the popup has finished dismissing.
    await page
      .getByRole("combobox", { name: "Shared property", exact: true })
      .click();
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    assert.equal(await groupHeading.isVisible(), true);
    await page.keyboard.press("Escape");
    await groupHeading.waitFor({ state: "hidden" });
    await button("Inspector").click();
    await groupHeading.waitFor();
    assert.equal(await capacity.inputValue(), "250");
    console.log(
      "PASS invalid raw draft Escape/recovery/reset and active popup Escape ownership",
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
    // A focused graph card has a nested native button. Its telemetry hint must
    // open for keyboard users, consume only the first Escape, and leave the
    // second Escape available to close Inspector. No model/tool state injection.
    const hints = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      reducedMotion: "reduce",
    });
    hints.on("pageerror", (e) => errors.push(e.message));
    try {
      await hints.goto(base);
      const appA = hints.locator('[data-node-id="app_a"]');
      await appA.waitFor();
      await hints
        .getByRole("button", { name: "Run simulation", exact: true })
        .click();
      const time = hints.getByRole("spinbutton", {
        name: "Selected simulated time · seconds",
        exact: true,
      });
      await time.fill("25");
      await time.press("Tab");
      await appA.click();
      const inspector = hints.getByRole("heading", {
        name: "Component",
        exact: true,
      });
      await inspector.waitFor();
      await hints.mouse.move(1080, 450);
      await hints.locator("#canvas").press("Tab");
      let cardFocused = false;
      for (let step = 0; step < 30; step++) {
        cardFocused = await hints.evaluate(
          () =>
            document.activeElement
              ?.closest("[data-node-id]")
              ?.getAttribute("data-node-id") === "app_a",
        );
        if (cardFocused) break;
        await hints.keyboard.press("Tab");
      }
      assert.equal(cardFocused, true, "Tab reaches App A's native card button");
      const tooltipId = await appA.getAttribute("aria-describedby");
      assert.ok(tooltipId, "App A owns a telemetry description");
      const tooltip = hints.locator(`[id="${tooltipId}"]`);
      // Rapid Tab can leave earlier hints visible during their queued close.
      // Wait for focus ownership to settle, not an arbitrary sleep or a broad
      // role lookup that may match other controls' transient hints.
      await hints.waitForFunction((id) => {
        const visible = [
          ...document.querySelectorAll('[role="tooltip"]'),
        ].filter(
          (el) =>
            el.getClientRects().length > 0 &&
            getComputedStyle(el).visibility !== "hidden",
        );
        return visible.length === 1 && visible[0].id === id;
      }, tooltipId);
      await tooltip.waitFor({ state: "visible" });
      assert.match(
        await tooltip.innerText(),
        /Arrivals include rejected calls/,
      );
      await hints.keyboard.press("Escape");
      await tooltip.waitFor({ state: "hidden" });
      await hints.waitForFunction(() =>
        [...document.querySelectorAll('[role="tooltip"]')].every(
          (el) =>
            el.getClientRects().length === 0 ||
            getComputedStyle(el).visibility === "hidden",
        ),
      );
      assert.equal(await inspector.isVisible(), true);
      assert.equal(
        await hints.evaluate(
          () =>
            document.activeElement
              ?.closest("[data-node-id]")
              ?.getAttribute("data-node-id") === "app_a",
        ),
        true,
        "Dismissing a hint retains card focus",
      );
      await hints.keyboard.press("Escape");
      await inspector.waitFor({ state: "hidden" });
      console.log(
        "PASS keyboard telemetry and one-layer-at-a-time Escape from canvas",
      );
    } finally {
      await hints.close();
    }
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
