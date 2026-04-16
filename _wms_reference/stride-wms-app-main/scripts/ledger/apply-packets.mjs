#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_LEDGER_PATH = "docs/LOCKED_DECISION_LEDGER.md";
const DEFAULT_LOG_PATH = "docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md";
const DEFAULT_PENDING_DIR = "docs/ledger/packets/pending";
const DEFAULT_APPLIED_DIR = "docs/ledger/packets/applied";

function parseArgs(argv) {
  const args = {
    ledger: DEFAULT_LEDGER_PATH,
    log: DEFAULT_LOG_PATH,
    pendingDir: DEFAULT_PENDING_DIR,
    appliedDir: DEFAULT_APPLIED_DIR,
    packet: [],
    moveApplied: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--ledger") {
      args.ledger = argv[++i];
    } else if (token === "--log") {
      args.log = argv[++i];
    } else if (token === "--pending-dir") {
      args.pendingDir = argv[++i];
    } else if (token === "--applied-dir") {
      args.appliedDir = argv[++i];
    } else if (token === "--packet") {
      args.packet.push(argv[++i]);
    } else if (token === "--no-move") {
      args.moveApplied = false;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--help" || token === "-h") {
      printHelpAndExit(0);
    } else {
      console.error(`Unknown argument: ${token}`);
      printHelpAndExit(1);
    }
  }

  return args;
}

function printHelpAndExit(code) {
  const help = `
Apply pending ledger packets into master ledger/log files.

Usage:
  node scripts/ledger/apply-packets.mjs [options]

Options:
  --ledger <path>       Master ledger path (default: ${DEFAULT_LEDGER_PATH})
  --log <path>          Master implementation log path (default: ${DEFAULT_LOG_PATH})
  --pending-dir <path>  Pending packets directory (default: ${DEFAULT_PENDING_DIR})
  --applied-dir <path>  Applied packets directory (default: ${DEFAULT_APPLIED_DIR})
  --packet <path>       Apply only this packet (repeatable)
  --no-move             Do not move processed packets to applied directory
  --dry-run             Show actions without writing files
  -h, --help            Show this help
`.trim();
  console.log(help);
  process.exit(code);
}

const DECISION_ID_RE = /^DL-\d{4}-\d{2}-\d{2}-\d{3}$/;
const EVENT_ID_RE = /^DLE-\d{4}-\d{2}-\d{2}-\d{3}$/;
const DETAIL_ENTRY_ID_RE = /^###\s+(DL-\d{4}-\d{2}-\d{2}-\d{3}):/;
const INDEX_HEADER_IDS = new Set(["Decision ID", "decision_id"]);
const LOG_HEADER_IDS = new Set(["Event ID", "event_id"]);

function extractRequiredSection(packetText, heading, packetPath) {
  const marker = `## ${heading}`;
  const startIdx = packetText.indexOf(marker);
  if (startIdx === -1) {
    throw new Error(`Packet missing required section "${marker}": ${packetPath}`);
  }
  const firstNewlineIdx = packetText.indexOf("\n", startIdx);
  if (firstNewlineIdx === -1) {
    return "";
  }
  const nextHeadingIdx = packetText.indexOf("\n## ", firstNewlineIdx + 1);
  const body =
    nextHeadingIdx === -1
      ? packetText.slice(firstNewlineIdx + 1)
      : packetText.slice(firstNewlineIdx + 1, nextHeadingIdx);
  return body.trim();
}

function validatePacketStructure({ packetPath, indexSection, detailSection, logSection }) {
  const rawIndexRows = extractTableRows(indexSection);
  const rawLogRows = extractTableRows(logSection);

  const indexIds = rawIndexRows.map(parseRowFirstCellId).filter(Boolean);
  const logIds = rawLogRows.map(parseRowFirstCellId).filter(Boolean);

  const indexDataIds = indexIds.filter((id) => !INDEX_HEADER_IDS.has(id));
  for (const id of indexDataIds) {
    if (!DECISION_ID_RE.test(id)) {
      throw new Error(`Invalid Decision Index row ID "${id}" in packet: ${packetPath}`);
    }
  }

  const logDataIds = logIds.filter((id) => !LOG_HEADER_IDS.has(id));
  for (const id of logDataIds) {
    if (!EVENT_ID_RE.test(id)) {
      throw new Error(`Invalid Implementation Log row ID "${id}" in packet: ${packetPath}`);
    }
  }

  const detailEntryIds = detailSection
    .split("\n")
    .map((line) => line.match(DETAIL_ENTRY_ID_RE)?.[1])
    .filter(Boolean);

  if (indexDataIds.length + logDataIds.length + detailEntryIds.length === 0) {
    throw new Error(`Packet contains no valid ledger IDs to apply: ${packetPath}`);
  }
}

function extractTableRows(sectionText) {
  return sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.startsWith("|---"));
}

function parseRowFirstCellId(row) {
  const match = row.match(/^\|\s*([^|]+?)\s*\|/);
  return match ? match[1].trim() : null;
}

function filterRowsByFirstCellIdPrefix(rows, prefix) {
  return rows.filter((row) => {
    const id = parseRowFirstCellId(row);
    return Boolean(id && id.startsWith(prefix));
  });
}

function splitDecisionEntries(sectionText) {
  const lines = sectionText.split("\n");
  const entries = [];
  let current = [];

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (current.length > 0) {
        entries.push(current.join("\n").trim());
      }
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    entries.push(current.join("\n").trim());
  }

  return entries.filter(Boolean);
}

