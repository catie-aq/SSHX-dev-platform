/**
 * End-to-end scenario of the platform, from the first login to sharing, with
 * real sshx clients. Steps run in order and build on each other.
 */

import fs from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";

import { loadStack, Machine, PATHS, stopAllMachines, type Stack } from "./stack";

/** Test passphrase; never a real one. */
const PASSPHRASE = "phrase secrète de test e2e";
const SCREENS = path.join(PATHS.root, "test-results/screens");

let stack: Stack;
let alice: Page;
let laptop: Machine;
/** Keys (`session/sid`) of the terminals created along the way. */
const keys: { first?: string; second?: string } = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  stack = loadStack();
  alice = await openUser(browser);
});

test.afterAll(async () => {
  await stopAllMachines();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openUser(browser: Browser, options: BrowserContextOptions = {}): Promise<Page> {
  const context = await browser.newContext({ baseURL: stack.baseUrl, ...options });
  // Record browser notifications instead of showing them.
  await context.addInitScript(() => {
    const w = window as any;
    w.__notifications = [];
    class FakeNotification {
      static permission = "granted";
      static async requestPermission() {
        return "granted";
      }
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: { body?: string }) {
        w.__notifications.push({ title, body: opts?.body });
      }
      close() {}
    }
    w.Notification = FakeNotification;
  });
  return context.newPage();
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

async function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`) });
}

async function login(page: Page, username: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\/?$/);
  await page.getByLabel("Votre identifiant").fill(username);
  await page.getByRole("button", { name: "Continuer" }).click();
}

async function createPassphrase(page: Page) {
  await expect(page.getByRole("heading", { name: "Choisissez une phrase secrète" })).toBeVisible();
  await page.getByLabel("Phrase secrète", { exact: true }).fill(PASSPHRASE);
  await page.getByLabel("Confirmation").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Continuer" }).click();
}

function row(page: Page, key: string): Locator {
  return page.locator(`[data-testid="terminal-row"][data-key="${key}"]`);
}

function pane(page: Page, key: string): Locator {
  return page.locator(`[data-testid="terminal-pane"][data-key="${key}"]`);
}

async function paneKeys(page: Page): Promise<string[]> {
  return page.getByTestId("terminal-pane").evaluateAll((els) => els.map((e) => e.getAttribute("data-key")!));
}

async function terminalText(page: Page, key: string): Promise<string> {
  const [session, sid] = key.split("/");
  return page.evaluate(
    ([s, n]) => (window as any).__sshxPlatform.terminalText(s, n) as Promise<string | null>,
    [session, Number(sid)] as const,
  ).then((t) => t ?? "");
}

/** Type a command line in a terminal, as a user would. */
async function typeIn(page: Page, key: string, line: string) {
  await pane(page, key).locator(".xterm").click();
  await page.keyboard.type(line, { delay: 5 });
  await page.keyboard.press("Enter");
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

test("1. connexion puis création de la phrase secrète", async () => {
  await alice.goto("/");
  await expect(alice).toHaveURL(/\/login\/?$/);
  await shot(alice, "01-connexion");
  await alice.getByLabel("Votre identifiant").fill("alice");
  await alice.getByRole("button", { name: "Continuer" }).click();
  await expect(alice.getByRole("heading", { name: "Choisissez une phrase secrète" })).toBeVisible();
  await shot(alice, "02-phrase-secrete");
  await alice.getByLabel("Phrase secrète", { exact: true }).fill(PASSPHRASE);
  await alice.getByLabel("Confirmation").fill("autre chose");
  await alice.getByRole("button", { name: "Continuer" }).click();
  await expect(alice.getByText("Les deux saisies sont différentes.")).toBeVisible();
  await alice.getByLabel("Confirmation").fill(PASSPHRASE);
  await alice.getByRole("button", { name: "Continuer" }).click();
  await expect(alice.getByTestId("welcome")).toBeVisible({ timeout: 30_000 });
  await expect(alice.getByRole("heading", { name: "Connectez votre première machine" })).toBeVisible();
});

test("2. une seule commande connecte la machine et ouvre son terminal", async () => {
  await shot(alice, "03-premiere-machine");
  await alice.getByLabel("Nom de la machine").fill("portable");
  await alice.getByRole("button", { name: "Générer la commande" }).click();
  const command = (await alice.getByTestId("enroll-command").textContent())!.trim();
  expect(command).toMatch(/^sshx platform enroll http:\/\/127\.0\.0\.1:\d+ smt_[\w-]+\.[\w-]{43} && sshx$/);
  await expect(alice.getByTestId("enroll-status")).toHaveAttribute("data-connected", "false");
  await shot(alice, "04-commande");

  laptop = new Machine(stack, "laptop");
  laptop.start(command);

  // The wizard notices the machine and opens a first terminal by itself.
  await expect(alice.getByTestId("terminal-pane")).toBeVisible({ timeout: 30_000 });
  [keys.first] = await paneKeys(alice);
  await expect(row(alice, keys.first!)).toBeVisible();

  const log = stripAnsi(laptop.log());
  expect(log).toContain("Enrolled as portable");
  expect(log).toContain("Claude Code hooks installed");
  const settings = fs.readFileSync(path.join(laptop.home, ".claude/settings.json"), "utf8");
  expect(settings).toContain(" hook claude");

  // Project and branch come from the git repository the shell runs in.
  await expect(row(alice, keys.first!).getByTestId("terminal-name")).toHaveText("traduction", { timeout: 15_000 });
  await expect(row(alice, keys.first!)).toContainText("main");
  await expect(alice.locator('[data-testid="group"][data-title="traduction"]')).toBeVisible();
});

test("3. le terminal transmet saisie et sortie", async () => {
  await typeIn(alice, keys.first!, "echo e2e-$((6*7))");
  await expect.poll(() => terminalText(alice, keys.first!)).toContain("e2e-42");
  await shot(alice, "05-terminal");
});

test("4. `sshx platform status` vérifie toute la chaîne, depuis la machine et depuis un terminal", async () => {
  const { code, out } = laptop.run("sshx platform status");
  const text = stripAnsi(out);
  expect(code, text).toBe(0);
  expect(text).toContain("Everything works.");
  expect(text).toMatch(/Platform\s+machine portable \(personal, owner alice\)/);
  expect(text).toMatch(/sshx server\s+http:\/\/127\.0\.0\.1:\d+/);
  expect(text).toMatch(/Sessions\s+1 online/);
  expect(text).toMatch(/Claude hooks\s+11\/11 events/);
  expect(text).toMatch(/This terminal\s+not inside an sshx terminal/);

  // Inside an sshx terminal, the hook socket is checked too.
  await typeIn(alice, keys.first!, "sshx platform status");
  await expect.poll(() => terminalText(alice, keys.first!).then(stripAnsi)).toMatch(/This terminal\s+tracked \(session \S+, terminal \d+\)/);

  // A revoked or unknown configuration fails with exit code 1.
  const broken = laptop.run("SSHX_PLATFORM_TOKEN=smt_nope.AAAA sshx platform status");
  expect(broken.code).toBe(1);
});

test("5. états de l'agent : en cours, question, terminé non lu, notification", async () => {
  // A second terminal to look at while the agent finishes.
  await alice.getByTestId("new-terminal").click();
  await expect.poll(async () => (await paneKeys(alice))[0]).not.toBe(keys.first);
  [keys.second] = await paneKeys(alice);
  await expect(alice.getByTestId("terminal-row")).toHaveCount(2);

  // Bell on the first terminal.
  await row(alice, keys.first!).hover();
  await row(alice, keys.first!).getByRole("button", { name: "Me notifier" }).click();
  await row(alice, keys.first!).click();
  await expect(pane(alice, keys.first!)).toBeVisible();

  // A fake Claude Code session sending the real hook payloads through `sshx hook`.
  fs.writeFileSync(
    path.join(laptop.home, "fake-claude.sh"),
    `send() { printf '%s' "$1" | sshx hook claude; }
send '{"hook_event_name":"SessionStart","session_id":"e2e","cwd":"'"$PWD"'"}'
send '{"hook_event_name":"UserPromptSubmit","session_id":"e2e","prompt":"Traduis le README"}'
sleep 2
send '{"hook_event_name":"PreToolUse","session_id":"e2e","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Quelle langue cible ?"}]}}'
read answer
send '{"hook_event_name":"PostToolUse","session_id":"e2e","tool_name":"AskUserQuestion"}'
sleep 4
send '{"hook_event_name":"Stop","session_id":"e2e","last_assistant_message":"Traduction en '"$answer"' terminée : 3 fichiers."}'
sleep 300
`,
  );
  await typeIn(alice, keys.first!, "sh ~/fake-claude.sh");
  await expect(row(alice, keys.first!)).toHaveAttribute("data-state", "working");
  await expect(row(alice, keys.first!)).toHaveAttribute("data-state", "question");
  await expect(row(alice, keys.first!).getByTestId("terminal-detail")).toHaveText("Quelle langue cible ?");
  const banner = alice.getByTestId("agent-banner");
  await expect(banner).toHaveAttribute("data-state", "question");
  await expect(banner).toContainText("Claude pose une question");
  await expect(banner.getByTestId("agent-message")).toHaveText("Quelle langue cible ?");
  await expect(alice.getByTestId("filter-attention")).toHaveText(/1 à traiter/);
  await shot(alice, "06-question");

  // Answer, then look at the other terminal while the agent finishes.
  await typeIn(alice, keys.first!, "anglais");
  await expect(row(alice, keys.first!)).toHaveAttribute("data-state", "working");
  await row(alice, keys.second!).click();
  await expect(pane(alice, keys.second!)).toBeVisible();
  await expect(row(alice, keys.first!)).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await expect(row(alice, keys.first!)).toHaveAttribute("data-unread", "true");
  await expect(row(alice, keys.first!).getByTestId("terminal-detail")).toHaveText("Traduction en anglais terminée : 3 fichiers.");
  await expect(alice).toHaveTitle(/^\(1\) /);
  await expect
    .poll(() => alice.evaluate(() => (window as any).__notifications.map((n: any) => n.title)))
    .toContainEqual(expect.stringMatching(/a terminé$/));
  await shot(alice, "07-termine-non-lu");

  // Looking at it marks it read.
  await row(alice, keys.first!).click();
  await expect(row(alice, keys.first!)).toHaveAttribute("data-unread", "false");
  await expect(alice).not.toHaveTitle(/^\(/);
  await expect(alice.getByTestId("agent-banner")).toContainText("Claude a terminé");
  await pane(alice, keys.first!).locator(".xterm").click();
  await alice.keyboard.press("Control+C");
});

test("6. renommage chiffré, conservé après rechargement", async () => {
  await row(alice, keys.first!).dblclick();
  const input = row(alice, keys.first!).getByLabel("Nom du terminal");
  await expect(input).toBeFocused();
  await input.fill("claude - traduction");
  await input.press("Enter");
  await expect(row(alice, keys.first!).getByTestId("terminal-name")).toHaveText("claude - traduction");

  await alice.reload();
  await expect(row(alice, keys.first!).getByTestId("terminal-name")).toHaveText("claude - traduction");
  await expect(alice.getByTestId("terminal-pane")).toHaveCount(1);

  // The server only stores ciphertext: no name, path, question or output.
  const db = ["", "-wal", "-shm"]
    .map((suffix) => stack.db + suffix)
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f).toString("latin1"))
    .join("\n");
  expect(db).toContain("portable");
  for (const secret of ["claude - traduction", "Quelle langue cible", "Traduction en anglais", "e2e-42", laptop.project]) {
    expect(db, `"${secret}" must not be stored in clear`).not.toContain(secret);
  }
});

test("7. deux terminaux côte à côte", async () => {
  await row(alice, keys.second!).click({ modifiers: ["Alt"] });
  await expect(alice.getByTestId("terminal-pane")).toHaveCount(2);
  await shot(alice, "08-division");
  await pane(alice, keys.second!).getByRole("button", { name: "Retirer le panneau" }).click();
  await expect(alice.getByTestId("terminal-pane")).toHaveCount(1);
});

test("8. fermeture d'un terminal depuis son menu", async () => {
  await row(alice, keys.second!).click();
  await pane(alice, keys.second!).getByTestId("pane-menu").click();
  await shot(alice, "09-menu-terminal");
  await alice.getByRole("menuitem", { name: "Fermer le terminal" }).click();
  await alice.getByTestId("confirm-close").click();
  await expect(row(alice, keys.second!)).toHaveCount(0);
  await expect(alice.getByTestId("terminal-row")).toHaveCount(1);
});

test("9. nouvel appareil en affichage mobile", async ({ browser }) => {
  const phone = await openUser(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await login(phone, "alice");
  await expect(phone.getByRole("heading", { name: "Déverrouiller" })).toBeVisible();
  await phone.getByLabel("Phrase secrète").fill(PASSPHRASE);
  await phone.getByRole("button", { name: "Déverrouiller" }).click();
  await expect(row(phone, keys.first!).getByTestId("terminal-name")).toHaveText("claude - traduction", { timeout: 30_000 });
  await shot(phone, "10-mobile-liste");
  await row(phone, keys.first!).tap();
  await expect(pane(phone, keys.first!)).toBeVisible();
  await expect(phone.getByTestId("mobile-keys")).toBeVisible();
  await expect(phone.getByTestId("sidebar")).toHaveCount(0);
  await expect.poll(() => terminalText(phone, keys.first!)).toContain("e2e-42");
  await shot(phone, "11-mobile-terminal");
  await phone.getByRole("button", { name: "Retour à la liste" }).tap();
  await expect(phone.getByTestId("sidebar")).toBeVisible();
  await phone.context().close();
});

test("10. partage d'une machine avec un collègue", async ({ browser }) => {
  const bob = await openUser(browser);
  await login(bob, "bob");
  await createPassphrase(bob);
  await expect(bob.getByTestId("welcome")).toBeVisible({ timeout: 30_000 });

  await alice.goto("/machines");
  const card = alice.locator('[data-testid="machine-card"][data-name="portable"]');
  await expect(card).toContainText("En ligne");
  await card.getByRole("button", { name: /Accès/ }).click();
  await card.getByTestId("share-select").selectOption(await optionValue(card, "bob (bob)"));
  await card.getByRole("button", { name: "Partager", exact: true }).click();
  await expect(alice.getByText("portable partagée avec bob.")).toBeVisible();
  await shot(alice, "12-machines");

  // Bob's first run ends by itself: he now has a machine. Names, pins and
  // bells are personal, so he sees the automatic name.
  await expect(bob.getByTestId("welcome")).toHaveCount(0, { timeout: 20_000 });
  await expect(row(bob, keys.first!).getByTestId("terminal-name")).toHaveText(/traduction$/);
  await expect(row(bob, keys.first!).getByTestId("terminal-name")).not.toHaveText("claude - traduction");
  await row(bob, keys.first!).click();
  await expect.poll(() => terminalText(bob, keys.first!)).toContain("e2e-42");
  await bob.context().close();
  await alice.goto("/");
});

/** Value of the sharing option whose label starts with `prefix`. */
async function optionValue(card: Locator, prefix: string): Promise<string> {
  const option = card.getByTestId("share-select").locator("option").filter({ hasText: prefix });
  await expect(option).toHaveCount(1);
  return (await option.getAttribute("value"))!;
}

test("11. contrôles d'accès de l'API", async ({ playwright, browser }) => {
  const anonymous = await playwright.request.newContext({ baseURL: stack.baseUrl });
  expect((await anonymous.get("/api/workspace")).status()).toBe(401);
  await anonymous.dispose();

  // Without the anti-CSRF header, state changes are refused.
  expect((await alice.request.post("/api/machines", { data: {} })).status()).toBe(403);

  // A colleague without access sees nothing and cannot open the session.
  const carol = await openUser(browser);
  await login(carol, "carol");
  await createPassphrase(carol);
  const ws = await carol.request.get("/api/workspace");
  expect((await ws.json()).machines).toEqual([]);
  const session = keys.first!.split("/")[0];
  const outcome = await carol.evaluate(
    (name) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/s/${name}`);
        socket.onopen = () => resolve("open");
        socket.onerror = () => resolve("refused");
      }),
    session,
  );
  expect(outcome).toBe("refused");
  await carol.context().close();
});

