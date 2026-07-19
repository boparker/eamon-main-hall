import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stagedNpc, stageOf, stageData, setStage, stageTransition, tickStages, tickAttrition,
} from '../../server/engine/mechanics.js';

const adventure = {
  mechanics: {
    npc_stages: {
      giant: {
        initial: 'awake',
        stages: {
          awake: { description: 'The giant glowers.', invulnerable: true, futile_text: 'Steel means nothing.' },
          drunk: { description: 'The giant sways, wine-heavy.', invulnerable: true },
          asleep: { description: 'The giant sprawls, snoring.', hostile: false },
          blinded: { description: 'The blinded giant rages.' },
        },
        transitions: [
          { from: 'awake', to: 'drunk', on: { give: 'wine' }, text: 'He drains the skin in one pull.' },
          { from: 'drunk', to: 'asleep', on: { turns: 2 }, text: 'The giant slumps into thunderous sleep.' },
          { from: 'asleep', to: 'blinded', on: { use: 'stake' }, text: 'The stake finds the eye.' },
        ],
      },
    },
    attrition: { every: 3, victims: ['crew-a', 'crew-b'], room_number: 10, text: '{name} is taken by the giant.' },
  },
};

test('stages: initial, explicit set, and per-stage data', () => {
  const run = { flags: {} };
  assert.equal(stageOf(adventure, run, 'giant'), 'awake');
  assert.equal(stageData(adventure, run, 'giant').invulnerable, true);
  const drunk = setStage(run, 'giant', 'drunk');
  assert.equal(stageOf(adventure, drunk, 'giant'), 'drunk');
  assert.equal(stagedNpc(adventure, 'nobody'), null);
});

test('give-transitions fire only from the right stage', () => {
  const run = { flags: {} };
  const t = stageTransition({ adventure, run, slug: 'giant', on: { give: 'wine' } });
  assert.equal(t.to, 'drunk');
  const wrongItem = stageTransition({ adventure, run, slug: 'giant', on: { give: 'cheese' } });
  assert.equal(wrongItem, null);
  const alreadyDrunk = setStage(run, 'giant', 'drunk');
  assert.equal(stageTransition({ adventure, run: alreadyDrunk, slug: 'giant', on: { give: 'wine' } }), null);
  const useT = stageTransition({ adventure, run: setStage(run, 'giant', 'asleep'), slug: 'giant', on: { use: 'stake' } });
  assert.equal(useT.to, 'blinded');
});

test('turn-transitions: the drunk giant slides into sleep after two turns', () => {
  let run = setStage({ flags: {} }, 'giant', 'drunk');
  let out = tickStages(adventure, run);
  assert.equal(stageOf(adventure, out.run, 'giant'), 'drunk'); // turn 1: still up
  out = tickStages(adventure, out.run);
  assert.equal(stageOf(adventure, out.run, 'giant'), 'asleep'); // turn 2: down
  assert.match(out.notes[0], /thunderous sleep/);
});

test('attrition: bites every Nth turn in the right room, victims in order, stops when none left', () => {
  let run = { flags: {}, defeatedEnemies: [] };
  assert.equal(tickAttrition({ adventure, run, roomNumber: 5 }), null, 'clock only runs in its room');
  let bite = tickAttrition({ adventure, run, roomNumber: 10 });
  assert.equal(bite.victim, null);
  run = bite.run;
  run = tickAttrition({ adventure, run, roomNumber: 10 }).run;
  bite = tickAttrition({ adventure, run, roomNumber: 10 });
  assert.equal(bite.victim, 'crew-a'); // third tick eats
  run = bite.run;
  for (let i = 0; i < 3; i++) run = tickAttrition({ adventure, run, roomNumber: 10 }).run ?? run;
  const lost = run.flags.attritionLost;
  assert.deepEqual(lost, ['crew-a', 'crew-b']);
  assert.equal(tickAttrition({ adventure, run, roomNumber: 10 }), null, 'no victims left, clock stops');
});
