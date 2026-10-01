import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

/**
 * S2's own shared click-only helpers (docs/prompts/atlas-prompt-pack.md):
 * "Click-only from Home after sign-in; no page.goto after the first; no
 * URL construction; no seeding beyond org and user." Every golden-path
 * spec drives the real UI from here on — no `commitToBranch`, no
 * `createOrganisation`/`createModel` Node-side calls (unlike
 * `changeBranchFixture.ts`, which exists for the `*.engine.spec.ts`
 * deep-linking specs and seeds a System directly, in violation of this
 * rule).
 *
 * Reading `page.url()` to pull out a slug/id Playwright itself navigated
 * to is not "URL construction" — every existing spec that reaches into a
 * change branch id does the same (e.g. changes-ux-lifecycle.spec.ts's own
 * `branchIdMatch`). Only building a `href` by hand and calling
 * `page.goto` with it is what S2 rules out.
 */

export interface SignedUpUser {
  email: string;
  password: string;
}

export async function signUp(page: Page, prefix: string): Promise<SignedUpUser> {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
  return { email, password };
}

export interface GoldenPathOrgModel {
  orgName: string;
  modelName: string;
  orgSlug: string;
  modelSlug: string;
  /** The signed-up owner's own display name (`ReviewerPicker.tsx`'s member list shows this label) — a caller that needs to pick the owner out of that list by name, rather than by role, needs this since it's otherwise randomised and never surfaced. */
  ownerDisplayName: string;
}

/**
 * Sign up, create an organisation (through the display-name prompt every
 * first-org owner sees), create a model, land on ModelHome — the one
 * click-only path S2's own "no seeding beyond org and user" line allows.
 */
