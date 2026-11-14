#!/usr/bin/env node
// Point d'entrée exécutable (Node 20 et plus).
import { readFile } from "node:fs/promises";
import { main } from "./cli.js";

const code = await main(process.argv.slice(2), {
  readFile: async (path) => new Uint8Array(await readFile(path)),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  envLang: process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG,
});
process.exitCode = code;
