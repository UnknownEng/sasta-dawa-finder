const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrain, renderMarkdown } = require('../js/assistant');
const { fixtureEngine } = require('./helpers/fixture');

const { ds, engine } = fixtureEngine();
const cabinet = [];
const brain = createBrain(engine, {
  categories: ds.categories,
  getCabinet: () => cabinet,
  addToCabinet: (id) => (cabinet.some((x) => x.id === id) ? false : (cabinet.push({ id, qty: 1 }), true)),
});
const ask = (q, ctx) => brain.reply(q, { lang: 'en', ...(ctx || {}) });
const joined = (r) => r.text.join('\n');

test('emergencies always come first', () => {
  for (const q of ['I took an overdose of panadol', 'mere bachay ne zeher kha liya', 'chest pain and cant breathe']) {
    const r = ask(q);
    assert.ok(r.urgent, q);
    assert.match(joined(r), /1122/);
  }
});

test('cheaper alternatives (English & Roman Urdu)', () => {
  for (const q of ['cheaper alternative to panadol', 'panadol ka sasta option', 'panadol substitute']) {
    const r = ask(q);
    assert.match(joined(r), /Febrol/, q);
    assert.equal(engine.byId(r.cards[0].id).name, 'Febrol');
    assert.equal(r.cards[0].kind, 'cheap');
  }
});

test('price and formula questions', () => {
  const p = ask('risek 40 ki qeemat');
  assert.match(joined(p), /Risek 40mg/);
  assert.match(joined(p), /Rs 560/);
  const f = ask('what is the formula of augmentin');
  assert.match(joined(f), /Amoxicillin \+ Clavulanic Acid/);
});

test('follow-up uses the previous medicine', () => {
  const first = ask('glucophage');
  const r = ask('aur sasta?', { lastMedId: first.context.lastMedId });
  assert.match(joined(r), /Neodipar/);
});

test('compare: same formula vs different medicines', () => {
  const same = ask('risek vs omega');
  assert.match(joined(same), /same formula/i);
  const diff = ask('panadol vs brufen');
  assert.match(joined(diff), /different medicines/i);
});

test('refuses dosing / diagnosis advice but still helps with facts', () => {
  const r = ask('how many panadol can I take in a day?');
  assert.match(joined(r), /can’t advise/);
  assert.ok(r.cards.length >= 1);
  const sym = ask('mujhe bukhar hai kya loon');
  assert.match(joined(sym), /can’t (advise|tell)/);
});

test('symptoms route to a category without recommending a drug', () => {
  const r = ask('I have acidity');
  assert.ok(r.actions.some((a) => a.value === '/category/stomach'));
  assert.equal(r.cards.length, 0);
});

test('My Medicines via chat', () => {
  const add = ask('add brufen to my medicines');
  assert.match(joined(add), /Added/);
  const sum = ask('my medicines');
  assert.match(joined(sum), /Monthly cost/);
});

test('Urdu replies and unknown medicines', () => {
  const r = brain.reply('panadol ka sasta option', { lang: 'ur' });
  assert.match(joined(r), /برانڈ/);
  const nf = ask('zzqqxx');
  assert.match(joined(nf), /couldn’t find/);
  const dym = ask('panadool');
  assert.match(joined(dym), /Panadol/, 'fuzzy match answers directly');
});

test('markdown renderer escapes HTML', () => {
  const html = renderMarkdown('**Bold** <img src=x onerror=alert(1)>\n- one\n- two');
  assert.ok(!html.includes('<img'));
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('href'));
});
