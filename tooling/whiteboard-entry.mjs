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

// Only plain web or mail links may leave the whiteboard. Everything else -
// javascript:, data:, file:, or relative noise coming from untrusted Mermaid
// `click` directives - is dropped before it can reach a saved scene.
export function sanitizeSceneLink(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^mailto:[^\s]+$/i.test(value)) return value;
  return "";
}

const SUMMARY_MAX_LINES = 40;
const SUMMARY_MAX_LINE_CHARS = 200;
const SUMMARY_MOVE_EPSILON_PX = 2;

function liveElements(elements) {
  return (Array.isArray(elements) ? elements : []).filter(
    element => element && typeof element === "object" && element.id && !element.isDeleted,
  );
}

function boundTextByContainer(elements) {
  const map = new Map();
  for (const element of elements) {
    if (element.type === "text" && element.containerId) map.set(element.containerId, element);
  }
  return map;
}

function elementLabel(element, boundText) {
  return String(element.text || boundText.get(element.id)?.text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function describeElement(element, boundText) {
  const label = elementLabel(element, boundText);
  const type = String(element.type || "element");
  return label ? `${type} "${truncate(label, 60)}"` : `${type} (${element.id})`;
}

function clampLine(line) {
  return truncate(line, SUMMARY_MAX_LINE_CHARS);
}

function arrowEndpoints(element, elementsMap, boundText) {
  const start = element.startBinding?.elementId
    ? elementsMap.get(element.startBinding.elementId)
    : null;
  const end = element.endBinding?.elementId
    ? elementsMap.get(element.endBinding.elementId)
    : null;
  if (!start && !end) return "";
  const name = endpoint => (endpoint ? describeElement(endpoint, boundText) : "(unattached)");
  return ` from ${name(start)} to ${name(end)}`;
}

// Diff the conversion baseline against the edited scene on stable element
// ids, producing the human-readable lines and counts the agent receives.
// Bound label text folds into its container, so a renamed node reads as one
// relabel instead of a moved text element.
export function summarizeSceneEdits(
  baselineElements,
  editedElements,
  { maxLines = SUMMARY_MAX_LINES } = {},
) {
  const baseline = liveElements(baselineElements);
  const edited = liveElements(editedElements);
  const baselineMap = new Map(baseline.map(element => [element.id, element]));
  const editedMap = new Map(edited.map(element => [element.id, element]));
  const baselineText = boundTextByContainer(baseline);
  const editedText = boundTextByContainer(edited);

  const stats = { added:0, removed:0, moved:0, relabeled:0, drawn:0 };
  const lines = [];

  for (const element of edited) {
    if (baselineMap.has(element.id)) continue;
    if (
      element.type === "text" &&
      element.containerId &&
      !baselineText.has(element.containerId) &&
      editedMap.has(element.containerId)
    ) continue; // the label of a newly added container is reported with the container
    if (element.type === "freedraw") {
      stats.drawn += 1;
      lines.push(clampLine(
        `Drew a freehand mark near (${Math.round(element.x)}, ${Math.round(element.y)})`,
      ));
      continue;
    }
    stats.added += 1;
    const endpoints = element.type === "arrow" || element.type === "line"
      ? arrowEndpoints(element, editedMap, editedText)
      : "";
    lines.push(clampLine(`Added ${describeElement(element, editedText)}${endpoints}`));
  }

  for (const element of baseline) {
    if (editedMap.has(element.id)) continue;
    if (element.type === "text" && element.containerId && baselineMap.has(element.containerId)) {
      continue; // a removed bound label shows up through its container
    }
    stats.removed += 1;
    lines.push(clampLine(`Removed ${describeElement(element, baselineText)}`));
  }

  for (const element of edited) {
    const before = baselineMap.get(element.id);
    if (!before) continue;

    const beforeLabel = elementLabel(before, baselineText);
    const afterLabel = elementLabel(element, editedText);
    if (beforeLabel !== afterLabel && !(element.type === "text" && element.containerId)) {
      stats.relabeled += 1;
      lines.push(clampLine(
        `Relabeled ${element.type}: "${truncate(beforeLabel, 50)}" is now "${truncate(afterLabel, 50)}"`,
      ));
    }

    if (element.type === "text" && element.containerId) continue; // container reports geometry

    const dx = Math.round((element.x ?? 0) - (before.x ?? 0));
    const dy = Math.round((element.y ?? 0) - (before.y ?? 0));
    const dw = Math.round((element.width ?? 0) - (before.width ?? 0));
    const dh = Math.round((element.height ?? 0) - (before.height ?? 0));
    const movedFar =
      Math.abs(dx) > SUMMARY_MOVE_EPSILON_PX || Math.abs(dy) > SUMMARY_MOVE_EPSILON_PX;
    const resized =
      Math.abs(dw) > SUMMARY_MOVE_EPSILON_PX || Math.abs(dh) > SUMMARY_MOVE_EPSILON_PX;
    if (movedFar || resized) {
      stats.moved += 1;
      const parts = [];
      if (movedFar) parts.push(`moved by (${dx}, ${dy})`);
      if (resized) parts.push(`resized by (${dw}, ${dh})`);
      lines.push(clampLine(
        `${describeElement(element, editedText)} ${parts.join(" and ")}`,
      ));
    }
  }

  const totalChanges =
    stats.added + stats.removed + stats.moved + stats.relabeled + stats.drawn;
  const bounded = lines.slice(0, maxLines);
  if (lines.length > bounded.length) {
    const extra = lines.length - bounded.length;
    bounded.push(`…and ${extra} more change${extra === 1 ? "" : "s"}`);
  }
  if (totalChanges === 0) {
    bounded.push("No element changes detected (view-only or style-only edits).");
  }
  return { lines:bounded, stats, totalChanges };
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
      textContent:"Optional note for the agent",
    });
    const summary = element("input", {
      id:"wbSummary",
      type:"text",
      placeholder:"Your edits are summarized automatically; add intent here",
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
    for (const element of elements) {
      if (element.link) element.link = sanitizeSceneLink(element.link) || null;
    }
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
    const note = String(document.getElementById("wbSummary")?.value || "").trim();
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
      const edits = summarizeSceneEdits(
        state.baselineElements,
        record.scene.elements,
      );
      post({
        type:"submit",
        mode,
        summary:note,
        summary_lines:edits.lines,
        scene:record.scene,
        baseline:record.baseline,
        source_hash:record.source_hash,
        text_metrics_version:record.text_metrics_version,
        image_fallback:state.fallback,
        stats:edits.stats,
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
