import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../data/adventures/beginners-cave.json', import.meta.url), 'utf8'));

function room(number) {
  return manifest.locations.find((location) => location.room_number === number);
}

function character(slug) {
  return manifest.characters.find((entry) => entry.slug === slug);
}

function item(slug) {
  return manifest.items.find((entry) => entry.slug === slug);
}

test('Beginner’s Cave keeps original kdechant/Eamon room narration verbatim', () => {
  assert.equal(room(9).narration_text, 'You are in a small stark cell with a door on the east side.');
  assert.equal(room(11).narration_text, 'You are in a small stark cell with a door on the west side.');
  assert.equal(room(21).narration_text, 'You are in an unremarkable tunnel. You can see torch light in both directions.');
  assert.equal(room(24).narration_text, 'You are in a very rough tunnel carved out of a series of natural caverns. Dim light can be seen in both directions.');
});

test('Tutorial inscriptions teach OUR controls, not the original teletype commands', () => {
  // The Beginner's Cave inscriptions are deliberately localized to this engine:
  // they teach commands that actually work here and must not reference 1980
  // terminal affordances (arrow-key history, the "boat in the bay", etc.).
  assert.equal(item('inscription-get-all').description, 'You see an inscription on the wall which reads, "You needn\'t gather treasure one piece at a time. Type TAKE ALL (or GET ALL) to scoop up everything loose in a room at once. Fixtures, the fallen, and signs like this one stay where they are."');
  assert.match(item('inscription-get-all').description, /TAKE ALL/);
  assert.match(item('writing-ready-wear').description, /READY|WEAR|REMOVE/);
  // No inscription should still teach the dead terminal-isms.
  for (const slug of ['inscription-get-all', 'inscription-case-sensitive', 'inscription-abbreviations', 'writing-command-history', 'inscription-hidden-items', 'writing-ready-wear']) {
    assert.doesNotMatch(item(slug).description, /arrow keys|boat in the bay|secret doors|AT DR/i);
  }
});

test('Beginner’s Cave manifest preserves original kdechant/Eamon character and treasure descriptions', () => {
  assert.equal(character('priest').description, 'There is a huge man in religious garb with an insane look on his face here. In his right hand, he carries a mace.');
  assert.equal(character('gorilla').description, 'There is a huge, hairy, strong and angry gorilla in the room with you!');
  assert.equal(character('pirate').description, 'You see a man with a beard and a brass ring in his ear. He is wearing clothes made out of silk and is wielding a very fancily engraved sword.');

  assert.equal(item('diamonds').description, 'You see a large pile of gleaming diamonds here!');
  assert.equal(item('healing-potion').description, 'There is a bottle with a strange potion inside of it here! It has a label stuck to it that you could READ.');
  assert.equal(item('glowing-book').description, 'There is an old book here. It glows in the darkness and is remarkably well preserved.');
  assert.equal(item('trollsfire').description, 'The Pirate was carrying a beautiful sword. Carved on the hilt, in intricate detail, is the sword\'s name, "TrollsFire".');
});