function parseDecisionIdFromEntry(entry) {
  const firstLine = entry.split("\n")[0] || "";
  const match = firstLine.match(/^###\s+(DL-[^:]+):/);
  return match ? match[1].trim() : null;
}

function insertBeforeHeading(text, heading, blockToInsert) {
  const marker = `\n${heading}\n`;
  const idx = text.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Heading not found: ${heading}`);
  }
  const before = text.slice(0, idx).replace(/\s*$/, "");
  const after = text.slice(idx);
  return `${before}\n\n${blockToInsert.trim()}\n${after}`;
}

function updateLastUpdated(text, isoDate) {
  return text.replace(/^Last updated:\s+\d{4}-\d{2}-\d{2}$/m, `Last updated: ${isoDate}`);
}

async function listPendingPackets(pendingDir) {
  const entries = await fs.readdir(pendingDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .filter((entry) => entry.name.toLowerCase() !== "readme.md")
    .map((entry) => path.join(pendingDir, entry.name))
    .sort();
}

function dedupeIndexRows(rows, ledgerText) {
  const kept = [];
  const seen = new Set();
  for (const row of rows) {
    const id = parseRowFirstCellId(row);
    if (!id) {
      continue;
    }
    if (ledgerText.includes(`| ${id} |`)) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    kept.push(row);
  }
  return kept;
}

function dedupeLogRows(rows, logText) {
  const kept = [];
  const seen = new Set();
  for (const row of rows) {
    const id = parseRowFirstCellId(row);
    if (!id) {
      continue;
    }
    if (logText.includes(`| ${id} |`)) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    kept.push(row);
  }
  return kept;
}

function dedupeDecisionEntries(entries, ledgerText) {
  const kept = [];
  const seen = new Set();
  for (const entry of entries) {
    const id = parseDecisionIdFromEntry(entry);
    if (!id) {
      continue;
    }
    if (ledgerText.includes(`### ${id}:`)) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    kept.push(entry);
  }
  return kept;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);

  const packets =
    args.packet.length > 0
      ? args.packet.map((p) => path.normalize(p))
      : await listPendingPackets(args.pendingDir);

  if (packets.length === 0) {
    console.log("No pending packets found. Nothing to apply.");
    return;
  }

  let ledgerText = await fs.readFile(args.ledger, "utf8");
  let logText = await fs.readFile(args.log, "utf8");

  let changedLedger = false;
  let changedLog = false;

  const moveOps = [];

  for (const packetPath of packets) {
    const packetText = await fs.readFile(packetPath, "utf8");

    const indexSection = extractRequiredSection(packetText, "Decision Index Rows", packetPath);
    const detailSection = extractRequiredSection(packetText, "Detailed Decision Entries", packetPath);
    const logSection = extractRequiredSection(packetText, "Implementation Log Rows", packetPath);

    validatePacketStructure({ packetPath, indexSection, detailSection, logSection });

    const rawIndexRows = filterRowsByFirstCellIdPrefix(extractTableRows(indexSection), "DL-");
    const rawDetailEntries = splitDecisionEntries(detailSection).filter((entry) =>
      Boolean(parseDecisionIdFromEntry(entry)),
    );
    const rawLogRows = filterRowsByFirstCellIdPrefix(extractTableRows(logSection), "DLE-");

    const hasParseableContent =
      rawIndexRows.length > 0 || rawDetailEntries.length > 0 || rawLogRows.length > 0;

    const indexRows = dedupeIndexRows(rawIndexRows, ledgerText);
    const detailEntries = dedupeDecisionEntries(rawDetailEntries, ledgerText);
    const logRows = dedupeLogRows(rawLogRows, logText);

    if (indexRows.length > 0) {
      ledgerText = insertBeforeHeading(ledgerText, "## Detailed imports", `${indexRows.join("\n")}\n`);
      changedLedger = true;
    }

    if (detailEntries.length > 0) {
      const block = `\n${detailEntries.join("\n\n")}\n`;
      ledgerText = insertBeforeHeading(ledgerText, "## Decision entry template (copy/paste)", block);
      changedLedger = true;
    }

    if (logRows.length > 0) {
      logText = insertBeforeHeading(logText, "## Event template (copy/paste)", `${logRows.join("\n")}\n`);
      changedLog = true;
    }

    console.log(
      `Packet processed: ${packetPath} (index rows: ${indexRows.length}, entries: ${detailEntries.length}, log rows: ${logRows.length})`,
    );

    if (args.moveApplied && hasParseableContent) {
      const targetPath = path.join(args.appliedDir, path.basename(packetPath));
      moveOps.push({ from: packetPath, to: targetPath });
    } else if (args.moveApplied && !hasParseableContent) {
      console.warn(
        `Packet not moved (no parseable DL-/DLE- content found): ${packetPath} (index rows: ${rawIndexRows.length}, entries: ${rawDetailEntries.length}, log rows: ${rawLogRows.length})`,
      );
    }
  }

  if (changedLedger) {
    ledgerText = updateLastUpdated(ledgerText, today);
  }
  if (changedLog) {
    logText = updateLastUpdated(logText, today);
  }

  if (args.dryRun) {
    console.log("Dry run complete. No files were written.");
    return;
  }

  if (changedLedger) {
    await fs.writeFile(args.ledger, ledgerText, "utf8");
    console.log(`Updated ledger: ${args.ledger}`);
  }

  if (changedLog) {
    await fs.writeFile(args.log, logText, "utf8");
    console.log(`Updated implementation log: ${args.log}`);
  }

  if (args.moveApplied) {
    await ensureDir(args.appliedDir);
    for (const move of moveOps) {
      await fs.rename(move.from, move.to);
      console.log(`Moved packet to applied: ${move.to}`);
    }
  }

  if (!changedLedger && !changedLog) {
    console.log("No master updates required (all packet content already present).");
  }
}

main().catch((error) => {
  console.error("Failed to apply packets:", error.message);
  process.exit(1);
});
