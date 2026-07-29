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
    ".arev-flash{outline:3px solid #e8a13c!important;outline-offset:2px;transition:outline .2s}";
  document.documentElement.appendChild(css);

  function setAnnotate(on) {
    annotating = on;
    if (!on && hoverEl) {
      hoverEl.classList.remove("arev-hover");
      hoverEl = null;
    }
  }

  document.addEventListener(
    "mouseover",
    function (e) {
      if (!annotating) return;
      if (hoverEl) hoverEl.classList.remove("arev-hover");
      hoverEl = e.target;
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
      e.preventDefault();
      e.stopPropagation();
      if (swallowClick) {
        swallowClick = false;
        return;
      } // text pick already sent
      var el = e.target;
      el.classList.remove("arev-hover");
      var rect = el.getBoundingClientRect();
      send({
        type: "pick-element",
        selector: selectorFor(el),
        label: labelFor(el),
        rect: { top: rect.top, left: rect.left, bottom: rect.bottom },
      });
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

  /* ------------------------------------------------------------- utilities */

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || !e.data.arev) return;
    if (e.data.type === "set-annotate") setAnnotate(!!e.data.on);
    if (e.data.type === "flash") {
      var el = document.querySelector(e.data.selector);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("arev-flash");
        setTimeout(function () {
          el.classList.remove("arev-flash");
        }, 1600);
      }
    }
    if (e.data.type === "get-scroll")
      send({ type: "scroll", y: window.scrollY });
    if (e.data.type === "set-scroll") window.scrollTo(0, e.data.y || 0);
    if (e.data.type === "inject-svg") {
      var block = document.querySelector(e.data.selector);
      if (block) {
        var host = document.getElementById("arev-board-" + e.data.id);
        if (!host) {
          host = document.createElement("div");
          host.id = "arev-board-" + e.data.id;
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

  /* -------------------------------------------------- mermaid + audit + boot */

  function findMermaid() {
    var blocks = [];
    var nodes = document.querySelectorAll(
      "pre.mermaid, div.mermaid, pre > code.language-mermaid",
    );
    Array.prototype.forEach.call(nodes, function (node, i) {
      var holder = node.tagName === "CODE" ? node.parentElement : node;
      if (!holder.id) holder.id = "arev-mermaid-" + i;
      blocks.push({
        id: holder.id,
        selector: "#" + holder.id,
        source: (node.textContent || "").trim(),
      });
    });
    return blocks;
  }

  function boot() {
    var findings = [];
    try {
      findings = window.__arevAudit(document, window) || [];
    } catch (err) {
      /* a crashed audit must never block review */
    }
    send({ type: "audit-done", findings: findings });
    send({
      type: "sdk-ready",
      mermaid: findMermaid(),
      title: document.title || "",
    });
  }

  if (document.readyState === "complete") setTimeout(boot, 50);
  else
    window.addEventListener("load", function () {
      setTimeout(boot, 50);
    });
})();
