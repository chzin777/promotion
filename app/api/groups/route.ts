import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export type WaGroup = { id: string; subject: string };

/** Le a lista de grupos que o worker dumpou ao conectar no WhatsApp. */
function readGroups(): { groups: WaGroup[]; updatedAt: string | null } {
  try {
    const file = path.join(
      process.cwd(),
      "backend",
      "worker",
      "data",
      ".wa-groups.json",
    );
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const groups: WaGroup[] = Array.isArray(data?.groups)
      ? data.groups
          .filter((g: unknown) => g && typeof (g as WaGroup).id === "string")
          .map((g: WaGroup) => ({ id: g.id, subject: String(g.subject ?? "") }))
      : [];
    return { groups, updatedAt: data?.updatedAt ?? null };
  } catch {
    return { groups: [], updatedAt: null };
  }
}

export async function GET() {
  return NextResponse.json(readGroups());
}
