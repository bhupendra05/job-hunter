// Tiny JSON-file persistence. No DB, no native deps — just two files under data/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const PROFILE_FILE = join(DATA_DIR, "profile.json");
const APPS_FILE = join(DATA_DIR, "applications.json");

async function ensureDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDir();
  await writeFile(file, JSON.stringify(data, null, 2));
}

export const getProfile = () => readJson(PROFILE_FILE, null);
export const saveProfile = (profile) => writeJson(PROFILE_FILE, profile);

export const getApplications = () => readJson(APPS_FILE, []);

export async function upsertApplication(app) {
  const apps = await getApplications();
  const idx = apps.findIndex((a) => a.id === app.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    apps[idx] = { ...apps[idx], ...app, updatedAt: now };
  } else {
    apps.push({ status: "saved", createdAt: now, updatedAt: now, ...app });
  }
  await writeJson(APPS_FILE, apps);
  return apps;
}

export async function updateApplication(id, patch) {
  const apps = await getApplications();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  apps[idx] = { ...apps[idx], ...patch, updatedAt: new Date().toISOString() };
  await writeJson(APPS_FILE, apps);
  return apps[idx];
}

export async function deleteApplication(id) {
  const apps = await getApplications();
  const next = apps.filter((a) => a.id !== id);
  await writeJson(APPS_FILE, next);
  return next;
}
