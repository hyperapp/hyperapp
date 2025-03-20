import { app, h, text, memo } from "../index.js"
import { t, equal, deepEqual } from "twist"

// ---------------------------------------------------------------------------
// Minimal DOM shim — twist runs in Node.js (no browser DOM available)
// We provide the smallest possible surface that app() and patch() touch.
// ---------------------------------------------------------------------------

const makeNode = (tag = "div") => {
  const node = {
    nodeName: tag.toUpperCase(),
    nodeType: 1,
    nodeValue: null,
    childNodes: [],
    children: [],
    parentNode: null,
    events: {},

    // Properties set directly by patchProperty
    className: "",
    value: "",
    checked: false,
    selected: false,

    style: new Proxy(
      { _props: {} },
      {
        get: (t, k) => (k === "setProperty" ? (p, v) => (t._props[p] = v) : t._props[k]),
        set: (t, k, v) => { t._props[k] = v; return true },
      }
    ),

    setAttribute(k, v) { this._attrs = this._attrs || {}; this._attrs[k] = v },
    removeAttribute(k) { this._attrs = this._attrs || {}; delete this._attrs[k] },
    addEventListener(type, fn) { this._listeners = this._listeners || {}; this._listeners[type] = fn },
    removeEventListener(type) { this._listeners = this._listeners || {}; delete this._listeners[type] },

    insertBefore(child, ref) {
      // Remove child from current parent if already attached
      if (child.parentNode) {
        const oldIdx = child.parentNode.childNodes.indexOf(child)
        if (oldIdx !== -1) child.parentNode.childNodes.splice(oldIdx, 1)
      }
      const idx = ref ? this.childNodes.indexOf(ref) : -1
      child.parentNode = this
      if (idx === -1) this.childNodes.push(child)
      else this.childNodes.splice(idx, 0, child)
      return child
    },
    appendChild(child) {
      child.parentNode = this
      this.childNodes.push(child)
      return child
    },
    removeChild(child) {
      const idx = this.childNodes.indexOf(child)
      if (idx !== -1) this.childNodes.splice(idx, 1)
      child.parentNode = null
      return child
    },
  }
  return node
}

const makeTextNode = (value = "") => ({
  nodeName: "#text",
  nodeType: 3,
  nodeValue: value,
  parentNode: null,
})

// Override document for the duration of these tests
const doc = {
  createElement: (tag) => makeNode(tag),
  createElementNS: (_ns, tag) => makeNode(tag),
  createTextNode: (v) => makeTextNode(v),
  getElementById: (id) => doc._nodes?.[id] ?? null,
}
global.document = doc

// Override requestAnimationFrame to run synchronously in tests
global.requestAnimationFrame = (fn) => { fn(); return 0 }

// ---------------------------------------------------------------------------

