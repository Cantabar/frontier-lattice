import { ENVIRONMENTS, SUISCAN_BASE } from "./lib/config.js";
import { parsePublishedToml } from "./lib/toml-parser.js";
import { readUpgradeCap } from "./lib/sui-rpc.js";
import {
  fetchPublishedToml,
  fetchReleases,
  fetchPublishedTomlCommits,
  fetchCommitsSinceAnchor,
  fetchCompare,
  fetchFileAtRef,
  setGithubToken,
} from "./lib/github.js";

// ── DOM refs ────────────────────────────────────────────────────────
const $loading = document.getElementById("loading");
const $error = document.getElementById("error");
const $envGrid = document.getElementById("environments");
const $releasesSection = document.getElementById("releases-section");
const $releases = document.getElementById("releases");
const $lastUpdated = document.getElementById("last-updated");
const $refreshBtn = document.getElementById("refresh-btn");

// ── Bootstrap ───────────────────────────────────────────────────────
$refreshBtn.addEventListener("click", () => refresh());
refresh();

// ── Main refresh loop ───────────────────────────────────────────────
async function refresh() {
  $loading.classList.remove("hidden");
  $error.classList.add("hidden");
  $envGrid.innerHTML = "";
  $releasesSection.classList.add("hidden");

  try {
    // 1. Fetch Published.toml + parse
    const tomlText = await fetchPublishedToml();
    const published = parsePublishedToml(tomlText);

    // 2. Read on-chain UpgradeCap for each environment (in parallel)
    const chainData = await Promise.all(
      ENVIRONMENTS.map(async (env) => {
        const pub = published[env.key];
        if (!pub?.["upgrade-capability"]) return null;
        try {
          return await readUpgradeCap(pub["upgrade-capability"]);
        } catch (err) {
          console.warn(`Failed to read UpgradeCap for ${env.key}:`, err);
          return null;
        }
      }),
    );

    // 3. Fetch commits that touched Published.toml
    const tomlCommits = await fetchPublishedTomlCommits(10);

    // 4. Build per-environment version history by reading Published.toml
    //    at each commit to find when each env's version changed.
    const envVersionHistory = await buildEnvVersionHistory(tomlCommits);

    // 5. For each environment, fetch diffs between its version transitions
    //    and pending commits since its last deploy.
    const envDiffData = {};
    for (const env of ENVIRONMENTS) {
      const history = envVersionHistory[env.key] ?? [];
      envDiffData[env.key] = { versionDiffs: [], pendingCommits: [] };

      // Diffs between version transitions (e.g. v1→v2)
      for (const transition of history) {
        try {
          const diff = await fetchCompare(transition.fromSha, transition.toSha);
          if (diff) {
            envDiffData[env.key].versionDiffs.push({
              fromVersion: transition.fromVersion,
              toVersion: transition.toVersion,
              from: transition.fromCommit,
              to: transition.toCommit,
              diff,
            });
          }
        } catch { /* non-critical */ }
      }

      // Pending source commits since this env's last deploy
      const lastDeploySha = history.length > 0
        ? history[0].toSha                    // most recent version bump
        : envVersionHistory[`${env.key}_initial`];  // initial publish
      if (lastDeploySha) {
        try {
          envDiffData[env.key].pendingCommits = await fetchCommitsSinceAnchor(lastDeploySha);
        } catch { /* non-critical */ }
      }
    }

    // 6. Fetch releases
    let releases = [];
    try {
      releases = await fetchReleases();
    } catch {
      /* non-critical */
    }

    // 7. Render everything
    for (let i = 0; i < ENVIRONMENTS.length; i++) {
      const env = ENVIRONMENTS[i];
      const pub = published[env.key];
      const chain = chainData[i];
      const diffData = envDiffData[env.key];
      $envGrid.appendChild(await renderEnvCard(env, pub, chain, tomlCommits, diffData));
    }

    renderReleases(releases);
    $lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    $error.textContent = err.message;
    $error.classList.remove("hidden");
    console.error(err);
  } finally {
    $loading.classList.add("hidden");
  }
}

// ── Per-environment version history ───────────────────────────────

/**
 * Walk the Published.toml commit history and, for each environment, find
 * the commits where that env's version number changed. Returns:
 *   { "testnet_stillness": [ { fromVersion, toVersion, fromSha, toSha, fromCommit, toCommit } ],
 *     "testnet_stillness_initial": "<sha>",   // commit that first introduced this env
 *     ... }
 */
