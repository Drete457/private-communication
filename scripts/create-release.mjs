import { spawnSync } from "node:child_process";
import process from "node:process";

function printUsage() {
  console.log(`Usage:
  npm run release:create -- <tag> [asset ...] [options]

Examples:
  npm run release:create -- v1.0.0
  npm run release:create -- v1.1.0 --draft
  npm run release:create -- v1.2.0 ./dist/app.tar.gz ./dist/checksums.txt --target main --notes "Deployment changes included"
  npm run release:create -- v1.2.1 --dry-run

Options:
  --target <ref>             Branch or commit SHA for automatic tag creation when the tag does not exist remotely.
  --title <title>            Explicit release title.
  --notes <text>             Extra notes prepended to generated notes.
  --notes-file <file>        Read extra notes from file.
  --draft                    Create the release as a draft.
  --prerelease               Mark the release as a prerelease.
  --latest                   Mark the release as latest.
  --latest=false             Explicitly do not mark the release as latest.
  --verify-tag               Fail if the tag does not already exist remotely. Do not combine with --target.
  --dry-run                  Print the planned release command and commit range without creating anything.
  -h, --help                 Show this help.
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

  if (result.error) 
    throw result.error;

  return result;
}

function readLatestTag(excludeTag) {
  const result = run("git", ["tag", "--sort=-v:refname"]);
  if (result.status !== 0) 
    return null;

  const tags = result.stdout
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => tag !== excludeTag);

  return tags[0] ?? null;
}

function readCommitPreview(previousTag) {
  const args = previousTag
    ? ["log", "--oneline", `${previousTag}..HEAD`]
    : ["log", "--oneline", "--max-count", "20"];

  const result = run("git", args);
  if (result.status !== 0) 
    return "";

  return result.stdout.trim();
}

function consumeValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${optionName}.`);
    process.exit(1);
  }

  return value;
}

function formatDisplayArg(arg) {
  if (/^[A-Za-z0-9_./:@%+=,#-]+$/.test(arg))
    return arg;

  return `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}

function formatCommandForDisplay(command, args) {
  return [command, ...args].map(formatDisplayArg).join(" ");
}

const argv = process.argv.slice(2);
const ghArgs = ["release", "create"];
const positional = [];
let dryRun = false;
let hasTarget = false;
let verifyTag = false;

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];

  if (arg === "-h" || arg === "--help") {
    printUsage();
    process.exit(0);
  }

  if (arg === "--dry-run") {
    dryRun = true;
    continue;
  }

  if (arg === "--verify-tag") {
    verifyTag = true;
    ghArgs.push(arg);
    continue;
  }

  if (arg === "--draft" || arg === "--prerelease" || arg === "--latest") {
    ghArgs.push(arg);
    continue;
  }

  if (arg.startsWith("--latest=")) {
    ghArgs.push(arg);
    continue;
  }

  if (arg === "--target") {
    hasTarget = true;
    const value = consumeValue(argv, index, arg);
    ghArgs.push(arg, value);
    index += 1;
    continue;
  }

  if (["--title", "--notes", "--notes-file"].includes(arg)) {
    const value = consumeValue(argv, index, arg);
    ghArgs.push(arg, value);
    index += 1;
    continue;
  }

  if (arg.startsWith("--target=")) {
    hasTarget = true;
    ghArgs.push(arg);
    continue;
  }

  if (arg.startsWith("--title=") || arg.startsWith("--notes=") || arg.startsWith("--notes-file=")) {
    ghArgs.push(arg);
    continue;
  }

  positional.push(arg);
}

if (hasTarget && verifyTag) {
  console.error("Do not combine --target and --verify-tag. Use --target when GitHub should create the tag, or --verify-tag when the tag already exists remotely.");
  process.exit(1);
}

if (positional.length === 0) {
  printUsage();
  process.exit(1);
}

const [tag, ...assets] = positional;
const previousTag = readLatestTag(tag);

ghArgs.push(tag, "--generate-notes");

if (previousTag) 
  ghArgs.push("--notes-start-tag", previousTag);

if (assets.length > 0) 
  ghArgs.push(...assets);

if (dryRun) {
  const preview = readCommitPreview(previousTag);
  console.log(`Tag: ${tag}`);
  console.log(`Previous tag: ${previousTag ?? "none"}`);
  console.log("Command:");
  console.log(formatCommandForDisplay("gh", ghArgs));
  console.log("");
  console.log(previousTag ? `Commit range: ${previousTag}..HEAD` : "Commit range: initial release (showing the last 20 commits)");
  if (preview) 
    console.log(preview);
  else 
    console.log("No commits found for the computed range.");
  
  process.exit(0);
}

const result = spawnSync("gh", ghArgs, { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);