import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(
  await readFile(path.join(root, "build", "whiteboard.meta.json"), "utf8"),
);

const packageRoots = new Set();
for (const input of Object.keys(metadata.inputs)) {
  const segments = input.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== "node_modules") continue;
    const first = segments[index + 1];
    if (!first) continue;
    const packageSegments = first.startsWith("@")
      ? [first, segments[index + 2]]
      : [first];
    if (packageSegments.every(Boolean)) {
      packageRoots.add(path.join(root, "node_modules", ...packageSegments));
    }
  }
}

const legalFileNames = new Set([
  "license",
  "license.md",
  "license.txt",
  "licence",
  "copying",
  "notice",
]);
const packages = [];

for (const packageRoot of [...packageRoots].sort()) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    );
  } catch {
    continue;
  }
  const licenseTexts = [];
  let legalFiles = [];
  try {
    legalFiles = (await readdir(packageRoot, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() && legalFileNames.has(entry.name.toLowerCase()),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    // The package manifest is enough to retain metadata if listing fails.
  }
  for (const candidate of legalFiles) {
    try {
      const text = await readFile(path.join(packageRoot, candidate), "utf8");
      licenseTexts.push({
        candidate,
        text: text.replace(/\r\n?/g, "\n").trim(),
      });
    } catch {
      // Packages are allowed to declare a license without shipping its text.
    }
  }
  packages.push({
    name: manifest.name,
    version: manifest.version,
    license: manifest.license || "See package metadata",
    repository:
      typeof manifest.repository === "string"
        ? manifest.repository
        : manifest.repository?.url || "",
    licenseTexts,
  });
}

const sections = packages.map((pkg) => {
  const heading = `${pkg.name}@${pkg.version}`;
  const metadataLines = [
    `License: ${pkg.license}`,
    pkg.repository ? `Source: ${pkg.repository}` : null,
  ].filter(Boolean);
  const texts = pkg.licenseTexts.length
    ? pkg.licenseTexts
        .map(({ candidate, text }) => `--- ${candidate} ---\n${text}`)
        .join("\n\n")
    : "The package did not include a standalone license file in its npm payload.";
  return `${heading}\n${"=".repeat(heading.length)}\n${metadataLines.join("\n")}\n\n${texts}`;
});

const notice = [
  "Artifact Review — Third-Party Notices",
  "=====================================",
  "",
  "The generated offline whiteboard bundle contains the packages listed below.",
  "License comments are also preserved at the end of whiteboard.js.",
  "",
  ...sections,
  "",
].join("\n");

await writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), notice);
await writeFile(
  path.join(
    root,
    "skills",
    "artifact-review",
    "THIRD_PARTY_NOTICES.txt",
  ),
  notice,
);

console.log(`Wrote notices for ${packages.length} bundled packages.`);