test("12. machine arrêtée (Ctrl-C) puis relancée", async () => {
  await row(alice, keys.first!).click();
  await expect(pane(alice, keys.first!)).toBeVisible();
  await laptop.stop();
  await expect(row(alice, keys.first!)).toHaveAttribute("data-online", "false", { timeout: 15_000 });
  await expect(pane(alice, keys.first!)).toContainText("portable est hors ligne.");
  await shot(alice, "13-hors-ligne");

  laptop.start("sshx");
  await expect.poll(() => stripAnsi(laptop.run("sshx platform status").out), { timeout: 20_000 }).toMatch(/Sessions\s+1 online/);
  await alice.getByTestId("new-terminal").click();
  await expect.poll(async () => (await paneKeys(alice))[0]?.split("/")[0]).not.toBe(keys.first!.split("/")[0]);
  const [key] = await paneKeys(alice);
  await expect(row(alice, key)).toHaveAttribute("data-online", "true");
  await typeIn(alice, key, "echo retour-$((40+2))");
  await expect.poll(() => terminalText(alice, key)).toContain("retour-42");
});

test("13. ajout d'une machine depuis la barre latérale, page d'administration", async () => {
  await alice.getByTestId("user-menu").click();
  await alice.getByRole("menuitem", { name: "Ajouter une machine…" }).click();
  await expect(alice.getByRole("dialog", { name: "Ajouter une machine" })).toBeVisible();
  await shot(alice, "14-ajout-machine");
  await alice.keyboard.press("Escape");

  await alice.goto("/admin");
  const users = alice.getByTestId("admin-users");
  for (const name of ["alice", "bob", "carol"]) await expect(users).toContainText(name);
  await shot(alice, "15-admin");
});
