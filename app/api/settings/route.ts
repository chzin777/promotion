import { NextResponse } from "next/server";
import { readQueueStats } from "@/lib/queue-stats";
import {
  readSettingsFile,
  writeSettingsFile,
  type AppSettings,
} from "@/lib/settings";

export async function GET() {
  const settings = readSettingsFile();
  const status = readQueueStats();
  return NextResponse.json({ settings, status });
}

export async function PATCH(req: Request) {
  const current = readSettingsFile();
  let body: Partial<AppSettings>;
  try {
    body = (await req.json()) as Partial<AppSettings>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (current.automationRunning) {
    const keys = Object.keys(body);
    const onlyStop =
      keys.length === 1 &&
      keys[0] === "automationRunning" &&
      body.automationRunning === false;
    if (!onlyStop) {
      return NextResponse.json(
        { error: "Pare a automação para editar as configurações." },
        { status: 423 },
      );
    }
  }

  const settings = writeSettingsFile(body);
  const status = readQueueStats();
  return NextResponse.json({ settings, status });
}
