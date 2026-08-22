import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeFormFile,
  collectFormSites,
  unsafeNativeSubmitForms
} from "@/lib/security/form-method-guard";

/**
 * The invariant: no form may submit as GET when JavaScript has not run.
 *
 * This shipped twice (MB-GOD-003 on the consumer auth forms, MB-GOD-010 on
 * /admin/login) because the defect is invisible to any test that runs
 * JavaScript and looks entirely correct while reading the JSX.
 */

const workspace = mkdtempSync(join(tmpdir(), "form-guard-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** Writes a throwaway component and analyses it. */
function analyze(source: string) {
  const directory = join(workspace, "components");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "fixture.tsx");
  writeFileSync(file, source, "utf8");
  return analyzeFormFile(workspace, file);
}

describe("form method guard — detection", () => {
  it("flags an onSubmit form with no method", () => {
    const sites = analyze(`
      export function F() {
        return <form className="x" onSubmit={handleSubmit(onSubmit)}>{null}</form>;
      }
    `);
    expect(sites).toHaveLength(1);
    expect(unsafeNativeSubmitForms(sites)).toHaveLength(1);
  });

  it("accepts a form that declares method", () => {
    const sites = analyze(`
      export function F() {
        return <form className="x" method="post" onSubmit={handleSubmit(onSubmit)}>{null}</form>;
      }
    `);
    expect(unsafeNativeSubmitForms(sites)).toEqual([]);
  });

  it("accepts a form that declares action, which posts by design", () => {
    const sites = analyze(`
      export function F() {
        return <form action={saveAction}>{null}</form>;
      }
    `);
    expect(unsafeNativeSubmitForms(sites)).toEqual([]);
  });

  it("ignores a form with no onSubmit, which has no handler to bypass", () => {
    const sites = analyze(`
      export function F() {
        return <form className="x">{null}</form>;
      }
    `);
    expect(unsafeNativeSubmitForms(sites)).toEqual([]);
  });

  it("reads a multi-line opening tag without stopping at a > inside an expression", () => {
    // The arrow function contains `=>`; a naive scan ends the tag there and
    // never sees the method that follows.
    const sites = analyze(`
      export function F() {
        return (
          <form
            onSubmit={(event) => {
              event.preventDefault();
            }}
            method="post"
          >
            {null}
          </form>
        );
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.hasMethod).toBe(true);
    expect(unsafeNativeSubmitForms(sites)).toEqual([]);
  });

  it("keeps two forms in one file separate", () => {
    const sites = analyze(`
      export function F() {
        return (
          <div>
            <form method="post" onSubmit={a}>{null}</form>
            <form onSubmit={b}>{null}</form>
          </div>
        );
      }
    `);
    expect(sites).toHaveLength(2);
    expect(unsafeNativeSubmitForms(sites)).toHaveLength(1);
  });
});

describe("form method guard — repository", () => {
  const sites = collectFormSites(process.cwd());

  it("finds the product's forms (the scanner is actually running)", () => {
    // If this reached zero every assertion below would pass vacuously.
    expect(sites.length).toBeGreaterThan(10);
  });

  it("no form submits as GET when JavaScript has not run", () => {
    const unsafe = unsafeNativeSubmitForms(sites);
    expect(
      unsafe.map((site) => `${site.file}:${site.line}`),
      'Without JavaScript this form submits natively as GET, putting every field in the URL ' +
        '(browser history, access logs, proxies). Add method="post". ' +
        "This shipped twice: MB-GOD-003 (/login, /signup) and MB-GOD-010 (/admin/login)."
    ).toEqual([]);
  }, 15_000);

  it("every credential form posts", () => {
    // The forms where a leak is most costly, named explicitly so a future
    // refactor cannot quietly drop one out of the scanned set.
    const credentialFiles = [
      "components/auth/login-form.tsx",
      "components/auth/signup-form.tsx",
      "components/auth/reset-password-form.tsx",
      "components/auth/forgot-password-form.tsx",
      "components/admin/admin-login-form.tsx",
      "components/admin/create-admin-form.tsx"
    ];
    for (const file of credentialFiles) {
      const forms = sites.filter((site) => site.file === file);
      expect(forms.length, `${file} has no form — did it move?`).toBeGreaterThan(0);
      for (const form of forms) {
        expect(form.hasMethod || form.hasAction, `${file}:${form.line} does not post`).toBe(true);
      }
    }
  });
});
