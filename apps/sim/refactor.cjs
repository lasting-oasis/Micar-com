const fs = require('fs');

let content = fs.readFileSync('src/VanillaThreeScene.tsx', 'utf8');

// 1. Extract and wrap the Dealership building code into createDealership function
const startToken = `        // Dealership Sales Office Building`;
const endToken = `        // Physical Bank Building located on the main road outside the lot`;

const startIndex = content.indexOf(startToken);
const endIndex = content.indexOf(endToken);

if (startIndex === -1 || endIndex === -1) {
    console.error("Tokens not found!");
    process.exit(1);
}

let dealershipCode = content.substring(startIndex, endIndex);

// We need to modify positions in dealershipCode:
// officeGroup.position.set(-25, 0, -25); -> .set(lotX - 25, 0, lotZ - 25)
dealershipCode = dealershipCode.replace(/officeGroup\.position\.set\(-25, 0, -25\);/, 'officeGroup.position.set(lotX - 25, 0, lotZ - 25);');
dealershipCode = dealershipCode.replace(/sign\.position\.set\(-25, 9, -24\.5\);/, 'sign.position.set(lotX - 25, 9, lotZ - 24.5);');

// lampPositions
dealershipCode = dealershipCode.replace(/const lampPositions = \[\{ x: -35, z: 15 \}, \{ x: 35, z: -15 \}, \{ x: 35, z: 35 \}\];/, 'const lampPositions = [{ x: lotX - 35, z: lotZ + 15 }, { x: lotX + 35, z: lotZ - 15 }, { x: lotX + 35, z: lotZ + 35 }];');

// Parking stalls
dealershipCode = dealershipCode.replace(/const zSpot = Math\.floor\(i\) \* 6 \+ 15;/, 'const zSpot = lotZ + Math.floor(i) * 6 + 15;');
dealershipCode = dealershipCode.replace(/pl\.position\.set\(-6, 0\.01, zSpot\);/, 'pl.position.set(lotX - 6, 0.01, zSpot);');
dealershipCode = dealershipCode.replace(/ll\.position\.set\(-3\.5, 0\.015, zSpot\);/, 'll.position.set(lotX - 3.5, 0.015, zSpot);');
dealershipCode = dealershipCode.replace(/pr\.position\.set\(6, 0\.01, zSpot\);/, 'pr.position.set(lotX + 6, 0.01, zSpot);');
dealershipCode = dealershipCode.replace(/lr\.position\.set\(8\.5, 0\.015, zSpot\);/, 'lr.position.set(lotX + 8.5, 0.015, zSpot);');

// DropOff
dealershipCode = dealershipCode.replace(/dropOffPad\.position\.set\(-40, 0\.01, 50\);/, 'dropOffPad.position.set(lotX - 40, 0.01, lotZ + 50);');
dealershipCode = dealershipCode.replace(/dropOffBorder\.position\.set\(-40, 0\.005, 50\);/, 'dropOffBorder.position.set(lotX - 40, 0.005, lotZ + 50);');

// WashBay
dealershipCode = dealershipCode.replace(/washGroup\.position\.set\(55, 0, -40\);/, 'washGroup.position.set(lotX + 55, 0, lotZ - 40);');

// MechBay
dealershipCode = dealershipCode.replace(/mechGroup\.position\.set\(55, 0, 5\);/, 'mechGroup.position.set(lotX + 55, 0, lotZ + 5);');

// BodyShop
dealershipCode = dealershipCode.replace(/bodyGroup\.position\.set\(55, 0, 50\);/, 'bodyGroup.position.set(lotX + 55, 0, lotZ + 50);');

const wrapper = `
        const builtDealerships = new Set<string>();

        const createDealership = (lotX: number, lotZ: number, playerId: string) => {
${dealershipCode}
            [washGroup, mechGroup, bodyGroup, officeGroup].forEach(g => {
                g.updateMatrixWorld(true);
                g.children.forEach(c => {
                    if (c.userData.solid) staticCollisionBoxes.push(new THREE.Box3().setFromObject(c));
                });
            });
        };
`;

content = content.replace(content.substring(startIndex, endIndex), wrapper + '\n        // Physical Bank Building');

// Fix `[washGroup, mechGroup, bodyGroup, officeGroup].forEach` which was previously outside this block, near line 755
const collisionUpdateIndex = content.indexOf(`        [washGroup, mechGroup, bodyGroup, officeGroup].forEach(g => {`);
if (collisionUpdateIndex !== -1) {
    const endCollIndex = content.indexOf(`        });`, collisionUpdateIndex) + 11;
    content = content.replace(content.substring(collisionUpdateIndex, endCollIndex), '');
}

// 2. Avatar Spawn Logic
content = content.replace(/avatar\.position\.set\(0, 0, 5\);/, `
        const initialMe = stateRef.current.gameState?.players[stateRef.current.playerId || ''];
        if (initialMe && initialMe.lotPosition) {
            avatar.position.set(initialMe.lotPosition.x, 0, initialMe.lotPosition.z + 30);
        } else {
            avatar.position.set(0, 0, 30);
        }
`);

// 3. Interaction Zones Logic in animate
content = content.replace(/const inWashBay = Math\.abs\(m\.position\.x - 55\) < 10 && Math\.abs\(m\.position\.z - \(-40\)\) < 10;/g, 'const inWashBay = Math.abs(m.position.x - ((me?.lotPosition?.x || 0) + 55)) < 10 && Math.abs(m.position.z - ((me?.lotPosition?.z || 0) - 40)) < 10;');
content = content.replace(/if \(Math\.abs\(pPos\.x - 55\) < 25 && Math\.abs\(pPos\.z - 5\) < 25\) \{/g, 'if (Math.abs(pPos.x - ((me?.lotPosition?.x || 0) + 55)) < 25 && Math.abs(pPos.z - ((me?.lotPosition?.z || 0) + 5)) < 25) {');
content = content.replace(/if \(Math\.abs\(pPos\.x - 55\) < 25 && Math\.abs\(pPos\.z - 50\) < 25\) \{/g, 'if (Math.abs(pPos.x - ((me?.lotPosition?.x || 0) + 55)) < 25 && Math.abs(pPos.z - ((me?.lotPosition?.z || 0) + 50)) < 25) {');
content = content.replace(/const inZone = \(Math\.abs\(pPos\.x - 55\) < 25 && \(Math\.abs\(pPos\.z - \(-40\)\) < 25 \|\| Math\.abs\(pPos\.z - 5\) < 25 \|\| Math\.abs\(pPos\.z - 50\) < 25\)\);/, 'const inZone = (Math.abs(pPos.x - ((me?.lotPosition?.x || 0) + 55)) < 25 && (Math.abs(pPos.z - ((me?.lotPosition?.z || 0) - 40)) < 25 || Math.abs(pPos.z - ((me?.lotPosition?.z || 0) + 5)) < 25 || Math.abs(pPos.z - ((me?.lotPosition?.z || 0) + 50)) < 25));');

// 4. Dealership dynamic spawning in animate loop
const animateInjectTarget = `              // Animate smoke particles`;
const animateInject = `
              // Dealership Spawner
              if (current.gameState && current.gameState.players) {
                  Object.values(current.gameState.players).forEach(p => {
                      if (p.lotPosition && !builtDealerships.has(p.id)) {
                          createDealership(p.lotPosition.x, p.lotPosition.z, p.id);
                          builtDealerships.add(p.id);
                      }
                  });
              }

              // Animate smoke particles`;

content = content.replace(animateInjectTarget, animateInject);

fs.writeFileSync('src/VanillaThreeScene.tsx', content);
console.log("Refactoring complete");