export default [
  // ── h() ───────────────────────────────────────────────────────────────────
  t("h function", [
    t("creates element vnode with tag and props", [
      deepEqual(h("div", { id: "x" }), {
        tag: "div",
        props: { id: "x" },
        key: undefined,
        children: [],
        type: undefined,
        node: undefined,
      }),
    ]),

    t("flattens class object into string", [
      deepEqual(
        h("div", { class: { foo: true, bar: false, baz: true } }).props,
        { class: "foo baz" }
      ),
    ]),

    t("flattens class array into string", [
      deepEqual(
        h("div", { class: ["a", false && "b", "c"] }).props,
        { class: "a c" }
      ),
    ]),

    t("passes class string through unchanged", [
      deepEqual(
        h("div", { class: "hello world" }).props,
        { class: "hello world" }
      ),
    ]),

    t("wraps non-array children in array", [
      equal(h("p", {}, text("hi")).children.length, 1),
    ]),

    t("keeps key out of props", [
      equal(h("li", { key: "k1" }).key, "k1"),
      equal(h("li", { key: "k1" }).props.key, undefined),
    ]),
  ]),

  // ── text() ────────────────────────────────────────────────────────────────
  t("text function", [
    deepEqual(text("hello"), {
      tag: "hello",
      props: {},
      key: undefined,
      children: [],
      type: 3,
      node: undefined,
    }),

    t("coerces number to vnode tag", [
      equal(text(42).tag, 42),
    ]),
  ]),

  // ── memo() ────────────────────────────────────────────────────────────────
  t("memo function", [
    t("stores tag function and memo data", [
      new Promise((resolve) => {
        const view = (data) => h("span", {}, text(data.x))
        const memoNode = memo(view, { x: 1 })
        resolve([
          equal(memoNode.tag, view),
          deepEqual(memoNode.memo, { x: 1 }),
        ])
      }),
    ]),

    t("skips re-render when memo data is unchanged", [
      new Promise((resolve) => {
        let renderCount = 0
        const view = (data) => { renderCount++; return h("div", {}, text(data.v)) }
        const container = makeNode("main")
        container.childNodes = []

        // First render
        const mountNode = makeNode("div")
        container.appendChild(mountNode)
        mountNode.nodeType = 1

        const dispatch = app({
          node: mountNode,
          init: { v: "a" },
          view: (state) => memo(view, { v: state.v }),
        })

        const countAfterInit = renderCount
        // Dispatch same state — memo should not re-invoke view
        dispatch((state) => state)

        resolve([equal(renderCount, countAfterInit)])
      }),
    ]),
  ]),

  // ── app() — init ─────────────────────────────────────────────────────────
  t("app function", [
    t("accepts plain object as init state", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)

        const dispatch = app({
          node,
          init: { count: 0 },
          view: () => h("div", {}),
        })

        resolve([equal(typeof dispatch, "function")])
      }),
    ]),

    t("accepts action as init", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let seen = null

        app({
          node,
          init: (state) => ({ ...state, ready: true }),
          view: (state) => {
            seen = state
            return h("div", {})
          },
        })

        resolve([equal(seen?.ready, true)])
      }),
    ]),

    t("renders text node", [
      new Promise((resolve) => {
        const container = makeNode("body")
        const node = makeNode("div")
        container.appendChild(node)

        app({
          node,
          init: {},
          view: () => text("hello"),
        })

        resolve([equal(container.childNodes[0].nodeValue, "hello")])
      }),
    ]),

    // ── dispatch ──────────────────────────────────────────────────────────

    t("dispatch with action updates state", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let lastState = null

        const dispatch = app({
          node,
          init: { n: 0 },
          view: (state) => { lastState = state; return h("div", {}) },
        })

        const Inc = (state) => ({ ...state, n: state.n + 1 })
        dispatch(Inc)
        resolve([equal(lastState.n, 1)])
      }),
    ]),

    t("dispatch with [action, payload] tuple", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let lastState = null

        const dispatch = app({
          node,
          init: { n: 0 },
          view: (state) => { lastState = state; return h("div", {}) },
        })

        const Add = (state, amount) => ({ ...state, n: state.n + amount })
        dispatch(Add, 5)
        resolve([equal(lastState.n, 5)])
      }),
    ]),

    t("dispatch with state array runs effects", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)

        let effectRan = false
        const fakeEffect = (dispatch) => { effectRan = true }

        const dispatch = app({
          node,
          init: { n: 0 },
          view: () => h("div", {}),
        })

        dispatch([{ n: 1 }, [fakeEffect]])
        resolve([equal(effectRan, true)])
      }),
    ]),

    t("dispatch with null state stops the app", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let renderCount = 0

        const dispatch = app({
          node,
          init: { alive: true },
          view: (state) => { renderCount++; return h("div", {}) },
        })

        const countBefore = renderCount
        dispatch(null)
        dispatch((s) => ({ ...s })) // should be ignored after null
        resolve([equal(renderCount, countBefore)])
      }),
    ]),

    // ── patch / vdom diffing ──────────────────────────────────────────────

    t("patches text node value in place", [
      new Promise((resolve) => {
        const container = makeNode("body")
        const node = makeNode("div")
        container.appendChild(node)

        const dispatch = app({
          node,
          init: { msg: "before" },
          view: (state) => text(state.msg),
        })

        // patch() replaces the mount node in-place and updates nodeValue
        dispatch({ msg: "after" })
        const textNode = container.childNodes[0]
        resolve([equal(textNode?.nodeValue, "after")])
      }),
    ]),

    t("adds new children when list grows", [
      new Promise((resolve) => {
        const node = makeNode("ul")
        makeNode("body").appendChild(node)

        const dispatch = app({
          node,
          init: { items: ["a"] },
          view: ({ items }) =>
            h("ul", {}, items.map((i) => h("li", {}, text(i)))),
        })

        dispatch({ items: ["a", "b", "c"] })
        resolve([equal(node.parentNode.childNodes[0].childNodes.length, 3)])
      }),
    ]),

    t("removes children when list shrinks", [
      new Promise((resolve) => {
        const node = makeNode("ul")
        makeNode("body").appendChild(node)

        const dispatch = app({
          node,
          init: { items: ["a", "b", "c"] },
          view: ({ items }) =>
            h("ul", {}, items.map((i) => h("li", {}, text(i)))),
        })

        dispatch({ items: ["a"] })
        resolve([equal(node.parentNode.childNodes[0].childNodes.length, 1)])
      }),
    ]),

    t("patches keyed children efficiently", [
      new Promise((resolve) => {
        const node = makeNode("ul")
        makeNode("body").appendChild(node)

        const dispatch = app({
          node,
          init: { items: ["x", "y", "z"] },
          view: ({ items }) =>
            h("ul", {}, items.map((i) => h("li", { key: i }, text(i)))),
        })

        dispatch({ items: ["z", "x"] })
        const ul = node.parentNode.childNodes[0]
        resolve([
          equal(ul.childNodes.length, 2),
          equal(ul.childNodes[0].childNodes[0].nodeValue, "z"),
          equal(ul.childNodes[1].childNodes[0].nodeValue, "x"),
        ])
      }),
    ]),

    t("replaces element when tag changes", [
      new Promise((resolve) => {
        const container = makeNode("body")
        const node = makeNode("div")
        container.appendChild(node)

        const dispatch = app({
          node,
          init: { asButton: false },
          view: ({ asButton }) => asButton ? h("button", {}) : h("span", {}),
        })

        dispatch({ asButton: true })
        const replaced = container.childNodes[0]
        resolve([equal(replaced.nodeName, "BUTTON")])
      }),
    ]),

    // ── patchProperty ─────────────────────────────────────────────────────

    t("sets style object properties", [
      new Promise((resolve) => {
        const container = makeNode("body")
        const node = makeNode("div")
        container.appendChild(node)

        app({
          node,
          init: {},
          view: () => h("div", { style: { color: "red" } }),
        })

        const div = container.childNodes[0]
        resolve([equal(div.style.color, "red")])
      }),
    ]),

    t("removes attribute when value is null", [
      new Promise((resolve) => {
        const container = makeNode("body")
        const node = makeNode("div")
        container.appendChild(node)

        const dispatch = app({
          node,
          init: { show: true },
          view: ({ show }) =>
            h("div", { "data-show": show ? "yes" : null }),
        })

        dispatch({ show: false })
        const div = container.childNodes[0]
        resolve([equal(div._attrs?.["data-show"], undefined)])
      }),
    ]),

    t("attaches and detaches event listeners", [
      new Promise((resolve) => {
        const container = makeNode("body")
        const node = makeNode("div")
        container.appendChild(node)
        let clicked = 0

        const OnClick = (state) => ({ ...state })
        const dispatch = app({
          node,
          init: { hasHandler: true },
          view: ({ hasHandler }) =>
            h("button", { onclick: hasHandler ? OnClick : undefined }),
        })

        // Verify listener was attached
        const btn = () => container.childNodes[0]
        const hadListener = !!btn()._listeners?.click

        // Remove handler
        dispatch({ hasHandler: false })
        const hasListener = !!btn()._listeners?.click

        resolve([
          equal(hadListener, true),
          equal(hasListener, false),
        ])
      }),
    ]),

    // ── subscriptions ─────────────────────────────────────────────────────

    t("starts subscription on init", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let started = false
        let stopped = false

        const MySub = (dispatch, payload) => {
          started = true
          return () => { stopped = true }
        }

        const dispatch = app({
          node,
          init: { active: true },
          view: () => h("div", {}),
          subscriptions: (state) => [
            state.active && [MySub, {}],
          ],
        })

        resolve([equal(started, true)])
      }),
    ]),

    t("stops subscription when it becomes false", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let stopped = false

        const MySub = (dispatch) => () => { stopped = true }

        const dispatch = app({
          node,
          init: { active: true },
          view: () => h("div", {}),
          subscriptions: (state) => [
            state.active && [MySub, {}],
          ],
        })

        dispatch({ active: false })
        resolve([equal(stopped, true)])
      }),
    ]),

    t("restarts subscription when props change", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let startCount = 0

        const MySub = (dispatch, payload) => {
          startCount++
          return () => {}
        }

        const dispatch = app({
          node,
          init: { interval: 1000 },
          view: () => h("div", {}),
          subscriptions: (state) => [[MySub, { ms: state.interval }]],
        })

        dispatch({ interval: 2000 })
        resolve([equal(startCount, 2)])
      }),
    ]),

    t("does not restart subscription when props are unchanged", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        let startCount = 0

        const MySub = (dispatch, payload) => {
          startCount++
          return () => {}
        }

        const dispatch = app({
          node,
          init: { x: 1 },
          view: () => h("div", {}),
          subscriptions: (state) => [[MySub, { ms: 100 }]],
        })

        dispatch({ x: 2 }) // subscription props unchanged
        resolve([equal(startCount, 1)])
      }),
    ]),

    // ── dispatch middleware ───────────────────────────────────────────────

    t("dispatch middleware wraps dispatch", [
      new Promise((resolve) => {
        const node = makeNode("div")
        makeNode("body").appendChild(node)
        const log = []

        const dispatch = app({
          node,
          init: { n: 0 },
          view: () => h("div", {}),
          dispatch: (realDispatch) => (action, payload) => {
            log.push("before")
            realDispatch(action, payload)
            log.push("after")
          },
        })

        dispatch((s) => ({ ...s, n: 1 }))
        resolve([
          equal(log[0], "before"),
          equal(log[1], "after"),
        ])
      }),
    ]),
  ]),
]
