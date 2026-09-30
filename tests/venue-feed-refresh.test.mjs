import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/live-shell/app/01-user-agent.js", import.meta.url), "utf8");
const reconciliation = source.slice(source.indexOf("    const stableMediaSnapshots"), source.indexOf("    const markets = {"));

// Minimal DOM operations for exercising the production reconciler in Node.
class DomNode {
  constructor(name, attributes = {}, children = []) {
    this.nodeName = name;
    this.nodeType = name === "#text" ? 3 : 1;
    this.nodeValue = name === "#text" ? attributes : null;
    this.attrs = new Map(name === "#text" ? [] : Object.entries(attributes));
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
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.ok(index >= 0, "insertion target must belong to the parent");
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  cloneNode(deep) {
    return new DomNode(this.nodeName, this.nodeType === 3 ? this.nodeValue : Object.fromEntries(this.attrs), deep ? this.childNodes.map(child => child.cloneNode(true)) : []);
  }
  isEqualNode(other) {
    return this.nodeName === other.nodeName && this.nodeValue === other.nodeValue &&
      this.attrs.size === other.attrs.size && [...this.attrs].every(([name, value]) => other.getAttribute(name) === value) &&
      this.childNodes.length === other.childNodes.length && this.childNodes.every((child, index) => child.isEqualNode(other.childNodes[index]));
  }
}

const text = value => new DomNode("#text", value);
const avatar = (id, url = `${id}.jpg`) => new DomNode("BUTTON", { "data-public-dancer-id": id }, [
  new DomNode("IMG", { src: url, srcset: `${url} 1x`, sizes: "32px", "data-image-state": "loading", loading: "lazy", style: "object-position: 50% 50%" }),
]);
const card = (id, { following = false, dancers = ["one", "two"], hours = "Open" } = {}) => new DomNode("ARTICLE", { "data-discovery-key": id }, [
  new DomNode("IMG", { src: `${id}-logo.svg`, "data-image-state": "loading" }),
  new DomNode("SPAN", {}, [text(hours)]),
  new DomNode("DIV", {}, dancers.map(id => avatar(id))),
  new DomNode("BUTTON", { "aria-pressed": String(following) }, [text(following ? "Following" : "Follow")]),
]);

function fixture() {
  const context = vm.createContext({});
  vm.runInContext(reconciliation, context);
  const results = new DomNode("DIV");
  return { results, render: (...cards) => context.syncStableMediaChildren(results, new DomNode("DIV", {}, cards)) };
}

test("saved Follow updates preserve the card, focused button, loaded logo and loading portraits", () => {
  const { results, render } = fixture();
  render(card("club"), card("other"));
  const [club, other] = results.childNodes;
  const [logo, , lineup, follow] = club.childNodes;
  const [one, two] = lineup.childNodes;
  logo.setAttribute("data-image-state", "ready");
  logo.setAttribute("style", "width: 90px");
  one.childNodes[0].setAttribute("data-image-state", "ready");
  two.childNodes[0].setAttribute("loading", "eager");

  render(card("club", { following: true }), card("other"));
  assert.equal(results.childNodes[0], club);
  assert.equal(results.childNodes[1], other);
  assert.equal(club.childNodes[0], logo);
  assert.equal(logo.getAttribute("style"), "width: 90px");
  assert.equal(logo.getAttribute("data-image-state"), "ready");
  assert.equal(club.childNodes[3], follow, "a focused Follow button stays mounted");
  assert.equal(follow.getAttribute("aria-pressed"), "true");
  assert.equal(follow.childNodes[0].nodeValue, "Following");
  assert.equal(lineup.childNodes[0], one);
  assert.equal(one.childNodes[0].getAttribute("data-image-state"), "ready");
  assert.equal(lineup.childNodes[1], two);
  assert.equal(two.childNodes[0].getAttribute("loading"), "eager", "an in-flight image is not restarted");
});

test("lineup and venue reordering preserve matching dancers while additions and removals take effect", () => {
  const { results, render } = fixture();
  render(card("a"), card("b"));
  const [a, b] = results.childNodes;
  const [one, two] = a.childNodes[2].childNodes;
  render(card("b"), card("c"), card("a", { dancers: ["two", "three", "one"] }));
  assert.equal(results.childNodes[0], b);
  assert.equal(results.childNodes[2], a);
  assert.equal(a.childNodes[2].childNodes[0], two);
  assert.equal(a.childNodes[2].childNodes[2], one);
  assert.equal(a.childNodes[2].childNodes[1].getAttribute("data-public-dancer-id"), "three");
  render(card("a", { dancers: ["two"] }));
  assert.deepEqual(results.childNodes, [a]);
  assert.deepEqual(a.childNodes[2].childNodes, [two]);
  assert.equal(one.parentNode, null);
  assert.equal(b.parentNode, null);
});

test("updated photo sources enter loading while another dancer's recovered image stays ready", () => {
  const { results, render } = fixture();
  render(card("a"));
  const [one, two] = results.childNodes[0].childNodes[2].childNodes;
  const oldPhoto = one.childNodes[0], recovered = two.childNodes[0];
  oldPhoto.setAttribute("data-image-state", "ready");
  recovered.setAttribute("src", "two-original.jpg?image_retry=1");
  recovered.removeAttribute("srcset");
  recovered.setAttribute("data-image-state", "ready");
  const update = card("a", { hours: "Closed" });
  const updatedPhoto = update.childNodes[2].childNodes[0].childNodes[0];
  updatedPhoto.setAttribute("src", "one-new.jpg");
  updatedPhoto.setAttribute("srcset", "one-new.jpg 1x");
  render(update);
  assert.notEqual(one.childNodes[0], oldPhoto);
  assert.equal(one.childNodes[0].getAttribute("src"), "one-new.jpg");
  assert.equal(one.childNodes[0].getAttribute("data-image-state"), "loading");
  assert.equal(oldPhoto.parentNode, null);
  assert.equal(two.childNodes[0], recovered);
  assert.equal(recovered.getAttribute("src"), "two-original.jpg?image_retry=1");
  assert.equal(recovered.getAttribute("data-image-state"), "ready");
  assert.equal(results.childNodes[0].childNodes[1].childNodes[0].nodeValue, "Closed");
});

test("unchanged data preserves runtime attributes and empty results remove stale cards", () => {
  const { results, render } = fixture();
  render(card("a"));
  const original = results.childNodes[0];
  original.setAttribute("aria-current", "true");
  render(card("a"));
  assert.equal(results.childNodes[0], original);
  assert.equal(original.getAttribute("aria-current"), "true");
  render();
  assert.equal(results.childNodes.length, 0);
  render(card("a", { dancers: [] }));
  assert.notEqual(results.childNodes[0], original);
  assert.equal(results.childNodes[0].childNodes[2].childNodes.length, 0);
});

test("Follow request cleanup keeps the newly rendered label on a reused button", async () => {
  const actions = readFileSync(new URL("../src/live-shell/app/22-create-home-tv-landing-preloader.js", import.meta.url), "utf8");
  const handler = actions.slice(actions.indexOf("      const followVenueButton ="), actions.indexOf("      const venueJump ="));
  const button = new DomNode("BUTTON");
  button.dataset = { venueFollow: "club-id" };
  button.innerHTML = "Follow";
  const state = {
    event: { target: { closest: () => button }, preventDefault() {}, stopPropagation() {} },
    requireCustomerAccountForProfileAction: () => true,
    resolveVenueByName: () => ({ id: "club-id", name: "Club", city: "Las Vegas" }),
    followedVenuesByCity: { "Las Vegas": [] }, customerSavedStateVersion: 0,
    getAuthenticatedJson: async () => ({}),
    postAuthenticatedJson: async (_url, data) => ({ ok: true, following: data.following }),
    window: { dispatchEvent() {} }, CustomEvent: class {},
    customerDashboard: { classList: { contains: () => false } },
    render() { button.innerHTML = state.followedVenuesByCity["Las Vegas"].length ? "Following" : "Follow"; },
    showToast(message) { throw new Error(message); },
  };
  vm.runInNewContext(`async function handleFollow() { ${handler} }`, state);
  await state.handleFollow();
  assert.equal(button.innerHTML, "Following");
  assert.equal(button.disabled, false);
  assert.equal(button.hasAttribute("aria-busy"), false);
  await state.handleFollow();
  assert.equal(button.innerHTML, "Follow");
  assert.equal(button.disabled, false);
});
