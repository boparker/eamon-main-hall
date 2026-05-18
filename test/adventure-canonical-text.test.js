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

test('Beginner’s Cave room narration keeps original kdechant/Eamon room text separate from tutorial artifacts', () => {
  assert.equal(room(9).narration_text, 'You are in a small stark cell with a door on the east side.');
  assert.equal(room(11).narration_text, 'You are in a small stark cell with a door on the west side.');
  assert.equal(room(21).narration_text, 'You are in an unremarkable tunnel. You can see torch light in both directions.');
  assert.equal(room(24).narration_text, 'You are in a very rough tunnel carved out of a series of natural caverns. Dim light can be seen in both directions.');

  assert.equal(item('inscription-get-all').description, 'You see an inscription on the wall which reads, "You can type GET ALL to pick up everything in the room. This will usually not pick up dead bodies or immovable objects like doors and inscriptions."');
  assert.equal(item('writing-command-history').description, 'You see some words chiseled into the wall: "To repeat the last command, just hit the Enter key again. To recall previous commands, use the up and down arrow keys."');
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
