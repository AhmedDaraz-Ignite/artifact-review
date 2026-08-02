import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(
  root,
  "skills",
  "artifact-review",
  "assets",
  "review-ui",
);

const offlineExcalidrawFonts = {
  name: "offline-excalidraw-fonts",
  setup(buildContext) {
    const externalFallbackPrefix = "`https://esm.sh/${";
    const localFallbackPrefix = "`${window.location.origin}/${";
    let transformedFallbacks = 0;
    let transformedFontReferences = 0;

    buildContext.onLoad(
      {
        filter:
          /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].+\.js$/,
      },
      async ({ path: sourcePath }) => {
        const source = await readFile(sourcePath, "utf8");
        if (!source.includes(externalFallbackPrefix)) {
          return null;
        }

        const fallbackCount =
          source.split(externalFallbackPrefix).length - 1;
        if (fallbackCount !== 1) {
          throw new Error(
            `Expected one Excalidraw font fallback, found ${fallbackCount}`,
          );
        }

        const fontPattern = /(["'])\.\/fonts\/([^"']+\.woff2)\1/g;
        const fontMatches = [...source.matchAll(fontPattern)];
        if (!fontMatches.length) {
          throw new Error("Excalidraw font assets were not found");
        }

        transformedFallbacks += fallbackCount;
        transformedFontReferences += fontMatches.length;
        const replacements = new Map();
        for (const match of fontMatches) {
          const relativeFontPath = match[2];
          if (replacements.has(relativeFontPath)) {
            continue;
          }

          // Xiaolai's 209 shards exceed the complete skill size budget. The
          // local protocol makes Excalidraw use the browser's CJK fallback
          // without creating a network URL. All smaller fonts stay exact.
          if (relativeFontPath.startsWith("Xiaolai/")) {
            replacements.set(
              relativeFontPath,
              `local://fonts/${relativeFontPath}`,
            );
            continue;
          }

          const fontPath = path.join(
            path.dirname(sourcePath),
            "fonts",
            relativeFontPath,
          );
          const font = await readFile(fontPath);
          replacements.set(
            relativeFontPath,
            `data:font/woff2;base64,${font.toString("base64")}`,
          );
        }

        let contents = source.replace(
          fontPattern,
          (literal, quote, relativeFontPath) =>
            `${quote}${replacements.get(relativeFontPath)}${quote}`,
        );
        contents = contents.replace(
          externalFallbackPrefix,
          localFallbackPrefix,
        );

        return {
          contents,
          loader: "js",
          resolveDir: path.dirname(sourcePath),
        };
      },
    );

    buildContext.onEnd(() => {
      if (transformedFallbacks !== 1 || transformedFontReferences === 0) {
        return {
          errors: [{
            text:
              "Excalidraw's offline font transform did not match the " +
              "expected production bundle",
          }],
        };
      }
      return undefined;
    });
  },
};

const mermaidERSelectorCompatibility = {
  name: "mermaid-er-selector-compatibility",
  setup(buildContext) {
    let transformedSelectors = 0;

    buildContext.onLoad(
      {
        filter:
          /@excalidraw[\\/]mermaid-to-excalidraw[\\/]dist[\\/]parser[\\/]er\.js$/,
      },
      async ({ path: sourcePath }) => {
        let contents = await readFile(sourcePath, "utf8");
        const replacements = [
          [
            'const directPath = containerEl.querySelector(`path[id="${edge.id}"][data-edge="true"]`);',
            'const directPath = containerEl.querySelector(`path[data-edge="true"][data-id="${edge.id}"]`) ||\n' +
              '        containerEl.querySelector(`path[id="${edge.id}"][data-edge="true"]`);',
          ],
          [
            '.map((pathId) => containerEl.querySelector(`path[id="${pathId}"][data-edge="true"]`))',
            '.map((pathId) => containerEl.querySelector(`path[data-edge="true"][data-id="${pathId}"]`) ||\n' +
              '        containerEl.querySelector(`path[id="${pathId}"][data-edge="true"]`))',
          ],
          [
            'const domNode = containerEl.querySelector(`[id="${entity.id}"]`);',
            'const svgId = containerEl.querySelector("svg")?.id;\n' +
              '    const domNode = containerEl.querySelector(`[id="${entity.id}"]`) ||\n' +
              '        (svgId && containerEl.querySelector(`[id="${svgId}-${entity.id}"]`));',
          ],
        ];

        for (const [original, replacement] of replacements) {
          const matches = contents.split(original).length - 1;
          if (matches !== 1) {
            throw new Error(
              "Expected one Mermaid ER selector compatibility target, " +
                `found ${matches}`,
            );
          }
          contents = contents.replace(original, replacement);
          transformedSelectors += matches;
        }

        return {
          contents,
          loader: "js",
          resolveDir: path.dirname(sourcePath),
        };
      },
    );

    buildContext.onEnd(() => {
      if (transformedSelectors !== 3) {
        return {
          errors: [{
            text:
              "Mermaid's ER selector compatibility transform did not match " +
              "the expected converter source",
          }],
        };
      }
      return undefined;
    });
  },
};

// Mermaid 11 prefixes every rendered DOM id with the svg id ("<svgId>-S"),
// while the converter still looks elements up by the id alone. Each miss
// makes a supported diagram silently fall back to a flat image.
const mermaid11IdPrefixCompatibility = {
  name: "mermaid-11-id-prefix-compatibility",
  setup(buildContext) {
    const patches = [
      {
        filter:
          /@excalidraw[\\/]mermaid-to-excalidraw[\\/]dist[\\/]parser[\\/]flowchart\.js$/,
        replacements: [
          [
            "    const el = containerEl.querySelector(`[id='${data.id}']`);",
            "    const svgId = containerEl.querySelector(\"svg\")?.id;\n" +
              "    const el = containerEl.querySelector(`[id='${data.id}']`) ||\n" +
              "        (svgId ? containerEl.querySelector(`[id='${svgId}-${data.id}']`) : null);",
          ],
        ],
      },
      {
        filter:
          /@excalidraw[\\/]mermaid-to-excalidraw[\\/]dist[\\/]parser[\\/]state\.js$/,
        replacements: [
          [
            "        const selectors = [\n" +
              "            `[id='${node.domId}']`,\n" +
              "            `[id='${node.id}']`,\n" +
              "            `[data-id='${node.id}']`,\n" +
              "        ];",
            "        const svgId = containerEl.querySelector(\"svg\")?.id;\n" +
              "        const selectors = [\n" +
              "            `[id='${node.domId}']`,\n" +
              "            `[id='${node.id}']`,\n" +
              "            `[data-id='${node.id}']`,\n" +
              "            ...(svgId\n" +
              "                ? [`[id='${svgId}-${node.domId}']`, `[id='${svgId}-${node.id}']`]\n" +
              "                : []),\n" +
              "        ];",
          ],
          [
            "    const edgeEl = containerEl.querySelector(`[id='${edge.id}']`);",
            "    const svgId = containerEl.querySelector(\"svg\")?.id;\n" +
              "    const edgeEl = containerEl.querySelector(`[id='${edge.id}']`) ||\n" +
              "        (svgId ? containerEl.querySelector(`[id='${svgId}-${edge.id}']`) : null) ||\n" +
              "        containerEl.querySelector(`path[data-id='${edge.id}']`);",
          ],
        ],
      },
      {
        filter:
          /@excalidraw[\\/]mermaid-to-excalidraw[\\/]dist[\\/]parser[\\/]class\.js$/,
        replacements: [
          [
            "            const regex = new RegExp(`^classId-${id}(?:-|$)`);",
            "            const regex = new RegExp(`(?:^|-)classId-${id}(?:-|$)`);",
          ],
        ],
      },
    ];

    let applied = 0;
    const expected = patches.reduce(
      (count, patch) => count + patch.replacements.length,
      0,
    );
    for (const patch of patches) {
      buildContext.onLoad({ filter: patch.filter }, async ({ path: sourcePath }) => {
        let contents = await readFile(sourcePath, "utf8");
        for (const [original, replacement] of patch.replacements) {
          const matches = contents.split(original).length - 1;
          if (matches !== 1) {
            throw new Error(
              "Expected one Mermaid 11 id-prefix compatibility target in " +
                `${sourcePath}, found ${matches}`,
            );
          }
          contents = contents.replace(original, replacement);
          applied += 1;
        }
        return {
          contents,
          loader: "js",
          resolveDir: path.dirname(sourcePath),
        };
      });
    }

    buildContext.onEnd(() => {
      if (applied !== expected) {
        return {
          errors: [{
            text:
              "Mermaid 11 id-prefix compatibility patched " +
              `${applied} of ${expected} targets`,
          }],
        };
      }
      return undefined;
    });
  },
};

const result = await build({
  entryPoints: [path.join(root, "tooling", "whiteboard-entry.mjs")],
  outfile: path.join(outdir, "whiteboard.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["production"],
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  metafile: true,
  loader: {
    ".png": "dataurl",
    ".svg": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".ttf": "dataurl"
  },
  define: {
    "process.env.NODE_ENV": "\"production\""
  },
  plugins: [
    offlineExcalidrawFonts,
    mermaidERSelectorCompatibility,
    mermaid11IdPrefixCompatibility,
  ],
});

await build({
  entryPoints: [path.join(root, "tooling", "mermaid-entry.mjs")],
  outfile: path.join(outdir, "mermaid.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["production"],
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  loader: {
    ".png": "dataurl",
    ".svg": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
    ".ttf": "dataurl"
  },
  define: {
    "process.env.NODE_ENV": "\"production\""
  },
});

const metadataDir = path.join(root, "build");
await mkdir(metadataDir, { recursive: true });
const metadataPath = path.join(metadataDir, "whiteboard.meta.json");
await writeFile(metadataPath, JSON.stringify(result.metafile, null, 2));
