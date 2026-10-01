import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(
  new URL('../customizations/titlebar/desktop.js', import.meta.url),
  'utf8',
);
const css = await readFile(
  new URL('../customizations/titlebar/desktop.css', import.meta.url),
  'utf8',
);
const options = { origin: 'https://cuescord.cuesc.net', version: '0.1.0', platform: 'linux', css };
const script = `(${source})(${JSON.stringify(options)});`;

function page(origin = options.origin, frame = false) {
  const window = { location: { origin } };
  window.top = frame ? {} : window;
  const document = {
    adoptedStyleSheets: [],
    hidden: false,
    addEventListener() {},
    getAnimations: () => [],
  };
  class CSSStyleSheet {
    replaceSync(value) {
      this.css = value;
    }
  }
  return createContext({ window, document, CSSStyleSheet });
}

test('customizations are applied to the app without mutating server-rendered DOM', () => {
  const context = page();
  // No DOM insertion API is available: hydration must receive the original HTML.
  runInContext(script, context);
  assert.equal(context.window.__CUESCORD_DESKTOP__.platform, 'linux');
  assert.equal(context.window.__CUESCORD_DESKTOP__.version, '0.1.0');
  assert.equal(context.document.adoptedStyleSheets[0].css, css);
  assert.ok(Object.isFrozen(context.window.__CUESCORD_DESKTOP__));
  assert.equal(
    Object.getOwnPropertyDescriptor(context.window, '__CUESCORD_DESKTOP__').writable,
    false,
  );
});

test('subframes and foreign origins never receive desktop customizations', () => {
  for (const context of [
    page(options.origin, true),
    page('https://example.com'),
    page('https://cuescord.cuesc.net.attacker.test'),
    page('http://cuescord.cuesc.net'),
    page('https://cuescord.cuesc.net:444'),
  ]) {
    runInContext(script, context);
    assert.equal(context.window.__CUESCORD_DESKTOP__, undefined);
    assert.equal(context.document.adoptedStyleSheets.length, 0);
  }
});

test('initialization is idempotent and preserves other adopted styles', () => {
  const context = page();
  const existingSheet = {};
  context.document.adoptedStyleSheets.push(existingSheet);
  runInContext(script, context);
  runInContext(script, context);
  assert.equal(context.document.adoptedStyleSheets.length, 2);
  assert.equal(context.document.adoptedStyleSheets[0], existingSheet);
});