async function buildEnvVersionHistory(tomlCommits) {
  const TOML_PATH = "contracts/world/Published.toml";

  // Read Published.toml at each commit (newest first)
  const snapshots = [];  // { commit, parsed }
  for (const commit of tomlCommits) {
    try {
      const text = await fetchFileAtRef(TOML_PATH, commit.sha);
      if (text) {
        snapshots.push({ commit, parsed: parsePublishedToml(text) });
      }
    } catch {
      // File might not exist at very old commits
    }
  }

  const result = {};

  for (const env of ENVIRONMENTS) {
    const transitions = [];

    for (let i = 0; i < snapshots.length - 1; i++) {
      const newer = snapshots[i];
      const older = snapshots[i + 1];
      const newerVer = newer.parsed[env.key]?.version;
      const olderVer = older.parsed[env.key]?.version;

      // Skip if this env doesn't exist in either snapshot
      if (newerVer == null) continue;

      // Version changed between these two commits
      if (newerVer !== olderVer && olderVer != null) {
        transitions.push({
          fromVersion: olderVer,
          toVersion: newerVer,
          fromSha: older.commit.sha,
          toSha: newer.commit.sha,
          fromCommit: older.commit,
          toCommit: newer.commit,
        });
      }
    }

    result[env.key] = transitions;

    // Record the initial publish commit (oldest commit where this env appears)
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].parsed[env.key]?.version != null) {
        result[`${env.key}_initial`] = snapshots[i].commit.sha;
        break;
      }
    }
  }

  return result;
}

// ── Field descriptions (shown as tooltips) ─────────────────────────
const FIELD_TIPS = {
  "Repo version":
    "The package version recorded in Published.toml on the main branch. " +
    "Increments by 1 each time a \"sui client upgrade\" is performed and committed.",
  "On-chain version":
    "The live version stored in the UpgradeCap object on SUI testnet. " +
    "Set by the chain itself when an upgrade transaction is executed. " +
    "If this differs from repo version, either an upgrade is pending or Published.toml is stale.",
  Toolchain:
    "The sui CLI version (e.g. 1.68.0) used to compile and publish/upgrade the package. " +
    "Mismatches between environments may indicate staggered rollouts.",
};

// ── Render: environment card ────────────────────────────────────────
async function renderEnvCard(env, pub, chain, tomlCommits, diffData) {
  const card = el("div", "env-card");

  // Status
  const repoVersion = pub?.version ?? "?";
  const chainVersion = chain?.version ?? "?";
  const status = getStatus(repoVersion, chainVersion);

  // Header
  const header = el("div", "env-card-header");
  header.appendChild(elText("h2", env.label));
  header.appendChild(badge(status));
  card.appendChild(header);

  // Key-value grid
  const kv = el("div", "kv-table");
  addKV(kv, "Repo version", String(repoVersion), FIELD_TIPS["Repo version"]);
  addKV(kv, "On-chain version", String(chainVersion), FIELD_TIPS["On-chain version"]);
  addKV(kv, "Original ID", pub?.["original-id"] ?? "—");
  addKV(kv, "Published at", pub?.["published-at"] ?? "—");

  if (pub?.["upgrade-capability"]) {
    const capLink = document.createElement("a");
    capLink.href = `${SUISCAN_BASE}/object/${pub["upgrade-capability"]}`;
    capLink.target = "_blank";
    capLink.textContent = pub["upgrade-capability"];
    capLink.className = "kv-value";

    const capLabel = elText("span", "UpgradeCap");
    capLabel.className = "kv-label";
    kv.appendChild(capLabel);
    kv.appendChild(capLink);
  }

  if (chain) {
    addKV(kv, "Chain package", chain.package);
    const policyLabels = { 0: "compatible", 128: "additive", 192: "dep-only", 255: "immutable" };
    addKV(kv, "Upgrade policy", policyLabels[chain.policy] ?? String(chain.policy));
  }

  addKV(kv, "Toolchain", pub?.["toolchain-version"] ?? "—", FIELD_TIPS["Toolchain"]);
  card.appendChild(kv);

  // Per-environment version upgrade diffs
  if (diffData.versionDiffs.length > 0) {
    for (const vd of diffData.versionDiffs) {
      card.appendChild(await renderDeployDiff(vd.from, vd.to, vd.diff,
        `v${vd.fromVersion} → v${vd.toVersion}`));
    }
  }

  // Deploy commits (most recent Published.toml touches)
  if (tomlCommits.length > 0) {
    card.appendChild(commitDetails("Recent deploy commits", tomlCommits));
  }

  // Pending source changes since this env's last deploy
  const { pendingCommits } = diffData;
  if (pendingCommits.length > 0) {
    card.appendChild(commitDetails(
      `${pendingCommits.length} source commit${pendingCommits.length === 1 ? "" : "s"} since last deploy to ${env.label}`,
      pendingCommits,
    ));
  }

  return card;
}

