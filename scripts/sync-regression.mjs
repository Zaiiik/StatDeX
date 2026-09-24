import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const start = html.indexOf('const v2214Obj=');
const marker = 'window.LevelingCloudMergeV2214={merge:v2214MergeAppData,compare:v2214CompareProgress};';
const end = html.indexOf(marker, start);
assert.ok(start >= 0 && end > start, 'Le moteur de fusion V22.1.4 doit être présent.');

const context = { window: {} };
runInNewContext(html.slice(start, end + marker.length), context, { filename: 'cloud-merge-v2214.js' });
const { merge, compare } = context.window.LevelingCloudMergeV2214;

const sessions = count => Array.from({ length: count }, (_, id) => ({ id: `session-${id}`, date: `2026-09-${String((id % 28) + 1).padStart(2, '0')}` }));

const regressedCloud = {
  cycleNumber: 1,
  currentBlockIndex: 2,
  currentDayIndex: 0,
  activeProgramKey: 'powerbuilding',
  userData: {
    workoutsCompleted: 61,
    level: 20,
    validatedSessions: { leveling_validated_powerbuilding_2_0: 100 },
    absentSessions: {},
    skippedSets: { 'powerbuilding|2|0|0|0': 100 },
    systemAI: { events: [{ id: 'old', cycle: 1 }], current: { leveling_validated_powerbuilding_2_0: { cycle: 1 } } }
  },
  validatedSessions: { leveling_validated_powerbuilding_2_0: '1' },
  programWorkoutStates: { powerbuilding: { 2: { 0: { 0: { 0: true } } } }, custom: { keep: true } },
  programCustomSetData: { powerbuilding: { 2: { 0: { 0: { 0: { weight: 80 } } } } } },
  v10: { totalXp: 19420, sessions: sessions(61) }
};

const recoveredDevice = {
  cycleNumber: 2,
  currentBlockIndex: 0,
  currentDayIndex: 1,
  activeProgramKey: 'powerbuilding',
  userData: {
    workoutsCompleted: 68,
    level: 20,
    validatedSessions: {
      leveling_validated_powerbuilding_0_0: 200,
      leveling_validated_powerbuilding_0_1: 201
    },
    absentSessions: {},
    skippedSets: { 'powerbuilding|0|1|0|0': 200 },
    systemAI: {
      events: [{ id: 'new', cycle: 2 }],
      current: { leveling_validated_powerbuilding_0_1: { cycle: 2 } }
    }
  },
  validatedSessions: {
    leveling_validated_powerbuilding_0_0: '1',
    leveling_validated_powerbuilding_0_1: '1'
  },
  programWorkoutStates: { powerbuilding: { 0: { 1: { 0: { 0: true } } } } },
  programCustomSetData: { powerbuilding: { 0: { 1: { 0: { 0: { weight: 90 } } } } } },
  v10: { totalXp: 21850, sessions: sessions(68) }
};

assert.equal(compare(recoveredDevice, regressedCloud), 1, 'Le cycle local plus avancé doit gagner.');
const recovered = merge(regressedCloud, recoveredDevice);
assert.equal(recovered.cycleNumber, 2);
assert.equal(recovered.userData.workoutsCompleted, 68);
assert.equal(recovered.v10.totalXp, 21850);
assert.equal(recovered.userData.level, 22);
assert.equal(recovered.v10.sessions.length, 68);
assert.equal(recovered.currentBlockIndex, 0);
assert.equal(recovered.currentDayIndex, 1);
assert.equal(recovered.validatedSessions.leveling_validated_powerbuilding_0_0, '1');
assert.equal(recovered.validatedSessions.leveling_validated_powerbuilding_0_1, '1');
assert.equal(recovered.validatedSessions.leveling_validated_powerbuilding_2_0, undefined, 'Les validations de l’ancien cycle ne doivent pas revenir.');
assert.equal(recovered.userData.systemAI.current.leveling_validated_powerbuilding_2_0, undefined);
assert.equal(recovered.userData.skippedSets['powerbuilding|2|0|0|0'], undefined);
assert.equal(recovered.programWorkoutStates.powerbuilding[0][1][0][0], true);
assert.equal(recovered.programWorkoutStates.custom.keep, true, 'Les autres programmes restent conservés.');

const freshCloud = {
  ...recoveredDevice,
  currentDayIndex: 0,
  userData: {
    ...recoveredDevice.userData,
    validatedSessions: {},
    skippedSets: {},
    systemAI: { events: recoveredDevice.userData.systemAI.events, current: {} }
  },
  validatedSessions: {},
  programWorkoutStates: { ...recoveredDevice.programWorkoutStates, powerbuilding: {} },
  programCustomSetData: { ...recoveredDevice.programCustomSetData, powerbuilding: {} }
};
const staleDevice = { ...regressedCloud, userData: { ...regressedCloud.userData, workoutsCompleted: 68 }, v10: { totalXp: 21850, sessions: sessions(68) } };
const afterReset = merge(freshCloud, staleDevice);
assert.equal(afterReset.cycleNumber, 2);
assert.deepEqual(afterReset.programWorkoutStates.powerbuilding, {});
assert.equal(afterReset.validatedSessions.leveling_validated_powerbuilding_2_0, undefined);
assert.equal(afterReset.userData.systemAI.current.leveling_validated_powerbuilding_2_0, undefined);

const tieCloud = { ...freshCloud, currentDayIndex: 0 };
const tieLocal = { ...freshCloud, currentDayIndex: 1 };
assert.equal(merge(tieCloud, tieLocal).currentDayIndex, 1, 'Le jour le plus avancé gagne une égalité propre.');
assert.equal(merge(tieCloud, tieLocal, { preferLocalOnTie: true }).currentDayIndex, 1, 'Une modification locale avancée reste conservée.');
const advancedCloud = { ...freshCloud, currentBlockIndex: 0, currentDayIndex: 1 };
const stalePointer = { ...freshCloud, currentBlockIndex: 0, currentDayIndex: 0 };
assert.equal(merge(advancedCloud, stalePointer, { preferLocalOnTie: true }).currentDayIndex, 1, 'Un pointeur local ancien ne doit jamais faire reculer le jour cloud.');
const falseValidation = {
  ...freshCloud,
  userData: { ...freshCloud.userData, validatedSessions: { leveling_validated_powerbuilding_0_0: false } },
  validatedSessions: { leveling_validated_powerbuilding_0_0: false }
};
assert.equal(merge(recoveredDevice, falseValidation).validatedSessions.leveling_validated_powerbuilding_0_0, '1', 'Une validation vraie ne peut pas être annulée à cycle égal.');

const protectedCloud = merge(recoveredDevice, regressedCloud);
assert.equal(protectedCloud.cycleNumber, 2, 'Un ancien appareil ne doit pas faire régresser le cycle cloud.');
assert.equal(protectedCloud.v10.totalXp, 21850, 'Un ancien appareil ne doit pas faire régresser les XP cloud.');
assert.equal(protectedCloud.v10.sessions.length, 68, 'Un ancien appareil ne doit pas supprimer des séances cloud.');

console.log('LEVELING-APP cloud sync regression — 4/4 scénarios validés');
