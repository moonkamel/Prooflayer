// Ligne de commande : `npx @prooflayer/verify pack.zip`. Code de sortie 0 si aucune altération, 1 sinon (ou si le
// fichier est illisible, ou les options invalides). `main` est séparée de l'exécution pour être testée sans processus.
import { formatReport } from "./format.js";
import { MESSAGES, type Lang } from "./messages.js";
import { PINNED_KEYS, PINNED_TSA_ROOTS } from "./trust.js";
import type { TrustedRoot } from "./tsa.js";
import { verifyPack } from "./verify.js";

export const VERSION = "0.1.0";

export interface CliIo {
  readFile(path: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Langue de l'environnement, pour l'aide et les erreurs avant lecture du pack. */
  envLang?: string;
}

interface Args {
  file: string | null;
  json: boolean;
  strict: boolean;
  lang: Lang | null;
  keys: Record<string, string>;
  tsaFiles: string[];
  help: boolean;
  version: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = {
    file: null,
    json: false,
    strict: false,
    lang: null,
    keys: {},
    tsaFiles: [],
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => argv[++i];
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version") args.version = true;
    else if (arg === "--lang") {
      const lang = value();
      if (lang !== "fr" && lang !== "en") return "--lang fr|en";
      args.lang = lang;
    } else if (arg === "--trust-key") {
      const spec = value() ?? "";
      const at = spec.indexOf("=");
      if (at <= 0) return "--trust-key <kid>=<base64>";
      args.keys[spec.slice(0, at)] = spec.slice(at + 1);
    } else if (arg === "--trust-tsa") {
      const file = value();
      if (!file) return "--trust-tsa <file.pem>";
      args.tsaFiles.push(file);
    } else if (arg.startsWith("-")) return arg;
    else if (args.file) return arg;
    else args.file = arg;
  }
  return args;
}

const langOf = (value: string | undefined): Lang =>
  value?.toLowerCase().startsWith("en") ? "en" : "fr";

export async function main(argv: readonly string[], io: CliIo): Promise<0 | 1> {
  const envLang = langOf(io.envLang);
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.stderr(`${MESSAGES[envLang].usageError(args)}\n\n${MESSAGES[envLang].usage}\n`);
    return 1;
  }
  const uiLang = args.lang ?? envLang;
  if (args.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (args.help || !args.file) {
    (args.help ? io.stdout : io.stderr)(`${MESSAGES[uiLang].usage}\n`);
    return args.help ? 0 : 1;
  }
  let zip: Uint8Array;
  const extraRoots: TrustedRoot[] = [];
  try {
    zip = await io.readFile(args.file);
  } catch {
    io.stderr(`${MESSAGES[uiLang].unreadable(args.file)}\n`);
    return 1;
  }
  for (const file of args.tsaFiles) {
    try {
      const pem = new TextDecoder().decode(await io.readFile(file));
      // Une racine ajoutée à la main n'est jamais réputée qualifiée : seule une version du paquet peut l'affirmer.
      extraRoots.push({ name: file, qualified: false, pem });
    } catch {
      io.stderr(`${MESSAGES[uiLang].unreadable(file)}\n`);
      return 1;
    }
  }
  const report = await verifyPack(zip, {
    keys: { ...PINNED_KEYS, ...args.keys },
    tsaRoots: [...PINNED_TSA_ROOTS, ...extraRoots],
  });
  const passed = args.strict ? report.clean : report.ok;
  if (args.json) {
    io.stdout(
      `${JSON.stringify({ ...report, passed, strict: args.strict, version: VERSION }, null, 2)}\n`,
    );
  } else {
    const lang = args.lang ?? (report.pack?.language === "en" ? "en" : report.pack ? "fr" : uiLang);
    io.stdout(formatReport(report, lang));
  }
  return passed ? 0 : 1;
}
