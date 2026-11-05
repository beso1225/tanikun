/**
 * Browser actions and API route gates shared by the sync journeys.
 *
 * `installApiGate` resolves only after the route handler is registered. Callers
 * may then change `offline` before the next request, so readiness never depends
 * on an extra wait or on the order in which a route was installed.
 */
export const apiGlob = "**/api/v1/**";

export async function installApiGate(page) {
  const gate = { offline: false };
  await page.route(apiGlob, async (route) => {
    if (gate.offline) await route.abort("failed");
    else await route.continue();
  });
  return gate;
}

export async function addOffering(page, offeringId) {
  await page.locator("#open-catalogue-picker").click();
  await page.locator(`#add-offering-${offeringId}`).click();
  await page.locator("#close-picker").click();
}

export async function addCustomCourse(page, name) {
  await page.locator("#open-catalogue-picker").click();
  await page.locator("#open-custom-course").click();
  await page.locator("#custom-name").fill(name);
  await page.locator("#custom-category").selectOption("lab");
  await page.locator("#custom-submit").click();
  await page.locator("#close-picker").click();
}
