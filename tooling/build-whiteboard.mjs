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
  plugins: [offlineExcalidrawFonts],
});

const metadataDir = path.join(root, "build");
await mkdir(metadataDir, { recursive: true });
const metadataPath = path.join(metadataDir, "whiteboard.meta.json");
await writeFile(metadataPath, JSON.stringify(result.metafile, null, 2));
