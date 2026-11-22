// Drive the extension's pages the way a person does: find a control by the
// label next to it, type into it, tab away. The pages save on `change`, so
// leaving the field is what commits a value.

import type { ElementHandle, Page } from 'puppeteer';
import { waitFor } from './detour';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// The control inside the `<label>` whose caption starts with `label`. `nth`
// picks among several (each rule row has its own "Match" and "Action").
export async function field(page: Page, label: string, nth = 0): Promise<ElementHandle<Control>> {
  const handle = await page.evaluateHandle(
    (caption, index) => {
      const labels = [...document.querySelectorAll('label')].filter((item) =>
        (item.textContent ?? '').trim().startsWith(caption),
      );
      return labels[index]?.querySelector('input, select, textarea') ?? null;
    },
    label,
    nth,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`No field labelled "${label}" (#${nth}) on ${page.url()}`);
  return element as ElementHandle<Control>;
}

export async function fill(page: Page, label: string, value: string, nth = 0): Promise<void> {
  const control = await field(page, label, nth);
  await control.evaluate((element) => {
    element.focus();
    if (!(element instanceof HTMLSelectElement)) element.select();
  });
  if (value === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(value);
  await page.keyboard.press('Tab');
}

export async function fieldValue(page: Page, label: string, nth = 0): Promise<string> {
  const control = await field(page, label, nth);
  return control.evaluate((element) => element.value);
}

// Pick the option with this visible text.
export async function choose(page: Page, label: string, option: string, nth = 0): Promise<void> {
  const control = await field(page, label, nth);
  const value = await control.evaluate((element, text) => {
    if (!(element instanceof HTMLSelectElement)) return null;
    return [...element.options].find((item) => item.text.trim() === text)?.value ?? null;
  }, option);
  if (value === null) throw new Error(`"${label}" has no option "${option}"`);
  await control.select(value);
}

export async function clickButton(page: Page, text: string, nth = 0): Promise<void> {
  const handle = await page.evaluateHandle(
    (caption, index) =>
      [...document.querySelectorAll('button')].filter(
        (item) => (item.textContent ?? '').trim() === caption,
      )[index] ?? null,
    text,
    nth,
  );
  const button = handle.asElement();
  if (!button) throw new Error(`No "${text}" button (#${nth}) on ${page.url()}`);
  await (button as ElementHandle<HTMLButtonElement>).click();
}

export function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

export async function waitForText(page: Page, text: string): Promise<void> {
  await waitFor(`"${text}" to appear`, async () => (await pageText(page)).includes(text));
}

// Hand a file to the page's file input, as picking it in the file dialog would.
// Firefox does not let automation use the native file chooser on an extension
// page, so the file is built in the page instead.
export async function chooseFile(page: Page, name: string, content: string): Promise<void> {
  await page.evaluate(
    (fileName, text) => {
      const input = document.querySelector<HTMLInputElement>('input[type=file]');
      if (!input) throw new Error('This page has no file input.');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], fileName, { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    name,
    content,
  );
}
