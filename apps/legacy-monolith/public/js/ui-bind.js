/**
 * WorkHub UI event binder — replaces inline onclick/onchange handlers.
 * Attributes:
 *   data-wh-click="functionName"
 *   data-wh-change="functionName"
 *   data-wh-submit="functionName"
 *   data-wh-input="functionName"
 *   data-wh-args='["arg1", 2]'   JSON array
 *   data-wh-event="1"           pass Event as first arg
 *   data-wh-this="1"            pass element as last arg
 *   data-wh-stop="1"            stopPropagation
 */
(function (root) {
  'use strict';

  function parseArgs(el) {
    const raw = el.getAttribute('data-wh-args');
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [v];
    } catch {
      return [raw];
    }
  }

  function invoke(el, attrName, event) {
    const name = el.getAttribute(attrName);
    if (!name) return;
    let fn = root[name];
    if (typeof fn !== 'function' && name === 'alert' && typeof root.alert === 'function') {
      fn = root.alert.bind(root);
    }
    if (typeof fn !== 'function') {
      if (root.console && console.warn) {
        console.warn('[ui-bind] missing handler:', name);
      }
      return;
    }
    if (el.getAttribute('data-wh-stop') === '1' && event && event.stopPropagation) {
      event.stopPropagation();
    }
    if (event && event.preventDefault && (el.tagName === 'A' || el.getAttribute('type') === 'submit' || el.tagName === 'BUTTON')) {
      // Only prevent default for anchors / submit-like when not type=button already handling
      if (el.tagName === 'A' || (el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit')) {
        event.preventDefault();
      }
    }
    const args = parseArgs(el);
    if (el.getAttribute('data-wh-event') === '1') {
      args.unshift(event);
    }
    if (el.getAttribute('data-wh-this') === '1') {
      args.push(el);
    }
    fn.apply(el, args);
    const thenName = el.getAttribute('data-wh-then');
    if (thenName && typeof root[thenName] === 'function') {
      let thenArgs = [];
      const rawThen = el.getAttribute('data-wh-then-args');
      if (rawThen) {
        try { thenArgs = JSON.parse(rawThen); } catch (e) { thenArgs = [rawThen]; }
      }
      root[thenName].apply(el, Array.isArray(thenArgs) ? thenArgs : [thenArgs]);
    }
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-wh-click]') : null;
    if (!el) return;
    invoke(el, 'data-wh-click', e);
  }

  function onChange(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-wh-change]') : null;
    if (!el) return;
    invoke(el, 'data-wh-change', e);
  }

  function onSubmit(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-wh-submit]') : null;
    if (!el) return;
    e.preventDefault();
    invoke(el, 'data-wh-submit', e);
  }

  function onInput(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-wh-input]') : null;
    if (!el) return;
    invoke(el, 'data-wh-input', e);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', onClick, false);
    document.addEventListener('change', onChange, false);
    document.addEventListener('submit', onSubmit, false);
    document.addEventListener('input', onInput, false);
  }

  root.WorkHubUiBind = { invoke: invoke };
})(typeof window !== 'undefined' ? window : globalThis);
