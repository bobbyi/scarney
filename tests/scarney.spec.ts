import { test, expect, type Page } from "@playwright/test";

async function revealedCount(page: Page, boardSelector: string): Promise<number> {
  return page.locator(`${boardSelector} .card:not(.placeholder)`).count();
}

async function placeholderCount(page: Page, boardSelector: string): Promise<number> {
  return page.locator(`${boardSelector} .card.placeholder`).count();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("deals a hand of 5 cards and hides both boards on load", async ({ page }) => {
  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#hand .card.placeholder")).toHaveCount(0);

  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  expect(await revealedCount(page, "#board-a")).toBe(0);
  expect(await revealedCount(page, "#board-b")).toBe(0);

  await expect(page.locator("#next-button")).toBeEnabled();
});

test("Next Round reveals one card on each board per click", async ({ page }) => {
  await page.locator("#next-button").click();

  expect(await revealedCount(page, "#board-a")).toBe(1);
  expect(await revealedCount(page, "#board-b")).toBe(1);
  expect(await placeholderCount(page, "#board-a")).toBe(4);
  expect(await placeholderCount(page, "#board-b")).toBe(4);

  await page.locator("#next-button").click();

  expect(await revealedCount(page, "#board-a")).toBe(2);
  expect(await revealedCount(page, "#board-b")).toBe(2);
});

test("clicking Next Round 5 times fully reveals both boards and disables the button", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }

  expect(await revealedCount(page, "#board-a")).toBe(5);
  expect(await revealedCount(page, "#board-b")).toBe(5);
  expect(await placeholderCount(page, "#board-a")).toBe(0);
  expect(await placeholderCount(page, "#board-b")).toBe(0);

  await expect(page.locator("#next-button")).toBeDisabled();
});

test("Deal Hand resets to a new hand and hides both boards again", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }
  await expect(page.locator("#next-button")).toBeDisabled();

  await page.locator("#deal-button").click();

  await expect(page.locator("#hand .card")).toHaveCount(5);
  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  await expect(page.locator("#next-button")).toBeEnabled();
});
