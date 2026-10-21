import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Only the DOM operations used by the shipped card patcher; no browser/E2E.
class Node {
  constructor(name, attributes = {}, children = []) {
    this.nodeName = name;
    this.nodeType = name === "#text" ? 3 : 1;
    this.nodeValue = name === "#text" ? attributes : null;
    this.attrs = new Map(this.nodeType === 3 ? [] : Object.entries(attributes));
    this.childNodes = [];
    this.parentNode = null;
    children.forEach(child => this.insertBefore(child, null));
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  removeAttribute(name) { this.attrs.delete(name); }
  insertBefore(node, before) {
    node.remove();
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node);
    node.parentNode = this;
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  cloneNode(deep) {
    return new Node(this.nodeName, this.nodeType === 3 ? this.nodeValue : Object.fromEntries(this.attrs), deep ? this.childNodes.map(child => child.cloneNode(true)) : []);
  }
  isEqualNode(other) {
    return this.nodeName === other.nodeName && this.nodeValue === other.nodeValue && this.attrs.size === other.attrs.size
      && [...this.attrs].every(([name, value]) => other.getAttribute(name) === value)
      && this.childNodes.length === other.childNodes.length && this.childNodes.every((child, index) => child.isEqualNode(other.childNodes[index]));
  }
}
const card = (id, name = id, src = `${id}.jpg`) => new Node("ARTICLE", { "data-public-dancer-id": id }, [
  new Node("IMG", { src, "data-image-state": "loading" }), new Node("SPAN", {}, [new Node("#text", name)]),
]);
function fixture() {
  const window = {};
  vm.runInNewContext(readFileSync(new URL("../public/dancer-grid-card.js", import.meta.url), "utf8"), { window });
  const container = new Node("DIV");
  let next;
  container.ownerDocument = { createElement() { return { set innerHTML(_markup) {}, get content() { return next; } }; } };
  return { container, render(...cards) { next = new Node("DIV", {}, cards); window.MydancrDancerGrid.update(container, "fixture"); } };
}

test("refresh updates metadata and rank order without remounting visible cards or photos", () => {
  const f = fixture();
  f.render(card("one"), card("two"));
  const [one, two] = f.container.childNodes;
  const photo = one.childNodes[0];
  photo.setAttribute("data-image-state", "ready");
  f.render(card("two"), card("one", "Updated name"), card("three"));
  assert.equal(f.container.childNodes[0], two);
  assert.equal(f.container.childNodes[1], one);
  assert.equal(one.childNodes[0], photo);
  assert.equal(photo.getAttribute("data-image-state"), "ready");
  assert.equal(one.childNodes[1].childNodes[0].nodeValue, "Updated name");
  f.render(card("one", "Updated name"));
  assert.deepEqual(f.container.childNodes, [one]);
  assert.equal(two.parentNode, null, "confirmed removals take effect");
});

test("a changed portrait only replaces that image, and an empty response removes all cards", () => {
  const f = fixture();
  f.render(card("one"), card("two"));
  const [one, two] = f.container.childNodes;
  const oldPhoto = one.childNodes[0], unchangedPhoto = two.childNodes[0];
  unchangedPhoto.setAttribute("data-image-state", "ready");
  f.render(card("one", "one", "new.jpg"), card("two"));
  assert.equal(f.container.childNodes[0], one);
  assert.notEqual(one.childNodes[0], oldPhoto);
  assert.equal(one.childNodes[0].getAttribute("src"), "new.jpg");
  assert.equal(two.childNodes[0], unchangedPhoto);
  assert.equal(unchangedPhoto.getAttribute("data-image-state"), "ready");
  f.render();
  assert.deepEqual(f.container.childNodes, []);
});
