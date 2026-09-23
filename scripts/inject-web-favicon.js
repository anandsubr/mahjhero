#!/usr/bin/env node
/**
 * Patches the favicon link into dist/index.html after `expo export -p web`.
 *
 * app/+html.tsx -- expo-router's documented hook for customizing the web
 * build's root document -- has NO EFFECT here. Confirmed empirically:
 * intentionally broken syntax in +html.tsx still produced a successful,
 * unchanged build. app.json's `web: { bundler: "metro", output: "single" }`
 * ships a fixed HTML shell for the single-page-app pipeline, which -- unlike
 * `output: "static"` -- never renders +html.tsx at all. There is no
 * supported way to inject a <link rel="icon"> into that shell from inside
 * the app; this script is the workaround, run as a build step.
 *
 * Same inline SVG data URI as marketing/index.html's favicon and the tile
 * motif in assets/icon.png, so the browser tab, the marketing page and the
 * iOS app icon all read as one brand rather than a fourth variant.
 */
const fs = require('fs');
const path = require('path');

const FAVICON_LINK =
  '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'%3E%3Crect width=\'64\' height=\'64\' rx=\'16\' fill=\'%23c67139\'/%3E%3Ctext x=\'32\' y=\'44\' font-size=\'34\' text-anchor=\'middle\' fill=\'%23f5ead8\'%3E%E4%B8%AD%3C/text%3E%3C/svg%3E" />';

const indexPath = path.resolve(__dirname, '../dist/index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`inject-web-favicon: ${indexPath} does not exist -- run this after "expo export -p web", not before.`);
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');

if (html.includes('rel="icon"')) {
  console.log('inject-web-favicon: dist/index.html already has a favicon link, leaving it alone.');
  process.exit(0);
}

const titleTag = '<title>MahjHero</title>';
if (!html.includes(titleTag)) {
  console.error(
    `inject-web-favicon: expected to find ${titleTag} in dist/index.html to anchor the ` +
      'insertion, but it was not there. The exported shell may have changed shape -- ' +
      'inspect dist/index.html and update this script rather than injecting blindly.',
  );
  process.exit(1);
}

const patched = html.replace(titleTag, `${titleTag}\n    ${FAVICON_LINK}`);
fs.writeFileSync(indexPath, patched);
console.log('inject-web-favicon: added the favicon link to dist/index.html.');
