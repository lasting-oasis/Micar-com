        // Dealership Sales Office Building
        const officeMat = new THREE.MeshStandardMaterial({ 
            color: '#f1f5f9', 
            roughness: 0.4,
            metalness: 0.1
        });
        const officeGroup = new THREE.Group();
        officeGroup.position.set(-25, 0, -25);

        const oRoof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 15), officeMat);
        oRoof.position.set(0, 8, 0); oRoof.castShadow = true; officeGroup.add(oRoof);
        
        const oFloor = new THREE.Mesh(new THREE.PlaneGeometry(19, 14), new THREE.MeshStandardMaterial({ color: '#1e293b' }));
        oFloor.rotation.x = -Math.PI / 2; oFloor.position.set(0, 0.05, 0); oFloor.receiveShadow = true; officeGroup.add(oFloor);

        const oWallB = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 0.5), officeMat);
        oWallB.position.set(0, 4, -7.25); oWallB.userData.solid = true; oWallB.castShadow = true; oWallB.receiveShadow = true; officeGroup.add(oWallB);

        const oWallL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 14.5), officeMat);
        oWallL.position.set(-9.75, 4, 0); oWallL.userData.solid = true; oWallL.castShadow = true; oWallL.receiveShadow = true; officeGroup.add(oWallL);

        const oWallR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 14.5), officeMat);
        oWallR.position.set(9.75, 4, 0); oWallR.userData.solid = true; oWallR.castShadow = true; oWallR.receiveShadow = true; officeGroup.add(oWallR);

        // Front Wall Pieces (Leaving a 4-unit door gap in middle)
        const oWallFL = new THREE.Mesh(new THREE.BoxGeometry(7.5, 8, 0.5), officeMat);
        oWallFL.position.set(-6.25, 4, 7.25); oWallFL.userData.solid = true; oWallFL.castShadow = true; oWallFL.receiveShadow = true; officeGroup.add(oWallFL);

        const oWallFR = new THREE.Mesh(new THREE.BoxGeometry(7.5, 8, 0.5), officeMat);
        oWallFR.position.set(6.25, 4, 7.25); oWallFR.userData.solid = true; oWallFR.castShadow = true; oWallFR.receiveShadow = true; officeGroup.add(oWallFR);

        scene.add(officeGroup);
        environmentDisposables.push(officeGroup);

        // Dealership Neon Roof Sign
        const signGeo = new THREE.BoxGeometry(18, 2, 1);
        const signMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, emissive: '#dc2626', emissiveIntensity: 2.0 });
        const sign = new THREE.Mesh(signGeo, signMat);
        sign.position.set(-25, 9, -24.5);
        scene.add(sign);
        environmentDisposables.push(sign);

        // Dynamic Street Lighting
        const poleGeo = new THREE.CylinderGeometry(0.2, 0.4, 15, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: '#27272a', metalness: 0.8, roughness: 0.2 });
        const lampPositions = [{ x: -35, z: 15 }, { x: 35, z: -15 }, { x: 35, z: 35 }];
        
        lampPositions.forEach(pos => {
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(pos.x, 7.5, pos.z);
            pole.castShadow = true;
            scene.add(pole);
            environmentDisposables.push(pole);

            const lampLight = new THREE.PointLight('#fef08a', 2, 50);
            lampLight.position.set(pos.x, 14.5, pos.z);
            lampLight.castShadow = false;
            scene.add(lampLight);
            environmentDisposables.push(lampLight);

            const bulbGeo = new THREE.SphereGeometry(0.6);
            const bulbMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(pos.x, 15, pos.z);
            scene.add(bulb);
            environmentDisposables.push(bulb);
        });

        // Designated Parking Stalls (Moved to start at Z: 15, away from office)
        const padGeo = new THREE.BoxGeometry(5, 0.02, 6);
        const padMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 1 });
        const lineGeo = new THREE.BoxGeometry(0.2, 0.03, 6);
        const lineMat = new THREE.MeshBasicMaterial({ color: '#fbbf24' }); // Yellow parking lines

        for (let i = 0; i < 15; i++) {
            const zSpot = Math.floor(i) * 6 + 15; // Start at Z=15, spaced by 6
            // Left Column Stalls
            const pl = new THREE.Mesh(padGeo, padMat); pl.position.set(-6, 0.01, zSpot); pl.receiveShadow = true; scene.add(pl);
            const ll = new THREE.Mesh(lineGeo, lineMat); ll.position.set(-3.5, 0.015, zSpot); scene.add(ll);
            environmentDisposables.push(pl, ll);

            // Right Column Stalls
            const pr = new THREE.Mesh(padGeo, padMat); pr.position.set(6, 0.01, zSpot); pr.receiveShadow = true; scene.add(pr);
            const lr = new THREE.Mesh(lineGeo, lineMat); lr.position.set(8.5, 0.015, zSpot); scene.add(lr);
            environmentDisposables.push(pr, lr);
        }

        // Delivery Drop-Off Zone (x: -40, z: 15)
        const dropOffGeo = new THREE.BoxGeometry(15, 0.02, 80);
        const dropOffMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9 });
        const dropOffPad = new THREE.Mesh(dropOffGeo, dropOffMat);
        dropOffPad.position.set(-40, 0.01, 50);
        dropOffPad.receiveShadow = true;
        scene.add(dropOffPad);
        environmentDisposables.push(dropOffPad);

        const dropOffBorderGeo = new THREE.BoxGeometry(15.5, 0.03, 80.5);
        const dropOffBorderMat = new THREE.MeshBasicMaterial({ color: '#f87171' }); // Red outline
        const dropOffBorder = new THREE.Mesh(dropOffBorderGeo, dropOffBorderMat);
        dropOffBorder.position.set(-40, 0.005, 50);
        scene.add(dropOffBorder);
        environmentDisposables.push(dropOffBorder);

        const createBuildingSign = (text: string, bgColor: string, txtColor: string) => {
             const canvas = document.createElement('canvas');
             canvas.width = 512; canvas.height = 128;
             const ctx = canvas.getContext('2d')!;
             ctx.fillStyle = bgColor; ctx.roundRect(0, 0, 512, 128, 20); ctx.fill();
             ctx.fillStyle = txtColor; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; 
             ctx.fillText(text, 256, 85);
             const tex = new THREE.CanvasTexture(canvas);
             const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
             const sprite = new THREE.Sprite(mat);
             sprite.scale.set(12, 3, 1);
             return sprite;
        };

        // Wash Bay (Open air drive-thru)
        const washGroup = new THREE.Group();
        washGroup.position.set(55, 0, -40);
        
        const washGlass = new THREE.MeshPhysicalMaterial({ color: '#0ea5e9', transmission: 0.9, opacity: 1, transparent: true, ior: 1.5, roughness: 0.1, side: THREE.DoubleSide });
        const washConc = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, map: concreteTex });
        
        // Roof
        const wRoof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 12), washConc);
        wRoof.position.y = 6;
        washGroup.add(wRoof);
        
        // 4 Pillars
        [-4.5, 4.5].forEach(x => {
            [-5.5, 5.5].forEach(z => {
                const wPillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), washConc);
                wPillar.position.set(x, 3, z);
                wPillar.castShadow = true;
                wPillar.receiveShadow = true;
                wPillar.userData.solid = true;
                washGroup.add(wPillar);
            });
        });
        
        // Left and Right Glass Walls (Leave front and back open for vehicles)
        const wWallGeo = new THREE.BoxGeometry(0.2, 5.5, 11);
        const wWallL = new THREE.Mesh(wWallGeo, washGlass); wWallL.position.set(-4.5, 3.25, 0); washGroup.add(wWallL);
        const wWallR = new THREE.Mesh(wWallGeo, washGlass); wWallR.position.set(4.5, 3.25, 0); washGroup.add(wWallR);
        
        const washSign = createBuildingSign('CAR WASH', '#0ea5e9', '#ffffff');
        washSign.position.set(0, 8, 0); // Hovering above
        washGroup.add(washSign);

        scene.add(washGroup);
        environmentDisposables.push(washGroup, washSign);

        // Mechanic Bay Garage
        const mechGroup = new THREE.Group();
        mechGroup.position.set(55, 0, 5);
        
        const darkConc = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 1.0, map: concreteTex });
        const industrialFloor = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.6 });
        const cautionMat = new THREE.MeshStandardMaterial({ color: '#eab308' }); // Yellow trim
        
        // Solid Back Wall and Side Walls
        const mWallLRGeo = new THREE.BoxGeometry(0.5, 6, 15);
        const mWallL = new THREE.Mesh(mWallLRGeo, darkConc); mWallL.position.set(-5.75, 3, 0); mWallL.castShadow = true; mWallL.receiveShadow = true; mWallL.userData.solid = true; mechGroup.add(mWallL);
        const mWallR = new THREE.Mesh(mWallLRGeo, darkConc); mWallR.position.set(5.75, 3, 0); mWallR.castShadow = true; mWallR.receiveShadow = true; mWallR.userData.solid = true; mechGroup.add(mWallR);
        
        const mWallBack = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6, 0.5), darkConc);
        mWallBack.position.set(0, 3, 7.25);
        mWallBack.castShadow = true; mWallBack.receiveShadow = true; mWallBack.userData.solid = true;
        mechGroup.add(mWallBack);
        
        // Front Frame (Wide Open Garage Door)
        const mGarageTrimL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), cautionMat); mGarageTrimL.position.set(-5, 3, -7.25); mechGroup.add(mGarageTrimL);
        const mGarageTrimR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), cautionMat); mGarageTrimR.position.set(5, 3, -7.25); mechGroup.add(mGarageTrimR);
        const mGarageTop = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 0.5), cautionMat); mGarageTop.position.set(0, 5.25, -7.25); mechGroup.add(mGarageTop);

        // Floor and Roof
        const mRoof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 15), darkConc); mRoof.position.set(0, 6.25, 0); mRoof.castShadow = true; mechGroup.add(mRoof);
        const mFloor = new THREE.Mesh(new THREE.PlaneGeometry(11, 14), industrialFloor); mFloor.rotation.x = -Math.PI / 2; mFloor.position.set(0, 0.05, 0); mFloor.receiveShadow = true; mechGroup.add(mFloor);
        
        const mechSign = createBuildingSign('MECHANIC', '#eab308', '#000000');
        mechSign.position.set(0, 9, -7.3); // Hovering above entrance
        mechGroup.add(mechSign);

        scene.add(mechGroup);
        environmentDisposables.push(mechGroup, mechSign);

        // Body Shop Garage
        const bodyGroup = new THREE.Group();
        bodyGroup.position.set(55, 0, 50);
        
        const bodyTrimMat = new THREE.MeshStandardMaterial({ color: '#3b82f6' }); // Blue trim for Body Shop
        
        // Solid Back Wall and Side Walls
        const bWallL = new THREE.Mesh(mWallLRGeo, darkConc); bWallL.position.set(-5.75, 3, 0); bWallL.castShadow = true; bWallL.receiveShadow = true; bWallL.userData.solid = true; bodyGroup.add(bWallL);
        const bWallR = new THREE.Mesh(mWallLRGeo, darkConc); bWallR.position.set(5.75, 3, 0); bWallR.castShadow = true; bWallR.receiveShadow = true; bWallR.userData.solid = true; bodyGroup.add(bWallR);
        
        const bWallBack = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6, 0.5), darkConc);
        bWallBack.position.set(0, 3, 7.25);
        bWallBack.castShadow = true; bWallBack.receiveShadow = true; bWallBack.userData.solid = true;
        bodyGroup.add(bWallBack);
        
        // Front Frame (Wide Open Garage Door)
        const bGarageTrimL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), bodyTrimMat); bGarageTrimL.position.set(-5, 3, -7.25); bodyGroup.add(bGarageTrimL);
        const bGarageTrimR = new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.5), bodyTrimMat); bGarageTrimR.position.set(5, 3, -7.25); bodyGroup.add(bGarageTrimR);
        const bGarageTop = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 0.5), bodyTrimMat); bGarageTop.position.set(0, 5.25, -7.25); bodyGroup.add(bGarageTop);

        // Floor and Roof
        const bRoof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 15), darkConc); bRoof.position.set(0, 6.25, 0); bRoof.castShadow = true; bodyGroup.add(bRoof);
        const bFloor = new THREE.Mesh(new THREE.PlaneGeometry(11, 14), industrialFloor); bFloor.rotation.x = -Math.PI / 2; bFloor.position.set(0, 0.05, 0); bFloor.receiveShadow = true; bodyGroup.add(bFloor);
        
        const bodySign = createBuildingSign('BODY SHOP', '#3b82f6', '#ffffff');
        bodySign.position.set(0, 9, -7.3); // Hovering above entrance
        bodyGroup.add(bodySign);

        scene.add(bodyGroup);
        environmentDisposables.push(bodyGroup, bodySign);

