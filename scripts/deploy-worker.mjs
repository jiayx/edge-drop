import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  const wranglerPath = path.resolve(cwd, "wrangler.toml");

  const [envValues, wranglerText] = await Promise.all([
    loadEnvFile(envPath),
    readFile(wranglerPath, "utf8"),
  ]);

  const baseVars = readTomlVars(wranglerText);
  const envOverrides = pickVars(envValues, DEPLOY_VAR_NAMES);
  const deployVars = { ...baseVars, ...envOverrides };
  validateRequired(deployVars, REQUIRED_DEPLOY_VAR_NAMES, "deploy vars");

  await run("pnpm", ["build"], { cwd, env: process.env });

  const tempDir = await mkdtemp(path.join(tmpdir(), "edge-drop-deploy-"));
  try {
    const tempConfigPath = path.join(tempDir, "wrangler.deploy.toml");
    const deployConfig = buildDeployConfig(wranglerText, deployVars, cwd);
    await writeFile(tempConfigPath, deployConfig);
    await run(
      "pnpm",
      ["exec", "wrangler", "deploy", "--cwd", cwd, "--config", tempConfigPath],
      {
        cwd,
        env: process.env,
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

function buildDeployConfig(wranglerText, deployVars, rootDir) {
  const normalizedConfig = normalizeConfigPaths(wranglerText, rootDir);
  const withoutVars = normalizedConfig.replace(
    /\n\[vars\]\n(?:.*\n)*(?=\n\[[^\]]+\]|\n\[\[[^\]]+\]\]|$)/m,
    "\n",
  );
  const varsBlock = [
    "[vars]",
    ...Object.entries(deployVars).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    "",
  ].join("\n");
  return `${withoutVars.trimEnd()}\n\n${varsBlock}`;
}

function normalizeConfigPaths(wranglerText, rootDir) {
  return wranglerText
    .replace(/^main\s*=\s*(".*?"|'.*?')\s*$/m, (line, rawValue) => {
      return `main = ${JSON.stringify(resolveConfigPath(rawValue, rootDir))}`;
    })
    .replace(/^directory\s*=\s*(".*?"|'.*?')\s*$/m, (line, rawValue) => {
      return `directory = ${JSON.stringify(resolveConfigPath(rawValue, rootDir))}`;
    });
}

function resolveConfigPath(rawValue, rootDir) {
  const value = unquote(rawValue);
  if (!value || path.isAbsolute(value)) return value;
  return path.resolve(rootDir, value);
}

function readTomlVars(wranglerText) {
  const match = wranglerText.match(/(?:^|\n)\[vars\]\n((?:.*\n)*?)(?=\n\[[^\]]+\]|\n\[\[[^\]]+\]\]|$)/m);
  if (!match) return {};

  const values = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
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
