import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEPLOY_VAR_NAMES = [
  "MAX_FILE_SIZE_MB",
  "ROOM_TTL_HOURS",
  "BLOCKED_MIME_TYPES",
  "ADMIN_AUTH_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];

const REQUIRED_DEPLOY_VAR_NAMES = [
  "ADMIN_AUTH_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];

async function main() {
  const cwd = process.cwd();
  const envFile = parseCliArgs(process.argv.slice(2));
  const envPath = path.resolve(cwd, envFile);
  const builtConfigPath = path.resolve(cwd, "dist/client/drop/wrangler.json");

  const [envValues, builtConfig] = await Promise.all([
    loadEnvFile(envPath),
    loadBuiltConfig(builtConfigPath),
  ]);

  const envOverrides = pickVars(envValues, DEPLOY_VAR_NAMES);
  const deployVars = { ...(builtConfig.vars ?? {}), ...envOverrides };
  validateRequired(deployVars, REQUIRED_DEPLOY_VAR_NAMES, "deploy vars");

  const deployConfig = { ...builtConfig, vars: deployVars };
  await writeFile(builtConfigPath, `${JSON.stringify(deployConfig, null, 2)}\n`);
  await run("pnpm", ["exec", "wrangler", "deploy"], {
    cwd,
    env: process.env,
  });
}

function parseCliArgs(args) {
  let envFile = ".env.prod";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    envFile = arg;
  }

  return envFile;
}

async function loadBuiltConfig(filePath) {
  const text = await readFile(filePath, "utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid built Wrangler config: ${filePath}`);
  }
  return parsed;
}

function pickVars(envValues, names) {
  const selected = {};
  for (const name of names) {
    const value = envValues[name];
    if (value !== undefined) selected[name] = value;
  }
  return selected;
}

function validateRequired(selected, names, label) {
  const missing = names.filter((name) => !(name in selected));
  if (missing.length) {
    throw new Error(`Missing ${label}: ${missing.join(", ")}`);
  }
}

async function loadEnvFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    values[key] = unquote(rawValue);
  }
  return values;
}

function unquote(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
