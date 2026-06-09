import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { readSettingsFile } from "./settings";

type Item = {
  link: string;
  productUrl?: string | null;
};

type WorkerState = {
  sent: string[];
  sentProducts: string[];
};

export type QueueStats = {
  remainingTotal: number;
  remainingMl: number;
  remainingAmazon: number;
  remainingShopee: number;
  sentCount: number;
  amazonTagConfigured: boolean;
  waGroupId: string;
  waGroupName: string;
  waConnected: boolean;
};

function workerDataDir(): string {
  return path.join(process.cwd(), "backend", "worker", "data");
}

/** Id do grupo no .env (WHATSAPP_GROUP_ID). */
function readGroupIdFromEnv(): string {
  try {
    const env = fs.readFileSync(path.join(process.cwd(), "backend", "worker", ".env"), "utf8");
    return env.match(/^WHATSAPP_GROUP_ID=(.*)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Status do WhatsApp gravado pelo worker ao conectar (nome do grupo + conexao). */
function readWaStatus(dataDir: string): { groupName: string; connected: boolean } {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, ".wa-status.json"), "utf8"));
    return { groupName: String(s.groupName ?? ""), connected: Boolean(s.connected) };
  } catch {
    return { groupName: "", connected: false };
  }
}

function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function linkKey(link: string): string {
  let s = link.trim();
  try {
    const u = new URL(s);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith("utm_") || k === "ref" || k.startsWith("pf_rd_") || k.startsWith("pd_rd_")) {
        u.searchParams.delete(k);
      }
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    s = u.toString();
  } catch {
    /* ok */
  }
  return s;
}

function asin(url: string): string {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : "";
}

function productKey(link: string, productUrl?: string | null): string {
  for (const src of [productUrl?.trim(), link.trim()].filter(Boolean) as string[]) {
    const ml = src.match(/\/p\/(MLB\d+)/i);
    if (ml) return ml[1].toUpperCase();
    const a = asin(src);
    if (a) return a;
  }
  return linkKey(link);
}

function readWorkerState(dataDir: string): WorkerState {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, ".state.json"), "utf8"));
    return {
      sent: Array.isArray(s.sent) ? s.sent.map((x: unknown) => linkKey(String(x))) : [],
      sentProducts: Array.isArray(s.sentProducts) ? s.sentProducts.map(String) : [],
    };
  } catch {
    return { sent: [], sentProducts: [] };
  }
}

function wasSent(it: Item, state: WorkerState): boolean {
  const lk = linkKey(it.link);
  const pk = productKey(it.link, it.productUrl);
  return state.sent.includes(lk) || state.sentProducts.includes(pk);
}

function isMlLink(link: string, productUrl?: string | null): boolean {
  return /meli\.|mercadolivre/i.test(`${link} ${productUrl ?? ""}`);
}

function isAmazonLink(link: string, productUrl?: string | null): boolean {
  return /amazon\.com/i.test(`${link} ${productUrl ?? ""}`);
}

function isShopeeLink(link: string, productUrl?: string | null): boolean {
  return /shopee\.com|s\.shopee\./i.test(`${link} ${productUrl ?? ""}`);
}

function loadXlsx(file: string): Item[] {
  // arquivo pode estar travado (aberto no Excel) ou corrompido — nao derruba a API
  try {
    const wb = XLSX.readFile(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const items: Item[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((c) => (c == null ? "" : String(c).trim()));
      const link = cells.find((c) => /https?:\/\/\S+/i.test(c))?.match(/https?:\/\/\S+/i)?.[0];
      if (link) items.push({ link });
    }
    return items;
  } catch {
    return [];
  }
}

function loadTxt(file: string): Item[] {
  try {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const items: Item[] = [];
    let buf: string[] = [];
    for (const line of lines) {
      buf.push(line);
      const url = line.match(/https?:\/\/\S+/);
      if (url) {
        items.push({ link: url[0] });
        buf = [];
      }
    }
    return items;
  } catch {
    return [];
  }
}

function loadJson(date: string, dataDir: string): Item[] {
  const file = path.join(dataDir, `${date}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const items: Item[] = Array.isArray(data?.items) ? data.items : [];
    return items.filter((it: Item) => it.link?.trim());
  } catch {
    return [];
  }
}

function loadAutoQueue(dataDir: string): Item[] {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, "auto-queue.json"), "utf8"));
    return Array.isArray(data) ? data.filter((it: Item) => it.link?.trim()) : [];
  } catch {
    return [];
  }
}

function loadAllItems(dataDir: string): Item[] {
  const date = todayStr();
  let manual: Item[] = [];
  const xlsx = path.join(dataDir, "produtos.xlsx");
  const txt = path.join(dataDir, `${date}.txt`);
  if (fs.existsSync(xlsx)) manual = loadXlsx(xlsx);
  else if (fs.existsSync(txt)) manual = loadTxt(txt);
  else manual = loadJson(date, dataDir);

  const auto = loadAutoQueue(dataDir);
  return [...manual, ...auto].filter((it) => it.link?.trim());
}

function dedupePending(items: Item[], state: WorkerState): Item[] {
  const seenLinks = new Set<string>();
  const seenProducts = new Set<string>();
  const out: Item[] = [];
  for (const it of items) {
    if (wasSent(it, state)) continue;
    const lk = linkKey(it.link);
    const pk = productKey(it.link, it.productUrl);
    if (seenLinks.has(lk) || seenProducts.has(pk)) continue;
    seenLinks.add(lk);
    seenProducts.add(pk);
    out.push(it);
  }
  return out;
}

export function readQueueStats(): QueueStats {
  const dataDir = workerDataDir();
  const state = readWorkerState(dataDir);
  const pending = dedupePending(loadAllItems(dataDir), state);

  let remainingMl = 0;
  let remainingAmazon = 0;
  let remainingShopee = 0;
  for (const it of pending) {
    if (isMlLink(it.link, it.productUrl)) remainingMl++;
    else if (isAmazonLink(it.link, it.productUrl)) remainingAmazon++;
    else if (isShopeeLink(it.link, it.productUrl)) remainingShopee++;
  }

  const amazonTagConfigured = Boolean(readSettingsFile().amazonTag.trim());
  const wa = readWaStatus(dataDir);

  return {
    remainingTotal: pending.length,
    remainingMl,
    remainingAmazon,
    remainingShopee,
    sentCount: state.sent.length,
    amazonTagConfigured,
    waGroupId: readGroupIdFromEnv(),
    waGroupName: wa.groupName,
    waConnected: wa.connected,
  };
}
