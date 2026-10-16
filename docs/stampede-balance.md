# Cuddle Stampede balance

The original stampede paid 9 rally per ordinary kill toward a 100-rally
replacement. Twelve kills guaranteed another use without any leaves. Each kill
also had an 8% chance to drop a 35-rally leaf: with perfect collection, the
expected return was 11.8 rally per kill. A sufficiently large crowd could keep
the loop going indefinitely. The three-use bank also stored up to 100 extra
rally, effectively hiding a fourth use.

The revised rules:

- Stampede kills still award score and boss recruitment flags, but award no
  rally or charging leaves. Accurate throws retain their chain and boss rewards.
- Each charge costs 150 rally, up from 100. Leaves give 25 rally, down from 35.
- Bank at most two uses. Reaching the cap discards excess rally; charging resumes
  from zero after spending. The starting free use stays.

## Simulation

Run `node scripts/simulate-stampedes.mjs --compare-ref e70ca13 --check` to compare
against the original rules and check the revised rules. No dependencies beyond
Node.js and Git are needed. Omit `--compare-ref e70ca13` for a quick current-only
check.

The harness loads the actual game functions in a headless VM with a seeded RNG.
For each crowd size it runs 100 seeds, starting with the normal single free
stampede and zero rally, and stops after running out or reaching 100 uses.
Each encounter supplies the same number of ordinary Moseses within sweep range;
the real stampede update runs at 60 Hz. Every dropped leaf is collected instantly
for free before the next encounter. These are ideal conditions for exploiting
self-recharge, not a simulation of full-run survival or a guarantee that those
crowds can be assembled safely in every wave. Scheduled pickups, manual throws,
and boss summons do not enter this isolated loop test.

| Moseses per sweep | Old mean consecutive uses | Old runs reaching 100 | New mean consecutive uses | New runs reaching 100 |
| --- | ---: | ---: | ---: | ---: |
| 6 | 1.15 | 0/100 | 1 | 0/100 |
| 8 | 4.16 | 0/100 | 1 | 0/100 |
| 10 | 53.63 | 53/100 | 1 | 0/100 |
| 12 | 100 | 100/100 | 1 | 0/100 |
| 20 | 100 | 100/100 | 1 | 0/100 |
| 40 | 100 | 100/100 | 1 | 0/100 |

Manual charging from zero, with random leaf drops disabled:

| Ideal manual play | Old kills to earn one use | New kills to earn one use |
| --- | ---: | ---: |
| Single-hit kills | 12 | 17 |
| Repeated four-hit chains | 9 | 13 |
| Four-hit chains, plus one collected leaf every four kills | 6 | 9 |

The chain examples assume the four-hit chain limit has already been unlocked by
successful throws. They measure charge rewards, not throw travel time. A leaf
every four kills is a sensitivity example, not the random drop rate. Players can
still earn repeated stampedes through manual play and scheduled leaves, but
stampede kills cannot finance their own replacements.

Regression checks cover ordinary and boss sweep kills (including forced leaf
drop rolls), scoring and recruitment drops, manual chain/boss/leaf rewards,
charge thresholds, partial carry below the cap, overflow at the cap, and HUD
progress before and after spending from a full bank.
