import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const outputDirectory = resolve(import.meta.dirname, '..', 'dist', 'scenario-lab');
const forbidden = /\b(?:tesseraTest|TesseraTestBridge|registerTesseraTestBridge)\b/u;

const javascriptFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await javascriptFiles(path)));
    } else if (entry.name.endsWith('.js')) {
      files.push(path);
    }
  }
  return files;
};

const files = await javascriptFiles(outputDirectory);
const matches = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (forbidden.test(source)) {
    matches.push(file);
  }
}

if (matches.length > 0) {
  console.error('Production output contains the development test surface:');
  for (const file of matches) {
    console.error(`- ${file}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Production test surface check passed for ${files.length} JavaScript files.`);
}
