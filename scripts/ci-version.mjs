import { readFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (process.env.EXPECTED_ARCH !== process.arch) throw new Error('Unexpected runner architecture');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error('The release tag must match package.json');
}
console.log(`Building ${version} on ${process.platform}/${process.arch}`);
