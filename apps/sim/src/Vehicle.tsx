import React, { useRef, useState, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import { useGameStore } from './store';
import * as THREE from 'three';

export const Vehicle = forwardRef(({ car, isMe, isDriving, initialPosition }: { car: any, isMe: boolean, isDriving: boolean, initialPosition: [number, number, number] }, ref) => {
  const rigidBodyRef = useRef<any>(null);
  const [, get] = useKeyboardControls();
  const { setDrivingCarId } = useGameStore();
  const [interactPressed, setInteractPressed] = useState(false);

  useFrame((state, delta) => {
    if (!rigidBodyRef.current) return;
    
    if (isDriving) {
        const { forward, backward, left, right, interact } = get();
        
        // Exit car
        if (interact && !interactPressed) {
            setInteractPressed(true);
            setDrivingCarId(null);
        } else if (!interact) {
            setInteractPressed(false);
        }

        // Basic driving physics (arcade style)
        const engineForce = 800 * delta;
        const turnSpeed = 2 * delta;
        
        const rot = rigidBodyRef.current.rotation();
        // Forward vector
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        
        if (forward) {
             rigidBodyRef.current.applyImpulse({ x: direction.x * engineForce, y: 0, z: direction.z * engineForce }, true);
        }
        if (backward) {
             rigidBodyRef.current.applyImpulse({ x: -direction.x * engineForce, y: 0, z: -direction.z * engineForce }, true);
        }
        
        // Only allow turning if moving (simple approximation)
        const v = rigidBodyRef.current.linvel();
        if (!v) return;

        const speed = Math.sqrt(v.x*v.x + v.z*v.z);
        if (speed > 0.5) {
            const turnDir = forward ? 1 : backward ? -1 : 0;
            if (turnDir !== 0) {
               if (left) rigidBodyRef.current.applyTorqueImpulse({ x: 0, y: turnSpeed * 1500 * turnDir, z: 0 }, true);
               if (right) rigidBodyRef.current.applyTorqueImpulse({ x: 0, y: -turnSpeed * 1500 * turnDir, z: 0 }, true);
            }
        }

        // Camera follow behind car
        const t = rigidBodyRef.current.translation();
        if (!t || typeof t.x !== 'number') return;
        
        // Calculate offset behind the car
        const camOffset = new THREE.Vector3(0, 5, 12).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        const targetCamPos = new THREE.Vector3(t.x + camOffset.x, t.y + camOffset.y, t.z + camOffset.z);
        
        state.camera.position.lerp(targetCamPos, 0.1);
        state.camera.lookAt(t.x, t.y, t.z);
    }
  });

  const getValidColor = (c: string) => {
      if (!c) return isMe ? "#3b82f6" : "#4b5563";
      if (c === 'Trade-In Silver') return '#C0C0C0';
      if (c === 'Repo Gray') return '#808080';
      return c;
  }

  return (
    <RigidBody ref={rigidBodyRef} colliders="cuboid" mass={1500} position={initialPosition} linearDamping={1.5} angularDamping={2}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4, 2, 8]} />
        <meshStandardMaterial color={getValidColor(car.color)} metalness={0.9} roughness={0.1} />
      </mesh>
    </RigidBody>
  );
});
