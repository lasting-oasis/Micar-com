import React from 'react';
import { useGameStore } from './store';
import { Physics, RigidBody } from '@react-three/rapier';

export function GameScene() {
  const { gameState, playerId, drivingCarId } = useGameStore();

  if (!gameState) {
      console.log("GameScene V3: No GameState");
      return null;
  }
  
  console.log("GameScene V3 rendered. Cache busted.");

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
      <pointLight position={[0, 5, 0]} intensity={2} color="#3b82f6" />
      
      <Physics>
        {Object.values(gameState.players).map((p) => {
          const isMe = p.id === playerId;
          return (
            <group key={p.id} position={[p.lotPosition.x, 0, p.lotPosition.z]}>
              {/* The Dealership Lot Floor */}
              <RigidBody type="fixed" colliders="cuboid" position={[0, -0.5, 0]}>
                  <mesh receiveShadow>
                     <boxGeometry args={[60, 1, 60]} />
                     <meshStandardMaterial color={isMe ? "#111" : "#0a0a0a"} metalness={0.8} roughness={0.2} />
                  </mesh>
              </RigidBody>
              
              <gridHelper args={[60, 20, isMe ? '#3b82f6' : '#333', '#111']} position={[0, 0.01, 0]} />

              {/* Cars in Inventory */}
              {/* p.inventory.map((car, idx) => {
                const xPos = ((idx % 2) === 0 ? -1 : 1) * 6;
                const zPos = Math.floor(idx / 2) * 5 - 10;
                return (
                  <Vehicle 
                     key={car.id} 
                     car={car} 
                     isMe={isMe} 
                     isDriving={isMe && drivingCarId === car.id} 
                     initialPosition={[xPos, 2, zPos]} 
                  />
                );
              }) */}
              
              {/* Spawn Avatar for current player */}
              {/* isMe && <PlayerAvatar inventory={p.inventory} /> */}
            </group>
          );
        })}
      </Physics>
    </>
  );
}