export async function signUpCreateOrgAndModel(page: Page, prefix: string): Promise<GoldenPathOrgModel> {
  await signUp(page, prefix);

  const orgName = `${prefix} Org ${randomUUID().slice(0, 8)}`;
  const modelName = `${prefix} Model ${randomUUID().slice(0, 8)}`;

  // F3a's sign-up shape: a brand-new user with zero orgs is offered "Just
  // me" (a personal org) or "My organisation" (named, with an invite
  // step) — "New organisation" only exists once at least one org already
  // exists (Home.tsx's own two separate creation sections). This fixture
  // always wants a real, named org (most golden paths need to invite a
  // second member into it later), so "My organisation" is the one to click.
  await page.getByRole('button', { name: 'My organisation' }).click();
  await page.getByPlaceholder('Organisation name').fill(orgName);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
  const ownerDisplayName = `${prefix} Owner ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Display name').fill(ownerDisplayName);
  await page.getByRole('button', { name: 'Continue' }).click();

  const orgLink = page.getByRole('link', { name: orgName });
  await expect(orgLink).toBeVisible();
  await orgLink.click();
  const orgSlugMatch = /\/o\/([^/]+)/.exec(page.url());
  if (!orgSlugMatch?.[1]) throw new Error(`could not read the org slug out of ${page.url()}`);

  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByPlaceholder('Model name').fill(modelName);
  await page.getByRole('button', { name: 'Create' }).click();

  const modelLink = page.getByRole('link', { name: modelName });
  await expect(modelLink).toBeVisible();
  await modelLink.click();
  await expect(page.getByRole('heading', { name: modelName })).toBeVisible();
  const modelSlugMatch = /\/o\/[^/]+\/m\/([^/?]+)/.exec(page.url());
  if (!modelSlugMatch?.[1]) throw new Error(`could not read the model slug out of ${page.url()}`);

  return { orgName, modelName, orgSlug: orgSlugMatch[1], modelSlug: modelSlugMatch[1], ownerDisplayName };
}

/**
 * Sends an org invite by email, click-only from wherever `page` currently
 * is inside the model/org: "Atlas" brand link → the org (Home only lists
 * orgs the user is a member of) → "Org settings" (owner/architect only,
 * `OrgHome.tsx`) → the invite form. Returns the page to OrgHome; callers
 * that need to get back into the model navigate there themselves.
 */
export async function inviteMemberFromHome(page: Page, orgName: string, memberEmail: string, role: 'owner' | 'architect' | 'contributor' | 'viewer' = 'contributor'): Promise<void> {
  await page.getByRole('link', { name: 'Atlas' }).click();
  await page.getByRole('link', { name: orgName }).click();
  await page.getByRole('link', { name: 'Org settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation settings' })).toBeVisible();
  await page.getByLabel('Email').fill(memberEmail);
  // exact: true — an existing member's own row has a "Role for <name>"
  // select too; the invite form's own field is the bare "Role" label.
  await page.getByLabel('Role', { exact: true }).selectOption(role);
  // exact: true — once one invite is pending, its row's "Resend invite for
  // <email>" button also contains "send invite" (a case-insensitive
  // substring match), so a second invite from the same page would be
  // ambiguous without it.
  await page.getByRole('button', { name: 'Send invite', exact: true }).click();
  await expect(page.getByText(memberEmail)).toBeVisible({ timeout: 15_000 });
}

/**
 * The invited user's own side: sign up with exactly the invited email —
 * their very first org membership is already there, consumed during
 * signup (`org-settings-invite.spec.ts`'s own precedent).
 */
export async function acceptInviteViaSignUp(page: Page, email: string, displayName: string): Promise<void> {
  const password = `${randomUUID()}Aa1!`;
  await page.goto('/sign-in');
  await page.getByText("Don't have an account? Create one").click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your organisations' })).toBeVisible();
}

/**
 * From ModelHome, click into the Capability map section (`ModelNav`) and
 * import a starter map by its card title — S2 flow 1's own "seed the
 * electricity map".
 */
export async function seedStarterCapabilityMap(page: Page, cardTitleMatch: string | RegExp): Promise<void> {
  await page.getByRole('link', { name: 'Capability map' }).click();
  await expect(page.getByRole('heading', { name: 'Start from a capability map' })).toBeVisible();
  // Match the card's own title, never a draft: other specs leave draft maps
  // in the shared catalogue whose version line can match too.
  const card = page.locator('li').filter({ has: page.getByRole('heading', { name: cardTitleMatch }) }).filter({ hasNotText: /\bDraft\b/ }).first();
  await card.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0, { timeout: 15_000 });
}

export interface AddSystemOptions {
  name: string;
  description: string;
  capabilityName?: string;
}

/**
 * From the Home search box (front door), create a system with a
 * description and (optionally) a primary supports edge to an existing
 * capability — S2 flow 2's own "add a system with description, capability
 * (primary)". Lands on the new element's own page.
 */
export async function addSystemFromHome(page: Page, options: AddSystemOptions): Promise<void> {
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeVisible();
  await searchBox.fill(options.name);
  await page.getByRole('button', { name: `Create system "${options.name}"` }).click();

  await expect(page.getByText('Description (required)')).toBeVisible();
  await page.getByPlaceholder('One line — what this system is').fill(options.description);

  if (options.capabilityName) {
    await page.getByPlaceholder('Search capabilities…').fill(options.capabilityName);
    await page.getByRole('button', { name: options.capabilityName }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Skip capability' }).click();
  }

  await expect(page.getByRole('heading', { name: options.name })).toBeVisible();

  // The post-create toast is pinned full-width at the viewport bottom
  // below 768px (`add-a-system-flow.spec.ts`'s own mobile test) — right
  // where ModelNav's own bottom bar and, on an element page, comment/
  // relationship controls also sit. Dismissing it here, once, means every
  // caller doesn't have to work around it individually. It can render a
  // beat after the heading, so wait for it rather than checking once.
  const toastDismiss = page.getByTestId('add-system-toast').getByRole('button', { name: 'Dismiss' });
  await toastDismiss.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await toastDismiss.isVisible().catch(() => false)) await toastDismiss.click();
}

/**
 * From the Home search box, create a container as a module of an existing
 * platform (system) — `HomeSearch.tsx`'s own `showPlatformPicker` sheet.
 * Lands on the new module's own page.
 */
export async function addContainerFromHome(page: Page, name: string, platformNameMatch: string): Promise<void> {
  const searchBox = page.getByPlaceholder('Search or create a capability, system, or actor…');
  await expect(searchBox).toBeVisible();
  await searchBox.fill(name);
  // The type select beside Home's search box (Home now has other selects too).
  await searchBox.locator('xpath=following::select[1]').selectOption('container');
  await page.getByRole('button', { name: `Create container "${name}"` }).click();

  await expect(page.getByText('Which platform is this a module of? (required)')).toBeVisible();
  await page.getByPlaceholder('Search for the platform this is a module of…').fill(platformNameMatch);
  await page.getByRole('button', { name: new RegExp(platformNameMatch) }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/**
 * From an element page already on screen, add a `uses` relationship with a
 * verb phrase to another (existing) element — S2 flow 2's own
 * "verb-labelled uses relationship".
 */
export async function addUsesRelationship(page: Page, targetNameMatch: string, verbPhrase: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add uses' }).click();
  await page.getByPlaceholder('Search…').fill(targetNameMatch);
  await page.getByRole('button', { name: new RegExp(targetNameMatch) }).click();
  await expect(page.getByText('Verb phrase')).toBeVisible();
  await page.getByPlaceholder('e.g. reads customer records from').fill(verbPhrase);
  // `RelationshipAdd.tsx`'s own "Next" always leads to a "Does this go via
  // an integration platform?" stage before the edge is actually created —
  // "Skip — direct edge" is the finalize action once no via platform is
  // wanted, not "Add" (which only exists on the create-sheet's own
  // simpler picker, a different control).
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Does this go via an integration platform?')).toBeVisible();
  await page.getByRole('button', { name: 'Skip — direct edge' }).click();
  // Saved once its row shows the quoted verb phrase — returning before then
  // let a caller's next click land mid-refresh (an opened menu reset, a
  // report counting before the link was on main).
  await expect(page.getByText(`“${verbPhrase}”`).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * From an element page, "+ Add supports" a capability. `RelationshipAdd.tsx`
 * only asks "primary?" once the element already has a supports edge — pass
 * `answerPrimary` to say yes/no when that prompt appears; omit it for the
 * element's first-ever supports edge (no prompt fires, it lands primary by
 * default the same way the create-sheet's own capability picker does).
 */
export async function addSupportsRelationship(page: Page, capabilityNameMatch: string, answerPrimary?: boolean): Promise<void> {
  await page.getByRole('button', { name: '+ Add supports' }).click();
  await page.getByPlaceholder('Search…').fill(capabilityNameMatch);
  await page.getByRole('button', { name: new RegExp(capabilityNameMatch) }).click();
  if (answerPrimary !== undefined) {
    await expect(page.getByText(`Make ${capabilityNameMatch} the primary capability for this system?`, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: answerPrimary ? 'Yes, primary' : 'No', exact: true }).click();
  }
}

/** Rename the element on the currently-open element page, via the header's "⋯" menu — `element-rename.spec.ts`'s own locator convention (a bare `getByRole('textbox')` also matches the Comments composer, so this is scoped to `<header>`). */
export async function renameElement(page: Page, newName: string): Promise<void> {
  // Right after landing on a page (a merge or conversion's result), the
  // page can still be settling and re-render once, closing a menu opened
  // in that instant — reopen until Rename actually takes.
  const renameInput = page.locator('header').getByRole('textbox');
  await expect(async () => {
    if (!(await page.getByRole('button', { name: 'Rename', exact: true }).isVisible())) await page.getByRole('button', { name: 'Element actions' }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click({ timeout: 2_000 });
    await expect(renameInput).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await renameInput.fill(newName);
  // The rename's own Save, in the header (the Attributes section has its own).
  await page.locator('header').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: newName })).toBeVisible();
}

/** Retire the element on the currently-open element page, with a planned end date and (optionally) a replacement picked by name. */
export async function retireElement(page: Page, plannedEndIsoDate: string, replacementNameMatch?: string): Promise<void> {
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Retire…' }).click();
  await page.getByLabel('Planned end').fill(plannedEndIsoDate);
  if (replacementNameMatch) {
    await page.getByRole('button', { name: '+ Replaced by…' }).click();
    await page.getByPlaceholder('Search systems…').fill(replacementNameMatch);
    await page.getByRole('button', { name: new RegExp(replacementNameMatch) }).click();
  }
  await page.getByRole('button', { name: 'Retire', exact: true }).click();
}

/** Remove the element on the currently-open element page from the model (a retract), confirming the two-step dialog. */
export async function removeElementFromModel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Remove from model…' }).click();
  await page.getByRole('button', { name: 'Remove from model', exact: true }).click();
}

/**
 * Merge the element on the currently-open element page into another
 * (existing) element by name — E7's own "Merge into…". The current element
 * becomes the loser (retracted, its relationships/children move to the
 * target, its old name kept searchable via a new alias); lands on the
 * target (survivor)'s own page once the commit succeeds.
 */
export async function mergeElementInto(page: Page, targetNameMatch: string, rationale: string): Promise<void> {
  await page.getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Merge into…' }).click();
  await page.getByPlaceholder('Search for the element to merge into…').fill(targetNameMatch);
  await page.getByRole('button', { name: new RegExp(targetNameMatch) }).click();
  await page.getByLabel('Why are these the same real thing?').fill(rationale);
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
}

/** From ModelHome (or anywhere `ModelNav` renders), click into the Capability map and add a capability by hand via the empty-state's own "+ Add capability" control. */
export async function addCapability(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Capability map' }).click();
  await page.getByRole('button', { name: '+ Add capability' }).click();
  await page.getByPlaceholder('Capability name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/**
 * Click "Home" (ModelNav's own first section) to get back to ModelHome
 * from anywhere in the model. At 390px, `ModelNav` becomes a bottom bar
 * (its own module comment) that the add-system toast (also pinned to the
 * viewport bottom, `add-a-system-flow.spec.ts`'s own "pinned full-width at
 * the viewport bottom" case) visually overlaps and blocks clicks on —
 * dismissing it first, when present, avoids that collision rather than
 * waiting it out.
 */
export async function goToModelHome(page: Page): Promise<void> {
  const toastDismiss = page.getByTestId('add-system-toast').getByRole('button', { name: 'Dismiss' });
  if (await toastDismiss.isVisible().catch(() => false)) await toastDismiss.click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
}

/**
 * F9 step 4 (UI-principles §2.0): click a model nav item by name, at any
 * width. Below 768px only Home, Capability map, Landscape and Changes sit
 * on the bottom bar — every other section is behind More, so this opens
 * the sheet first when the item isn't on screen.
 */
export async function clickNavItem(page: Page, name: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  const link = nav.getByRole('link', { name });
  if (!(await link.isVisible())) await nav.getByRole('button', { name: /^More/ }).click();
  await link.click();
}

/**
 * F9 step 4: assert which nav section is current, at any width. On the rail
 * (or the bar, for its four items) the link itself carries
 * `aria-current="page"`; for a section behind More on a phone, the More
 * button names it instead.
 */
export async function expectNavCurrent(page: Page, name: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Model navigation' });
  const link = nav.getByRole('link', { name });
  if (await link.isVisible()) await expect(link).toHaveAttribute('aria-current', 'page');
  else await expect(nav.getByRole('button', { name: `More (current: ${name})` })).toBeVisible();
}
