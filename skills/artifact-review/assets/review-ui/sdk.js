/*
 * arev SDK. Injected into the reviewed artifact when served through arev.
 * The artifact file on disk never contains this script.
 *
 * Talks only to the parent chrome via postMessage (same origin). The chrome
 * owns all HTTP calls; the SDK owns what happens inside the artifact page:
 * the open-time layout audit, element and text-range picking, native control
 * capture, and locating mermaid blocks for the whiteboard feature.
 */
(function () {
  "use strict";
  if (window.__arevSdkLoaded) return;
  window.__arevSdkLoaded = true;

  var annotating = false;
  var hoverEl = null;
  var swallowClick = false; // the click that completes a text selection is not an element pick
  var inlineBoards = Object.create(null);
  var sharedInlineFrame = null;
  var activeInlineBoardId = null;
  var fullscreenBoardId = null;
  var fullscreenOverflow = null;

  function send(msg) {
    msg.arev = true;
    window.parent.postMessage(msg, window.location.origin);
  }

  /* ---------------------------------------------------- selectors + anchors */

  function cssEscape(s) {
    return window.CSS && CSS.escape
      ? CSS.escape(s)
      : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function selectorFor(el) {
    if (!el || el === document.documentElement) return "html";
    if (el.id) return "#" + cssEscape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 3) {
      if (node.id) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (same.length > 1)
          tag += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  function labelFor(el) {
    var text = (
      el.innerText ||
      el.value ||
      el.getAttribute("aria-label") ||
      ""
    ).trim();
    text = text.replace(/\s+/g, " ").slice(0, 80);
    return "<" + el.tagName.toLowerCase() + "> " + text;
  }

  function safeDiagramId(authoredId, index) {
    if (/^[A-Za-z0-9_-]{1,128}$/.test(authoredId || ""))
      return authoredId;
    if (!authoredId) return "arev-mermaid-" + index;
    var hash = 2166136261;
    for (var i = 0; i < authoredId.length; i += 1) {
      hash ^= authoredId.charCodeAt(i);
      hash +=
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24);
    }
    var slug = authoredId
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
    return (
      (slug || "mermaid") +
      "-" +
      ("00000000" + (hash >>> 0).toString(16)).slice(-8)
    );
  }

  function normalizedText(el) {
    if (!el) return "";
    var clone = el.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll("br"), function (br) {
      br.parentNode.replaceChild(document.createTextNode(" "), br);
    });
    return (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function mermaidSvgFor(el) {
    if (!el || !el.closest) return null;
    var svg = el.closest("svg");
    if (!svg) return null;
    var role = (svg.getAttribute("aria-roledescription") || "").toLowerCase();
    var id = (svg.id || "").toLowerCase();
    var inMermaid = svg.closest(
      ".mermaid,[data-arev-diagram-id],[id^='arev-board-']",
    );
    if (
      !inMermaid &&
      id.indexOf("mermaid") === -1 &&
      role.indexOf("diagram") === -1 &&
      !svg.querySelector("g.nodes")
    )
      return null;
    return svg;
  }

  function mermaidNodeGroup(el) {
    if (!el || el.nodeType !== 1 || !el.closest) return null;
    var group = el.closest("g.node");
    if (!group) {
      var candidate = el.closest("g");
      while (candidate) {
        if (
          candidate.parentElement &&
          candidate.parentElement.matches("g.nodes")
        ) {
          group = candidate;
          break;
        }
        candidate = candidate.parentElement
          ? candidate.parentElement.closest("g")
          : null;
      }
    }
    return group && mermaidSvgFor(group) ? group : null;
  }

  function diagramIdFor(group) {
    var svg = mermaidSvgFor(group);
    if (!svg) return "";
    var holder = svg.closest(
      "[data-arev-diagram-id],.mermaid,[id^='arev-board-']",
    );
    if (holder) {
      var explicit = holder.getAttribute("data-arev-diagram-id");
      if (explicit) return explicit;
      if (holder.id.indexOf("arev-board-") === 0)
        return holder.id.slice("arev-board-".length);
      if (holder.id) return holder.id;
    }
    return svg.id || "mermaid";
  }

  function selectorForMermaidNode(group) {
    var svg = mermaidSvgFor(group);
    var holder = svg
      ? svg.closest(
          "[data-arev-diagram-id],.mermaid,[id^='arev-board-']",
        )
      : null;
    var prefix =
      holder && holder.id
        ? "#" + cssEscape(holder.id) + " "
        : svg && svg.id
          ? "#" + cssEscape(svg.id) + " "
          : "";
    var key = group.getAttribute("data-arev-node-key");
    if (key)
      return prefix + '[data-arev-node-key="' + cssEscape(key) + '"]';
    if (group.id) return "#" + cssEscape(group.id);
    if (group.parentElement && group.parentElement.matches("g.nodes")) {
      var siblings = Array.prototype.filter.call(
        group.parentElement.children,
        function (child) {
          return child.tagName && child.tagName.toLowerCase() === "g";
        },
      );
      return (
        prefix +
        "g.nodes > g:nth-of-type(" +
        (siblings.indexOf(group) + 1) +
        ")"
      );
    }
    return prefix + selectorFor(group);
  }

  /* A node's DOM id carries a per-render counter ("flowchart-API-3"), so a
   * theme re-render would break any anchor built on it. The stable key drops
   * the counter and is stamped onto every node as data-arev-node-key, giving
   * annotations an identity and a selector that survive re-renders. */

  function stableNodeKey(group, svg, index) {
    var key = group.getAttribute("data-id") || "";
    if (!key) {
      var raw = group.id || "";
      // Mermaid 11 prefixes node ids with the svg's render id, which changes
      // on every render pass. Drop it before dropping the counter.
      if (svg && svg.id && raw.indexOf(svg.id + "-") === 0)
        raw = raw.slice(svg.id.length + 1);
      var counted = raw.match(/^(.*[^-])-\d+$/);
      key = counted ? counted[1] : raw;
    }
    return key || "node-" + index;
  }

  function mermaidNodeGroups(svg) {
    // querySelectorAll never repeats an element, even across a selector list.
    return Array.prototype.slice.call(
      svg.querySelectorAll("g.node,g.nodes > g"),
    );
  }

  function allMermaidSvgs() {
    return Array.prototype.filter.call(
      document.querySelectorAll("svg"),
      mermaidSvgFor,
    );
  }

  function mermaidNodeTarget(el) {
    var group = mermaidNodeGroup(el);
    if (!group) return null;
    var labelEl = group.querySelector(
      ".nodeLabel,.label,foreignObject,text,[aria-label]",
    );
    var label =
      normalizedText(labelEl) ||
      group.getAttribute("aria-label") ||
      normalizedText(group);
    var svg = mermaidSvgFor(group);
    var nodeId =
      group.getAttribute("data-arev-node-key") ||
      stableNodeKey(
        group,
        svg,
        svg ? Math.max(0, mermaidNodeGroups(svg).indexOf(group)) : 0,
      );
    return {
      type: "mermaid-node",
      diagramId: diagramIdFor(group),
      nodeId: nodeId || "node",
      label: label.slice(0, 160),
      selector: selectorForMermaidNode(group),
    };
  }

  /* Text-range anchor: the selected text plus surrounding context, so the
   * agent can find the exact spot even after the element re-renders. */
  function textAnchor(sel) {
    var range = sel.getRangeAt(0);
    var exact = sel.toString();
    var container = range.commonAncestorContainer;
    if (container.nodeType !== 1) container = container.parentElement;
    var full = container.innerText || "";
    var idx = full.indexOf(exact);
    return {
      exact: exact.slice(0, 500),
      prefix: idx > 0 ? full.slice(Math.max(0, idx - 40), idx) : "",
      suffix:
        idx >= 0 ? full.slice(idx + exact.length, idx + exact.length + 40) : "",
      selector: selectorFor(container),
    };
  }

  /* ------------------------------------------------------- annotation mode */

  var css = document.createElement("style");
  css.textContent =
    ".arev-hover{outline:2px solid #5b8def!important;outline-offset:2px;cursor:crosshair!important}" +
    ".arev-flash{outline:3px solid #e8a13c!important;outline-offset:2px;transition:outline .2s}" +
    // max-width defends the board against artifact CSS that caps a column, so it always
    // spans the same width as the diagram it stands in for.
    ".arev-inline-board{position:relative;width:100%;max-width:none;height:52px;margin:8px 0;background:transparent;border:1px solid rgba(128,128,128,.4);border-radius:8px;overflow:hidden;box-sizing:border-box}" +
    ".arev-inline-board.arev-inline-active{max-height:calc(100vh - 24px);margin:0;background:#fff}" +
    ".arev-inline-board>iframe{position:absolute;inset:0;display:block;width:100%;height:100%;border:0;background:#fff}" +
    ".arev-inline-unlock{position:absolute;inset:0;width:100%;height:100%;z-index:2;border:0;background:rgba(128,128,128,.08);color:inherit;font:600 13px/1.3 sans-serif;cursor:pointer}" +
    ".arev-inline-unlock:disabled{cursor:wait;opacity:.6}" +
    ".arev-inline-unlock span{display:inline-block;padding:8px 13px;border:1px solid rgba(128,128,128,.5);border-radius:999px;background:rgba(128,128,128,.14)}" +
    ".arev-inline-board.arev-inline-fullscreen{position:fixed!important;inset:12px!important;width:auto!important;height:auto!important;max-height:none!important;z-index:2147483645!important;border-radius:10px!important;box-shadow:0 12px 48px rgba(0,0,0,.35)}";
  document.documentElement.appendChild(css);

  function setAnnotate(on) {
    annotating = on;
    if (!on && hoverEl) {
      hoverEl.classList.remove("arev-hover");
      hoverEl = null;
    }
    exploreViewports.forEach(function (viewport) {
      viewport.setFrozen(on);
    });
  }

  document.addEventListener(
    "mouseover",
    function (e) {
      if (!annotating) return;
      if (e.target.closest && e.target.closest("[data-arev-internal]")) {
        if (hoverEl) hoverEl.classList.remove("arev-hover");
        hoverEl = null;
        return;
      }
      if (hoverEl) hoverEl.classList.remove("arev-hover");
      hoverEl = mermaidNodeGroup(e.target) || e.target;
      hoverEl.classList.add("arev-hover");
    },
    true,
  );

  document.addEventListener(
    "mouseup",
    function () {
      if (!annotating) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        var anchor = textAnchor(sel);
        var rect = sel.getRangeAt(0).getBoundingClientRect();
        send({
          type: "pick-text",
          anchor: anchor,
          selector: anchor.selector,
          snippet: anchor.exact.slice(0, 120),
          rect: { top: rect.top, left: rect.left, bottom: rect.bottom },
        });
        sel.removeAllRanges();
        swallowClick = true; // the click event for this mouseup is still coming
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    function (e) {
      if (!annotating) return;
      if (e.target.closest && e.target.closest("[data-arev-internal]"))
        return;
      e.preventDefault();
      e.stopPropagation();
      if (swallowClick) {
        swallowClick = false;
        return;
      } // text pick already sent
      var target = mermaidNodeTarget(e.target);
      var el = target ? mermaidNodeGroup(e.target) : e.target;
      el.classList.remove("arev-hover");
      var rect = el.getBoundingClientRect();
      var pick = {
        type: "pick-element",
        selector: target ? target.selector : selectorFor(el),
        label: target ? target.label : labelFor(el),
        rect: { top: rect.top, left: rect.left, bottom: rect.bottom },
      };
      if (target) pick.target = target;
      send(pick);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        send({ type: "toggle-annotate" });
      }
    },
    true,
  );

  /* --------------------------------------------------- native control capture
   * Interacting with the artifact's own controls IS feedback: a ticked
   * checkbox or a chosen radio answers a question without any typing. */

  function controlItem(el, value) {
    var kind = el.matches("[data-arev-action],[data-lavish-action]")
      ? "action"
      : el.type || el.tagName.toLowerCase();
    var label =
      el.labels && el.labels[0]
        ? el.labels[0].innerText.trim()
        : el.getAttribute("data-arev-action") ||
          el.getAttribute("data-lavish-action") ||
          labelFor(el);
    return {
      kind: "control",
      selector: selectorFor(el),
      control: kind,
      value: value,
      label: label.slice(0, 120),
    };
  }

  document.addEventListener(
    "change",
    function (e) {
      if (annotating) return;
      var el = e.target;
      if (el.closest("[data-arev-internal]")) return; // arev's own UI is not feedback
      if (!el.matches("input,select,textarea")) return;
      var value =
        el.type === "checkbox"
          ? String(el.checked)
          : el.type === "radio"
            ? el.value
            : el.value;
      // A radio group is one answer: key it by group name, not by the element.
      var item = controlItem(el, value);
      if (el.type === "radio" && el.name)
        item.selector = "input[name=" + cssEscape(el.name) + "]";
      send({ type: "control", item: item });
    },
    true,
  );

  document.addEventListener(
    "click",
    function (e) {
      if (annotating) return;
      if (e.target.closest("[data-arev-internal]")) return; // arev's own UI is not feedback
      var el = e.target.closest(
        "button,[data-arev-action],[data-lavish-action]",
      );
      if (!el) return;
      if (el.matches("[data-arev-action],[data-lavish-action],button")) {
        send({ type: "control", item: controlItem(el, "clicked") });
      }
    },
    true,
  );

  /* ------------------------------------------------ inline diagram editors */

  function boardForSource(source) {
    var board = inlineBoards[activeInlineBoardId];
    return board && sharedInlineFrame && sharedInlineFrame.contentWindow === source
      ? board
      : null;
  }

  function postToBoard(board, message) {
    if (!board || !board.iframe || !board.iframe.contentWindow) return;
    board.iframe.contentWindow.postMessage(message, "*");
  }

  function unlockBoard(board, focus) {
    if (!board || board.id !== activeInlineBoardId || !board.iframe) return;
    if (!board.ready) {
      board.wantsUnlock = true;
      return;
    }
    board.iframe.style.pointerEvents = "auto";
    board.unlocked = true;
    board.overlay.hidden = true;
    postToBoard(board, {
      arevFrame: true,
      channel: board.channel,
      type: "unlock",
    });
    if (focus) {
      try {
        board.iframe.focus();
      } catch (err) {}
    }
  }

  function setBoardFullscreen(board, on) {
    if (!board) return;
    if (on && fullscreenBoardId && fullscreenBoardId !== board.id)
      setBoardFullscreen(inlineBoards[fullscreenBoardId], false);
    if (on && !fullscreenBoardId) {
      fullscreenOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }
    board.fullscreen = !!on;
    board.host.classList.toggle("arev-inline-fullscreen", !!on);
    board.host.setAttribute(
      "aria-label",
      on
        ? "Diagram editor in fullscreen mode"
        : "Inline editable diagram",
    );
    board.overlay.setAttribute(
      "aria-label",
      on ? "Click to edit fullscreen diagram" : "Click to edit diagram",
    );
    if (on) {
      fullscreenBoardId = board.id;
      unlockBoard(board, true);
    } else if (fullscreenBoardId === board.id) {
      fullscreenBoardId = null;
      document.documentElement.style.overflow = fullscreenOverflow || "";
      fullscreenOverflow = null;
    }
    postToBoard(board, {
      arevFrame: true,
      channel: board.channel,
      type: "fullscreen-state",
      enabled: !!on,
    });
  }

  function restoreBoardSource(board) {
    if (!board || !board.block) return;
    board.block.style.display = board.originalDisplay;
  }

  function markBoardReady(board) {
    if (!board || !board.block) return;
    board.ready = true;
    board.host.hidden = false;
    board.block.style.display = "none";
    board.overlay.disabled = false;
    board.overlayLabel.textContent = "Click to edit diagram";
    board.overlay.setAttribute("aria-label", "Click to edit diagram");
    if (board.wantsUnlock) unlockBoard(board, true);
  }

  function createSharedInlineFrame() {
    if (sharedInlineFrame) return sharedInlineFrame;
    var iframe = document.createElement("iframe");
    iframe.id = "arev-shared-whiteboard-frame";
    iframe.setAttribute("sandbox", "allow-scripts allow-popups");
    iframe.style.pointerEvents = "none";
    iframe.addEventListener("error", function () {
      var board = inlineBoards[activeInlineBoardId];
      if (!board) return;
      restoreBoardSource(board);
      board.host.classList.remove("arev-inline-active");
      board.host.style.height = "52px";
      board.overlay.disabled = false;
      board.overlay.hidden = false;
      board.overlayLabel.textContent = "Open diagram editor";
      send({
        type: "inline-mount-failed",
        id: board.id,
        error: "The inline diagram editor could not be loaded.",
      });
    });
    sharedInlineFrame = iframe;
    return iframe;
  }

  function deactivateInlineBoard(board) {
    if (!board) return;
    if (board.fullscreen) setBoardFullscreen(board, false);
    restoreBoardSource(board);
    board.ready = false;
    board.unlocked = false;
    board.wantsUnlock = false;
    board.iframe = null;
    board.host.classList.remove("arev-inline-active");
    board.host.style.height = "52px";
    board.host.setAttribute("aria-label", "Diagram editor available");
    board.overlay.disabled = false;
    board.overlay.hidden = false;
    board.overlayLabel.textContent = "Open diagram editor";
    board.overlay.setAttribute("aria-label", "Open diagram editor");
  }

  function activateInlineBoard(board, focus) {
    if (!board) return;
    if (activeInlineBoardId === board.id && board.iframe) {
      board.wantsUnlock = true;
      unlockBoard(board, focus);
      return;
    }

    // Read before the style writes below, so the rect costs no extra reflow.
    // Measured on activation, not at mount: the block keeps growing while
    // Mermaid renders and fonts settle. The 216px covers the frame's header,
    // feedback bar, and fallback banner, about 145px owned by
    // tooling/whiteboard-frame.css and unreadable from here, plus room for
    // Excalidraw's toolbar, which floats over the canvas.
    var editorHeight = Math.max(
      300,
      Math.round(board.block.getBoundingClientRect().height) + 216,
    );

    var previous = inlineBoards[activeInlineBoardId];
    if (previous) deactivateInlineBoard(previous);

    var iframe = createSharedInlineFrame();
    activeInlineBoardId = board.id;
    board.iframe = iframe;
    board.ready = false;
    board.unlocked = false;
    board.wantsUnlock = true;
    board.host.classList.add("arev-inline-active");
    board.host.style.height = editorHeight + "px";
    board.host.setAttribute("aria-label", "Inline editable diagram");
    board.overlay.hidden = false;
    board.overlay.disabled = true;
    board.overlayLabel.textContent = "Loading diagram editor…";
    board.overlay.setAttribute("aria-label", "Loading diagram editor");
    iframe.title = "Editable diagram " + board.id;
    iframe.style.pointerEvents = "none";
    board.host.insertBefore(iframe, board.overlay);
    iframe.src =
      "/whiteboard-frame?" +
      (board.frameVersion ? "v=" + board.frameVersion + "&" : "") +
      "diagram=" +
      encodeURIComponent(board.id) +
      "&channel=" +
      encodeURIComponent(board.channel);
    board.host.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function mountInline(message) {
    var id = String(message.id || "");
    var channel = String(message.channel || "");
    var selector = String(message.selector || "");
    var frameVersion = String(message.frameVersion || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !channel || !selector)
      return;
    if (frameVersion && !/^[0-9a-f]{64}$/.test(frameVersion)) return;
    var block;
    try {
      block = document.querySelector(selector);
    } catch (err) {
      block = null;
    }
    if (!block) {
      send({
        type: "inline-mount-failed",
        id: id,
        error: "The Mermaid source element was not found.",
      });
      return;
    }

    var current = inlineBoards[id];
    if (current) {
      if (activeInlineBoardId === current.id) {
        deactivateInlineBoard(current);
        activeInlineBoardId = null;
      }
      restoreBoardSource(current);
      current.host.remove();
      delete inlineBoards[id];
    }

    var host = document.getElementById("arev-board-" + id);
    var createdHost = !host;
    var originalDisplay = block.hasAttribute("data-arev-original-display")
      ? block.getAttribute("data-arev-original-display")
      : block.style.display;
    try {
      if (!host) {
        host = document.createElement("section");
        host.id = "arev-board-" + id;
      } else {
        host.replaceChildren();
        host.style.cssText = "";
      }
      host.classList.add("arev-inline-board");
      host.setAttribute("data-arev-internal", "");
      host.setAttribute("data-arev-diagram-id", id);
      host.setAttribute("aria-label", "Diagram editor available");
      var overlay = document.createElement("button");
      overlay.type = "button";
      overlay.className = "arev-inline-unlock";
      overlay.setAttribute("data-arev-internal", "");
      overlay.setAttribute("aria-label", "Open diagram editor");
      var overlayLabel = document.createElement("span");
      overlayLabel.textContent = "Open diagram editor";
      overlay.appendChild(overlayLabel);

      var board = {
        id: id,
        channel: channel,
        selector: selector,
        block: block,
        originalDisplay: originalDisplay,
        host: host,
        iframe: null,
        overlay: overlay,
        overlayLabel: overlayLabel,
        frameVersion: frameVersion,
        unlocked: false,
        wantsUnlock: false,
        fullscreen: false,
        ready: false,
      };
      overlay.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        send({ type: "want-board", id: board.id });
      });

      host.appendChild(overlay);
      if (!host.parentNode)
        block.parentNode.insertBefore(host, block.nextSibling);
      else if (host.previousElementSibling !== block)
        block.parentNode.insertBefore(host, block.nextSibling);
      inlineBoards[id] = board;
    } catch (err) {
      block.style.display = originalDisplay;
      delete inlineBoards[id];
      if (createdHost && host && host.parentNode)
        host.parentNode.removeChild(host);
      send({
        type: "inline-mount-failed",
        id: id,
        error: err && err.message ? err.message : "Could not mount the editor.",
      });
    }
  }

  function focusInline(id) {
    var board = inlineBoards[String(id || "")];
    if (!board) return;
    activateInlineBoard(board, true);
  }

  window.addEventListener("message", function (event) {
    if (!event.data || !event.data.arevFrame) return;
    var board = boardForSource(event.source);
    if (!board || event.data.channel !== board.channel) return;
    if (event.data.type === "ready") markBoardReady(board);
    if (
      event.data.type === "fullscreen" ||
      event.data.type === "request-fullscreen" ||
      event.data.type === "set-fullscreen"
    ) {
      var requested =
        typeof event.data.enabled === "boolean"
          ? event.data.enabled
          : typeof event.data.fullscreen === "boolean"
            ? event.data.fullscreen
            : typeof event.data.on === "boolean"
              ? event.data.on
              : !board.fullscreen;
      setBoardFullscreen(board, requested);
      return;
    }
    send({
      type: "whiteboard-frame",
      id: board.id,
      channel: board.channel,
      message: event.data,
    });
  });

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape" && fullscreenBoardId)
        setBoardFullscreen(inlineBoards[fullscreenBoardId], false);
    },
    true,
  );

  /* ------------------------------------------------------------- utilities */

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || !e.data.arev) return;
    if (e.data.type === "set-annotate") setAnnotate(!!e.data.on);
    if (e.data.type === "flash") {
      var el = document.querySelector(e.data.selector);
      if (el) {
        el = mermaidNodeGroup(el) || el;
        el.scrollIntoView({ block: "center" });
        el.classList.add("arev-flash");
        setTimeout(function () {
          el.classList.remove("arev-flash");
        }, 1600);
      }
    }
    if (e.data.type === "run-audit") {
      send({
        type: "audit-pass",
        token: e.data.token,
        findings: safeAudit(),
      });
    }
    if (e.data.type === "get-scroll")
      send({ type: "scroll", y: window.scrollY });
    if (e.data.type === "set-scroll") window.scrollTo(0, e.data.y || 0);
    if (e.data.type === "mount-inline") mountInline(e.data);
    if (e.data.type === "focus-inline") focusInline(e.data.id);
    if (e.data.type === "whiteboard-frame") {
      var board = inlineBoards[String(e.data.id || "")];
      if (
        board &&
        e.data.channel === board.channel &&
        e.data.message
      )
        postToBoard(board, e.data.message);
    }
    if (e.data.type === "inject-svg") {
      var block = document.querySelector(e.data.selector);
      if (block) {
        if (inlineBoards[String(e.data.id || "")]) return;
        var host = document.getElementById("arev-board-" + e.data.id);
        if (!host) {
          host = document.createElement("div");
          host.id = "arev-board-" + e.data.id;
          block.setAttribute("data-arev-original-display", block.style.display);
          block.style.display = "none";
          block.parentNode.insertBefore(host, block.nextSibling);
        }
        showBoardSvg(host, e.data.id, e.data.svg);
      }
    }
  });

  /* ---------------------------------------------------- diagram cards
   * A rendered diagram stays a clean inline card. The Expand button opens the
   * chrome's modal Excalidraw editor, the same shape as the explain-changes
   * report's diagram dialog. Nothing heavy ever mounts inside the artifact. */

  function showBoardSvg(host, id, svg) {
    host.innerHTML = svg;
    host.style.cssText =
      "position:relative;background:#fff;border-radius:6px;" +
      "padding:8px;overflow:auto;border:1px solid #d8dbe0";
    var btn = document.createElement("button");
    btn.textContent = "⛶ Expand";
    btn.setAttribute("data-arev-internal", "");
    btn.style.cssText =
      "position:absolute;right:8px;top:8px;font:12px sans-serif;" +
      "padding:3px 10px;cursor:pointer;border:1px solid #c9cdd3;border-radius:6px;" +
      "background:#fff;color:#333";
    btn.onclick = function (e) {
      e.stopPropagation();
      send({ type: "want-board", id: id });
    };
    host.appendChild(btn);
  }

  /* ------------------------------------------------- diagram explore mode
   * Dependency-free viewBox pan/zoom on every rendered Mermaid SVG. Frozen
   * while annotate mode is on so element picks stay precise. Only the
   * rendered SVG changes. The artifact file is never modified. */

  var exploreViewports = [];

  function createExploreViewport(svg) {
    var initial = null;
    var raw = svg.getAttribute("viewBox");
    if (raw) {
      var parts = raw.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(isFinite))
        initial = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
    if (!initial) {
      var bbox = null;
      try {
        bbox = svg.getBBox();
      } catch (err) {}
      if (!bbox || !bbox.width || !bbox.height) return null;
      initial = { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
      svg.setAttribute(
        "viewBox",
        initial.x + " " + initial.y + " " + initial.w + " " + initial.h,
      );
    }

    var view = { x: initial.x, y: initial.y, w: initial.w, h: initial.h };
    var panning = null;

    function apply() {
      svg.setAttribute(
        "viewBox",
        view.x + " " + view.y + " " + view.w + " " + view.h,
      );
    }
    function reset() {
      view = { x: initial.x, y: initial.y, w: initial.w, h: initial.h };
      apply();
    }
    function zoomAt(clientX, clientY, factor) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var px = (clientX - rect.left) / rect.width;
      var py = (clientY - rect.top) / rect.height;
      var fx = view.x + view.w * px;
      var fy = view.y + view.h * py;
      var next = Math.min(
        Math.max(view.w * factor, initial.w / 40),
        initial.w * 8,
      );
      var scale = next / view.w;
      view.w = next;
      view.h *= scale;
      view.x = fx - (fx - view.x) * scale;
      view.y = fy - (fy - view.y) * scale;
      apply();
    }

    svg.addEventListener(
      "wheel",
      function (event) {
        if (annotating) return;
        event.preventDefault();
        zoomAt(
          event.clientX,
          event.clientY,
          event.deltaY > 0 ? 1.15 : 1 / 1.15,
        );
      },
      { passive: false },
    );
    svg.addEventListener("dblclick", function () {
      if (!annotating) reset();
    });
    svg.addEventListener("pointerdown", function (event) {
      if (annotating || event.button !== 0) return;
      // A viewBox write never resizes the client box. One size read per
      // drag avoids a layout pass on every pointer move.
      var rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      panning = {
        x: event.clientX,
        y: event.clientY,
        vx: view.x,
        vy: view.y,
        width: rect.width,
        height: rect.height,
      };
      if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
      svg.style.cursor = "grabbing";
    });
    svg.addEventListener("pointermove", function (event) {
      if (!panning) return;
      view.x =
        panning.vx - ((event.clientX - panning.x) / panning.width) * view.w;
      view.y =
        panning.vy - ((event.clientY - panning.y) / panning.height) * view.h;
      apply();
    });
    function endPan(event) {
      panning = null;
      if (svg.releasePointerCapture) {
        try {
          svg.releasePointerCapture(event.pointerId);
        } catch (err) {}
      }
      svg.style.cursor = annotating ? "" : "grab";
    }
    svg.addEventListener("pointerup", endPan);
    svg.addEventListener("pointercancel", endPan);

    return {
      svg: svg,
      setFrozen: function (frozen) {
        panning = null;
        svg.style.cursor = frozen ? "" : "grab";
        svg.style.touchAction = frozen ? "" : "none";
      },
    };
  }

  function enhanceMermaidSvgs() {
    exploreViewports = exploreViewports.filter(function (viewport) {
      return viewport.svg.isConnected;
    });
    allMermaidSvgs().forEach(function (svg) {
      // A marked SVG already has its node keys. Re-renders arrive unmarked.
      if (svg.hasAttribute("data-arev-explore")) return;
      mermaidNodeGroups(svg).forEach(function (group, index) {
        group.setAttribute(
          "data-arev-node-key",
          stableNodeKey(group, svg, index),
        );
      });
      var viewport = createExploreViewport(svg);
      if (!viewport) return;
      svg.setAttribute("data-arev-explore", "true");
      viewport.setFrozen(annotating);
      exploreViewports.push(viewport);
    });
  }

  document.addEventListener("arev:mermaid-rendered", enhanceMermaidSvgs);

  /* -------------------------------------------------- mermaid + audit + boot */

  function captureMermaidSources() {
    var holders = [];
    var nodes = document.querySelectorAll(
      "pre.mermaid, div.mermaid, pre > code.language-mermaid",
    );
    Array.prototype.forEach.call(nodes, function (node) {
      var holder = node;
      if (node.tagName === "CODE") {
        holder = node.closest(".mermaid") || node.parentElement;
      }
      if (!holder || holders.indexOf(holder) !== -1) return;
      holders.push(holder);
      if (
        holder.hasAttribute("data-mermaid-source") ||
        holder.hasAttribute("data-arev-mermaid-source")
      )
        return;
      var sourceNode =
        node.tagName === "CODE"
          ? node
          : holder.querySelector("code.language-mermaid") || holder;
      holder.setAttribute(
        "data-arev-mermaid-source",
        sourceNode.textContent || "",
      );
    });
  }

  // The review rail lists diagrams by name: the caption the artifact declares,
  // else the id its author wrote, else the reading position. Reading the
  // author's id keeps a generated hash suffix out of the name.
  function diagramTitle(holder, authoredId, index) {
    var figure = holder.closest("figure");
    var caption = figure ? figure.querySelector(":scope > figcaption") : null;
    var title =
      normalizedText(caption) ||
      (holder.getAttribute("aria-label") || "").trim();
    if (title) return title.slice(0, 80);
    var words = String(authoredId || "").replace(/[-_]+/g, " ").trim();
    if (!words) return "Diagram " + (index + 1);
    return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80);
  }

  function findMermaid() {
    var blocks = [];
    var holders = [];
    var nodes = document.querySelectorAll(
      "pre.mermaid, div.mermaid, pre > code.language-mermaid," +
        "[data-mermaid-source],[data-arev-mermaid-source]",
    );
    Array.prototype.forEach.call(nodes, function (node) {
      var holder = node;
      if (node.tagName === "CODE") {
        holder = node.closest(".mermaid") || node.parentElement;
      }
      if (!holder || holders.indexOf(holder) !== -1) return;
      holders.push(holder);
      var index = blocks.length;
      var authoredId = holder.getAttribute("id");
      var id = safeDiagramId(authoredId, index);
      if (!authoredId) holder.id = id;
      holder.setAttribute("data-arev-diagram-id", id);
      var sourceNode =
        node.tagName === "CODE"
          ? node
          : holder.querySelector("code.language-mermaid") || holder;
      var source =
        holder.getAttribute("data-mermaid-source") ||
        holder.getAttribute("data-arev-mermaid-source") ||
        sourceNode.textContent ||
        "";
      blocks.push({
        id: id,
        title: diagramTitle(holder, authoredId, index),
        selector: "#" + cssEscape(holder.id),
        source: source.trim(),
        index: index,
      });
    });
    return blocks;
  }

  function renderMermaidLocally(blocks) {
    var pending = blocks.some(function (block) {
      var holder = document.getElementById(block.id);
      return (
        holder &&
        !holder.querySelector("svg") &&
        !holder.getAttribute("data-processed")
      );
    });
    if (!pending) return null;
    // The review server bundles the same pinned Mermaid the whiteboard uses,
    // so diagrams render with no CDN and no network at all.
    return import(window.location.origin + "/mermaid.js").catch(function (err) {
      console.warn("arev: local Mermaid renderer failed to load", err);
    });
  }

  // A block that never became an SVG is a diagram the reviewer cannot see.
  // The page audit runs before rendering, so this is the only pass that can
  // catch a Mermaid syntax error or a renderer that failed to load.
  function unrenderedMermaidFindings(blocks) {
    var findings = [];
    blocks.forEach(function (block) {
      var holder = document.getElementById(block.id);
      if (!holder || holder.querySelector("svg")) return;
      findings.push({
        selector: block.selector,
        kind: "mermaid-render-failed",
        axis: null,
        overflowPx: null,
        viewportWidth: window.innerWidth,
        persistent: true,
        severity: "severe",
        evidence:
          'Diagram "' +
          block.id +
          '" did not render and is showing its Mermaid source as plain text. ' +
          "Check the syntax of: " +
          block.source.split("\n")[0].slice(0, 60),
      });
    });
    return findings;
  }

  function safeAudit() {
    try {
      return window.__arevAudit(document, window) || [];
    } catch (err) {
      /* a crashed audit must never block review */
      return [];
    }
  }

  function boot() {
    var findings = safeAudit();
    send({ type: "audit-done", findings: findings });
    var mermaidBlocks = findMermaid();
    var rendering = renderMermaidLocally(mermaidBlocks);
    send({
      type: "sdk-ready",
      mermaid: mermaidBlocks,
      title: document.title || "",
    });
    if (!rendering) {
      // Diagrams the artifact rendered itself still get identity keys and
      // explore mode. The offline renderer's own event covers the other path.
      enhanceMermaidSvgs();
      return;
    }
    rendering.then(function () {
      enhanceMermaidSvgs();
      var failed = unrenderedMermaidFindings(mermaidBlocks);
      if (!failed.length) return;
      // A later report replaces the earlier one, so resend the whole set.
      send({ type: "audit-done", findings: findings.concat(failed) });
    });
  }

  // Mermaid's start-on-load mode can replace source text with SVG before the
  // review controller boots. Preserve the authored source while the document
  // is still parsing so the inline editor always receives Mermaid syntax.
  captureMermaidSources();

  if (document.readyState === "complete") setTimeout(boot, 50);
  else
    window.addEventListener("load", function () {
      setTimeout(boot, 50);
    });
})();
