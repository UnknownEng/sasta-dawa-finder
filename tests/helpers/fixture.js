// Builds a small dataset from tests/fixtures/raw_rows.json through the real pipeline.
const path = require('path');
const { buildFromRaw } = require('../../scripts/sync_drap');
const SDData = require('../../js/data');
const SDSearch = require('../../js/search');

const raw = require('../fixtures/raw_rows.json');
const hints = {
  popular: ['Panadol', 'Risek', 'Augmentin', 'Glucophage', 'Brufen'],
  synonyms: { paracetamol: ['acetaminophen', 'apap'] },
};

function fixtureJson() {
  return buildFromRaw(raw, hints, new Date('2026-11-10T00:00:00Z')).out;
}

function fixtureEngine() {
  const ds = SDData.expand(fixtureJson());
  return { ds, engine: SDSearch.createEngine(ds) };
}

function find(ds, product) {
  return ds.items.find((m) => m.product === product);
}

module.exports = { fixtureJson, fixtureEngine, find, root: path.resolve(__dirname, '../..') };