// ── Render: releases ────────────────────────────────────────────────
function renderReleases(releases) {
  if (releases.length === 0) return;
  $releasesSection.classList.remove("hidden");
  $releases.innerHTML = "";
  for (const r of releases) {
    const item = el("div", "release-item");
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = r.url;
    link.target = "_blank";
    link.textContent = `${r.name}`;
    h3.appendChild(link);
    item.appendChild(h3);
    item.appendChild(elText("div", r.date, "release-date"));
    if (r.body) {
      const body = el("div", "release-body");
      body.innerHTML = markdownToHtml(r.body);
      item.appendChild(body);
    }
    $releases.appendChild(item);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function getStatus(repoVersion, chainVersion) {
  if (repoVersion === "?" || chainVersion === "?") return "unknown";
  if (repoVersion === chainVersion) return "in-sync";
  if (repoVersion > chainVersion) return "repo-ahead";
  return "chain-ahead";
}

function badge(status) {
  const labels = {
    "in-sync": "In Sync",
    "repo-ahead": "Upgrade Pending",
    "chain-ahead": "Published.toml Stale",
    unknown: "Unknown",
  };
  const span = document.createElement("span");
  span.className = `badge badge-${status}`;
  span.textContent = labels[status];
  return span;
}

function commitDetails(summary, commits) {
  const details = document.createElement("details");
  details.appendChild(elText("summary", summary));
  const ul = el("ul", "commit-list");
  for (const c of commits) {
    const li = document.createElement("li");
    const shaLink = document.createElement("a");
    shaLink.href = c.url;
    shaLink.target = "_blank";
    shaLink.textContent = c.shortSha;
    shaLink.className = "commit-sha";
    li.appendChild(elText("span", c.date, "commit-date"));
    li.appendChild(shaLink);
    li.appendChild(elText("span", c.message));
    ul.appendChild(li);
  }
  details.appendChild(ul);
  return details;
}

// ── Render: deploy diff ─────────────────────────────────────────────
async function renderDeployDiff(from, to, diff, versionLabel) {
  const sourceFiles = diff.files.filter((f) =>
    f.filename.startsWith("contracts/world/sources/"),
  );
  if (sourceFiles.length === 0 && diff.files.length === 0) return el("div");

  const fileCount = sourceFiles.length > 0 ? sourceFiles.length : diff.totalChanges;
  const fileWord = sourceFiles.length > 0 ? "source files" : "files";
  const prefix = versionLabel ? `Upgrade ${versionLabel}` : "Diff";
  const label = `${prefix}: ${from.shortSha} → ${to.shortSha} (${diff.commits} commits, ${fileCount} ${fileWord})`;

  const details = document.createElement("details");
  details.className = "diff-section";
  const summary = elText("summary", label);
  details.appendChild(summary);

  // Link to full diff on GitHub
  const ghLink = document.createElement("a");
  ghLink.href = diff.url;
  ghLink.target = "_blank";
  ghLink.textContent = "View full diff on GitHub ↗";
  ghLink.className = "diff-gh-link";
  details.appendChild(ghLink);

  // File list — each row links to the per-file diff on GitHub
  const filesToShow = sourceFiles.length > 0 ? sourceFiles : diff.files;
  const list = el("div", "diff-file-list");

  for (const file of filesToShow) {
    const row = el("div", "diff-file-row");

    const statusBadge = elText("span", file.status, `diff-status diff-status-${file.status}`);
    row.appendChild(statusBadge);

    // Link the filename directly to the per-file diff on GitHub
    const fileLink = document.createElement("a");
    const anchor = await sha256Hex(file.filename);
    fileLink.href = `${diff.url}#diff-${anchor}`;
    fileLink.target = "_blank";
    fileLink.textContent = file.filename;
    fileLink.className = "diff-filename";
    fileLink.title = "View highlighted diff on GitHub";
    row.appendChild(fileLink);

    const stats = elText("span",
      `+${file.additions} −${file.deletions}`,
      "diff-stats");
    row.appendChild(stats);

    list.appendChild(row);
  }

  details.appendChild(list);
  return details;
}

/**
 * Compute the SHA-256 hex digest that GitHub uses for per-file diff anchors.
 * GitHub's anchor format: #diff-{sha256hex(filename)}
 */
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Minimal markdown → HTML (handles **bold**, `code`, - lists, [links](url)) */
function markdownToHtml(md) {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n/g, "<br>");
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function elText(tag, text, className) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}

function addKV(parent, label, value, tooltip) {
  const labelEl = elText("span", label, "kv-label");
  if (tooltip) {
    labelEl.title = tooltip;
    labelEl.classList.add("has-tip");
  }
  parent.appendChild(labelEl);
  parent.appendChild(elText("span", value, "kv-value"));
}
