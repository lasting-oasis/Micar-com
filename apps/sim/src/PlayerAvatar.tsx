import React, { useRef, useState, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody, CapsuleCollider } from '@react-three/rapier';
import { useGameStore } from './store';
import * as THREE from 'three';

export const PlayerAvatar = forwardRef(({ inventory }: { inventory: any[] }, ref) => {
  const rigidBodyRef = useRef<any>(null);
  const [, get] = useKeyboardControls();
  const { drivingCarId, setDrivingCarId } = useGameStore();
  const [interactPressed, setInteractPressed] = useState(false);
  
  useFrame((state, delta) => {
    if (!rigidBodyRef.current || drivingCarId) return; // Do not render or update physics if driving
    
    const { forward, backward, left, right, interact } = get();
    
    // Interact logic: toggle entering car
    if (interact && !interactPressed) {
       setInteractPressed(true);
       // Find closest car
       const myPos = rigidBodyRef.current.translation();
       // We don't have access to car positions directly here unless we track them, 
       // but for simplicity, let's just pick the first one if we're near origin, 
       // or we'll just track their positions in a ref. 
       // For a quick implementation, let's just enter the first car in inventory
       if (inventory.length > 0) {
           setDrivingCarId(inventory[0].id);
       }
    } else if (!interact) {
       setInteractPressed(false);
    }

    // Movement
    const speed = 15;
    const currentVel = rigidBodyRef.current.linvel();
    if (!currentVel) return; // Safety check if physics not ready

    const velocity = { x: 0, y: currentVel.y || 0, z: 0 };
    
    if (forward) velocity.z -= speed;
    if (backward) velocity.z += speed;
    if (left) velocity.x -= speed;
    if (right) velocity.x += speed;
    
    rigidBodyRef.current.setLinvel(velocity, true);

    // Camera follow behind player
    const t = rigidBodyRef.current.translation();
    if (!t || typeof t.x !== 'number') return; // Protect camera from NaN breakdown

    const targetCamPos = new THREE.Vector3(t.x, t.y + 3, t.z + 8);
    state.camera.position.lerp(targetCamPos, 0.1);
    state.camera.lookAt(t.x, t.y + 1, t.z);
  });

  if (drivingCarId) return null; // Hide avatar when driving

  return (
    <RigidBody ref={rigidBodyRef} colliders={false} mass={80} position={[0, 2, 5]} lockRotations linearDamping={5}>
      <CapsuleCollider args={[1, 0.5]} />
      <mesh castShadow>
        <capsuleGeometry args={[0.5, 1, 4]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
    </RigidBody>
  );
});
