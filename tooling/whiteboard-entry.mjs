/*
 * Artifact Review's offline Mermaid/Excalidraw bundle.
 *
 * The exports keep the controller-side compatibility surface. When the bundle
 * runs inside /whiteboard-frame it also boots the tokenless whiteboard UI.
 * The frame never performs HTTP requests; its opaque parent SDK relays typed
 * messages to the authenticated controller.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  exportToCanvas,
  exportToSvg,
  restore,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import "./whiteboard-frame.css";

export {
  React,
  createRoot,
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  parseMermaidToExcalidraw,
};

const SAVE_DEBOUNCE_MS = 800;
const TEXT_METRICS_VERSION = 1;

const deepCopy = value => JSON.parse(JSON.stringify(value));

function sanitizeAppState(appState = {}) {
  const zoomValue = Number(appState.zoom?.value);
  return {
    scrollX:Number.isFinite(Number(appState.scrollX)) ? Number(appState.scrollX) : 0,
    scrollY:Number.isFinite(Number(appState.scrollY)) ? Number(appState.scrollY) : 0,
    zoom:{ value:Number.isFinite(zoomValue) && zoomValue > 0 ? zoomValue : 1 },
    viewBackgroundColor:
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : "#ffffff",
  };
}

function duplicateIds(elements) {
  const seen = new Set();
  const duplicates = new Set();
  for (const element of elements) {
    if (!element?.id) continue;
    if (seen.has(element.id)) duplicates.add(element.id);
    seen.add(element.id);
  }
  return [...duplicates];
}

function imageFallback(elements) {
  const live = elements.filter(element => !element.isDeleted);
  return live.length === 1 && live[0]?.type === "image";
}

function classifySource(source) {
  const first = String(source || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith("%%")) || "";
  if (/^erDiagram\b/i.test(first)) return { id:"er", label:"ER diagram" };
  if (/^(?:flowchart|graph)\b/i.test(first)) return { id:"flowchart", label:"Flowchart" };
  if (/^sequenceDiagram\b/i.test(first)) return { id:"sequence", label:"Sequence diagram" };
  if (/^classDiagram\b/i.test(first)) return { id:"class", label:"Class diagram" };
  if (/^stateDiagram(?:-v2)?\b/i.test(first)) return { id:"state", label:"State diagram" };
  return { id:"other", label:"Mermaid diagram" };
}

function sceneStats(baseline, current) {
  const before = new Map(
    (baseline || []).filter(element => !element.isDeleted).map(element => [element.id, element]),
  );
  const after = new Map(
    (current || []).filter(element => !element.isDeleted).map(element => [element.id, element]),
  );
  let added = 0;
  let removed = 0;
  let moved = 0;
  let relabeled = 0;
  let drawn = 0;
  for (const [id, element] of after) {
    const original = before.get(id);
    if (!original) {
      added += 1;
      if (["line", "arrow", "freedraw", "rectangle", "ellipse", "diamond"].includes(element.type)) {
        drawn += 1;
      }
      continue;
    }
    if (
      Math.abs(Number(element.x) - Number(original.x)) > 1 ||
      Math.abs(Number(element.y) - Number(original.y)) > 1
    ) moved += 1;
    if (
      element.type === "text" &&
      String(element.text || "") !== String(original.text || "")
    ) relabeled += 1;
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed += 1;
  }
  return { added, removed, moved, relabeled, drawn };
}

async function blobBase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode PNG preview."));
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",")[1] || "";
}

function frameApp() {
  const params = new URL(location.href).searchParams;
  const channel = String(params.get("channel") || "");
  const diagramId = String(params.get("diagram") || "");
  if (!channel || !diagramId) {
    document.body.textContent = "The whiteboard channel is missing.";
    return;
  }

  const state = {
    api:null,
    initialized:false,
    source:"",
    currentSourceHash:"",
    sceneSourceHash:"",
    baselineElements:[],
    files:{},
    fallback:false,
    saveTimer:0,
    saveSequence:0,
    fullscreen:false,
    busy:false,
    root:null,
  };

  function post(message) {
    window.parent.postMessage(
      { arevFrame:true, channel, diagramId, ...message },
      "*",
    );
  }

  function element(tag, properties = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, properties);
    for (const child of children) node.append(child);
    return node;
  }

  function setStatus(text, tone = "") {
    const host = document.getElementById("wbStatus");
    if (!host) return;
    host.textContent = text;
    host.dataset.tone = tone;
  }

  function setBadge(text, fallback = false) {
    const badge = document.getElementById("wbTypeBadge");
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.fallback = String(fallback);
  }

  function setBanner(text, kind = "") {
    const banner = document.getElementById("wbBanner");
    if (!banner) return;
    banner.replaceChildren();
    banner.hidden = !text;
    banner.dataset.kind = kind;
    if (text) banner.append(document.createTextNode(text));
  }

  function buildShell() {
    const shell = element("main", { className:"wb-shell" });
    const header = element("header", { className:"wb-header" });
    const titleWrap = element("div", { className:"wb-title-wrap" });
    titleWrap.append(
      element("strong", { className:"wb-title", textContent:`Diagram · ${diagramId}` }),
      element("span", { id:"wbTypeBadge", className:"wb-type-badge", textContent:"Loading diagram…" }),
    );
    const status = element("span", {
      id:"wbStatus",
      className:"wb-save-status",
      textContent:"Loading…",
      role:"status",
      ariaLive:"polite",
    });
    const fullscreen = element("button", {
      id:"wbFullscreen",
      className:"wb-button",
      type:"button",
      textContent:"Fullscreen",
      title:"Expand this editor",
    });
    fullscreen.onclick = () => {
      state.fullscreen = !state.fullscreen;
      fullscreen.textContent = state.fullscreen ? "Exit fullscreen" : "Fullscreen";
      fullscreen.title = state.fullscreen ? "Return to inline editor" : "Expand this editor";
      post({ type:"fullscreen", enabled:state.fullscreen });
    };
    header.append(titleWrap, status, fullscreen);

    const banner = element("section", {
      id:"wbBanner",
      className:"wb-banner",
      role:"status",
      hidden:true,
    });
    const editor = element("section", {
      id:"wbEditor",
      className:"wb-editor",
      ariaLabel:"Editable diagram canvas",
    });
    const feedback = element("section", { className:"wb-feedback" });
    const label = element("label", {
      htmlFor:"wbSummary",
      textContent:"Describe your diagram change",
    });
    const summary = element("input", {
      id:"wbSummary",
      type:"text",
      placeholder:"For example: added a retry path and moved the database",
      autocomplete:"off",
    });
    const queue = element("button", {
      id:"wbQueue",
      className:"wb-button",
      type:"button",
      textContent:"Add to review",
    });
    const send = element("button", {
      id:"wbSend",
      className:"wb-button wb-primary",
      type:"button",
      textContent:"Send now",
    });
    queue.onclick = () => submit("queue");
    send.onclick = () => submit("send");
    summary.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        queue.click();
      }
    });
    feedback.append(label, summary, queue, send);
    shell.append(header, banner, editor, feedback);
    document.body.replaceChildren(shell);
  }

  function currentScene() {
    if (!state.api) return null;
    return {
      type:"excalidraw",
      version:2,
      source:"artifact-review",
      elements:deepCopy(state.api.getSceneElements()),
      appState:sanitizeAppState(state.api.getAppState()),
      files:deepCopy(state.api.getFiles() || {}),
    };
  }

  function persistenceRecord() {
    const scene = currentScene();
    if (!scene) return null;
    return {
      source_hash:state.sceneSourceHash,
      text_metrics_version:TEXT_METRICS_VERSION,
      scene,
      baseline:{ elements:deepCopy(state.baselineElements) },
    };
  }

  function saveNow(reason = "change") {
    const record = persistenceRecord();
    if (!record) return;
    const saveId = `${Date.now()}-${++state.saveSequence}`;
    setStatus(reason === "flush" ? "Saving before close…" : "Saving…");
    post({ type:"save", saveId, reason, record });
  }

  function scheduleSave() {
    if (!state.initialized) return;
    clearTimeout(state.saveTimer);
    setStatus("Unsaved changes");
    state.saveTimer = window.setTimeout(() => saveNow(), SAVE_DEBOUNCE_MS);
  }

  async function loadFonts(elements, files) {
    if (!elements.some(element => element.type === "text" && !element.isDeleted)) return;
    try {
      await exportToCanvas({
        elements,
        files:files || null,
        appState:{ exportBackground:false },
        maxWidthOrHeight:1,
      });
      await document.fonts.ready;
    } catch {
      // Font warming improves dimensions but is not required for editing.
    }
  }

  async function convertSource(source) {
    const parsed = await parseMermaidToExcalidraw(source, {
      themeVariables:{ fontSize:"16px" },
    });
    const materialize = regenerateIds =>
      convertToExcalidrawElements(parsed.elements, { regenerateIds });
    let elements = materialize(false);
    const regenerateIds = duplicateIds(elements).length > 0;
    if (regenerateIds) elements = materialize(true);
    await loadFonts(elements, parsed.files || {});
    // Materialize again after fonts settle so text boxes use final metrics.
    elements = materialize(regenerateIds);
    // Treat library output as untrusted even when the first pass was unique.
    if (duplicateIds(elements).length) elements = materialize(true);
    return {
      elements,
      files:parsed.files || {},
      fallback:imageFallback(elements),
    };
  }

  function mountEditor(elements, appState, files) {
    const host = document.getElementById("wbEditor");
    if (state.root) state.root.unmount();
    host.replaceChildren();
    state.root = createRoot(host);
    state.root.render(
      React.createElement(Excalidraw, {
        initialData:{
          elements,
          appState:{ ...sanitizeAppState(appState), currentItemFontFamily:2 },
          files:files || undefined,
          scrollToContent:true,
        },
        onChange:scheduleSave,
        excalidrawAPI:api => {
          state.api = api;
          window.setTimeout(() => {
            try {
              api.scrollToContent(api.getSceneElements(), { fitToContent:true });
            } catch {
              // Fitting is cosmetic; Excalidraw already centers initialData.
            }
          }, 0);
        },
        UIOptions:{
          canvasActions:{
            loadScene:false,
            saveToActiveFile:false,
            toggleTheme:false,
          },
        },
      }),
    );
  }

  async function startConverted(init) {
    setStatus("Converting Mermaid…");
    const converted = await convertSource(init.source);
    state.sceneSourceHash = init.sourceHash;
    state.baselineElements = deepCopy(converted.elements);
    state.files = converted.files;
    state.fallback = converted.fallback;
    const type = classifySource(init.source);
    setBadge(
      converted.fallback
        ? `${type.label} · Image annotation fallback`
        : `${type.label} · Editable shapes`,
      converted.fallback,
    );
    if (converted.fallback) {
      setBanner(
        "This Mermaid type is shown as an image. You can draw and annotate on top of it.",
        "fallback",
      );
    } else {
      setBanner("");
    }
    mountEditor(converted.elements, { viewBackgroundColor:"#ffffff" }, converted.files);
    state.initialized = true;
    setStatus("Autosave ready", "saved");
    scheduleSave();
  }

  async function startSaved(init, saved, stale) {
    setStatus("Restoring saved scene…");
    const restored = restore(
      {
        elements:Array.isArray(saved.scene?.elements) ? saved.scene.elements : [],
        appState:sanitizeAppState(saved.scene?.appState),
        files:saved.scene?.files || {},
      },
      null,
      null,
      { repairBindings:true },
    );
    state.sceneSourceHash = String(saved.source_hash || init.sourceHash);
    state.baselineElements = Array.isArray(saved.baseline?.elements)
      ? deepCopy(saved.baseline.elements)
      : deepCopy(restored.elements);
    state.files = restored.files || saved.scene?.files || {};
    state.fallback = imageFallback(restored.elements);
    const type = classifySource(init.source);
    setBadge(
      state.fallback
        ? `${type.label} · Image annotation fallback`
        : `${type.label} · Editable shapes`,
      state.fallback,
    );
    if (stale) {
      setBanner(
        "Editing a saved scene from an older Mermaid source. Your edits are preserved.",
        "stale",
      );
    } else if (state.fallback) {
      setBanner(
        "This Mermaid type is shown as an image. You can draw and annotate on top of it.",
        "fallback",
      );
    } else {
      setBanner("");
    }
    mountEditor(restored.elements, restored.appState, state.files);
    state.initialized = true;
    setStatus("Saved scene restored", "saved");
  }

  async function offerStaleChoice(init, saved) {
    const banner = document.getElementById("wbBanner");
    banner.hidden = false;
    banner.dataset.kind = "stale";
    banner.replaceChildren(
      document.createTextNode(
        "The Mermaid source changed after these whiteboard edits were saved. ",
      ),
    );
    const reconvert = element("button", {
      className:"wb-link-button",
      type:"button",
      textContent:"Re-convert (discard saved edits)",
    });
    const keep = element("button", {
      className:"wb-link-button",
      type:"button",
      textContent:"Keep editing saved scene",
    });
    banner.append(reconvert, keep);
    setStatus("Choose how to handle stale edits", "warning");
    return new Promise(resolve => {
      reconvert.onclick = () => resolve(startConverted(init));
      keep.onclick = () => resolve(startSaved(init, saved, true));
    });
  }

  async function initialize(init) {
    state.source = String(init.source || "");
    state.currentSourceHash = String(init.sourceHash || "");
    const saved =
      init.saved && typeof init.saved === "object" && init.saved.scene
        ? init.saved
        : null;
    try {
      if (!saved) {
        await startConverted(init);
      } else if (saved.source_hash === init.sourceHash) {
        await startSaved(init, saved, false);
      } else {
        await offerStaleChoice(init, saved);
      }
    } catch (error) {
      const host = document.getElementById("wbEditor");
      const message = error instanceof Error ? error.message : String(error);
      setBadge(`${classifySource(init.source).label} · Conversion failed`, true);
      setBanner(
        `The editable conversion failed: ${message}. The authoritative Mermaid source is shown below.`,
        "error",
      );
      host.replaceChildren(
        element("pre", { className:"wb-source-fallback", textContent:init.source }),
      );
      setStatus("Conversion failed", "error");
      post({ type:"error", error:message });
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    ["wbSummary", "wbQueue", "wbSend"].forEach(id => {
      const control = document.getElementById(id);
      if (control) control.disabled = busy;
    });
  }

  async function submit(mode) {
    if (!state.api || state.busy) return;
    const summary = String(document.getElementById("wbSummary")?.value || "").trim();
    if (!summary) {
      setStatus("Describe the diagram change first.", "error");
      document.getElementById("wbSummary")?.focus();
      return;
    }
    setBusy(true);
    setStatus(mode === "send" ? "Saving and sending…" : "Saving review draft…");
    try {
      clearTimeout(state.saveTimer);
      const record = persistenceRecord();
      const appState = state.api.getAppState();
      const blob = await exportToBlob({
        elements:state.api.getSceneElements(),
        files:state.api.getFiles() || null,
        mimeType:"image/png",
        appState:{
          exportBackground:true,
          viewBackgroundColor:appState.viewBackgroundColor || "#ffffff",
        },
      });
      post({
        type:"submit",
        mode,
        summary,
        scene:record.scene,
        baseline:record.baseline,
        source_hash:record.source_hash,
        text_metrics_version:record.text_metrics_version,
        image_fallback:state.fallback,
        stats:sceneStats(state.baselineElements, record.scene.elements),
        png_base64:await blobBase64(blob),
      });
    } catch (error) {
      setBusy(false);
      setStatus(
        `Could not prepare feedback: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  buildShell();
  window.addEventListener("message", event => {
    if (event.source !== window.parent) return;
    const message = event.data || {};
    if (!message.arevFrame || message.channel !== channel) return;
    if (message.type === "init" && !state.initialized) initialize(message);
    if (message.type === "save-result") {
      setStatus(message.ok ? "Autosaved" : `Autosave failed: ${message.error || "unknown error"}`,
        message.ok ? "saved" : "error");
    }
    if (message.type === "submit-result") {
      setBusy(false);
      if (message.ok) {
        const summary = document.getElementById("wbSummary");
        if (summary) summary.value = "";
        setStatus(message.mode === "send" ? "Sent to agent" : "Added to review", "saved");
      } else {
        setStatus(`Feedback failed: ${message.error || "unknown error"}`, "error");
      }
    }
    if (message.type === "flush") saveNow("flush");
    if (message.type === "unlock") {
      try {
        state.api?.setActiveTool?.({ type:"selection" });
      } catch {
        // Unlock is an accessibility hint; editing already remains available.
      }
    }
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(state.saveTimer);
    saveNow("flush");
  });
  post({ type:"ready" });
}

if (document.body?.hasAttribute("data-arev-whiteboard-frame")) {
  frameApp();
}
