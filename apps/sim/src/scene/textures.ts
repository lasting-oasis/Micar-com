import * as THREE from 'three';

// Procedural canvas textures and sprite signs used by the 3D world.

// Procedural Daylight Environment Map for High-Fidelity PBR Reflections
export const generateEnvMap = () => {
     const canvas = document.createElement('canvas');
     canvas.width = 512; canvas.height = 512;
     const ctx = canvas.getContext('2d');
     if (!ctx) return new THREE.Texture();
     const grad = ctx.createLinearGradient(0, 0, 0, 512);
     grad.addColorStop(0, '#60a5fa'); // Sky blue top
     grad.addColorStop(0.5, '#3b82f6'); // Bright blue middle
     grad.addColorStop(1, '#bae6fd'); // Light cyan horizon
     ctx.fillStyle = grad;
     ctx.fillRect(0, 0, 512, 512);
     const tex = new THREE.CanvasTexture(canvas);
     tex.mapping = THREE.EquirectangularReflectionMapping;
     return tex;
};

export const createBuildingSign = (text: string, bgColor: string, txtColor: string) => {
     const canvas = document.createElement('canvas');
     canvas.width = 512; canvas.height = 128;
     const ctx = canvas.getContext('2d');
     if (!ctx) return new THREE.Sprite();
     ctx.fillStyle = bgColor;
     if (ctx.roundRect) ctx.roundRect(0, 0, 512, 128, 20); else ctx.rect(0, 0, 512, 128);
     ctx.fill();
     ctx.fillStyle = txtColor; ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; 
     ctx.fillText(text, 256, 85);
     const tex = new THREE.CanvasTexture(canvas);
     const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
     const sprite = new THREE.Sprite(mat);
     sprite.scale.set(12, 3, 1);
     return sprite;
};

export const generateConcreteTexture = () => {
     const size = 512;
     const canvas = document.createElement('canvas');
     canvas.width = size; canvas.height = size;
     const context = canvas.getContext('2d');
     if (!context) return new THREE.Texture();
     const imgData = context.createImageData(size, size);
     for (let i = 0; i < imgData.data.length; i += 4) {
         const v = 80 + Math.random() * 60; 
         imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
     }
     context.putImageData(imgData, 0, 0);
     const tex = new THREE.CanvasTexture(canvas);
     tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
     tex.repeat.set(4, 4);
     return tex;
};

// Dark asphalt with fine aggregate speckle for realistic lot paving
export const generateAsphaltTexture = () => {
     const size = 512;
     const canvas = document.createElement('canvas');
     canvas.width = size; canvas.height = size;
     const context = canvas.getContext('2d');
     if (!context) return new THREE.Texture();
     const imgData = context.createImageData(size, size);
     for (let i = 0; i < imgData.data.length; i += 4) {
         // Base dark asphalt with occasional lighter gravel flecks
         const base = 24 + Math.random() * 14;
         const fleck = Math.random() < 0.05 ? 35 + Math.random() * 45 : 0;
         const v = Math.min(95, base + fleck);
         imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v + 2; imgData.data[i+3] = 255;
     }
     context.putImageData(imgData, 0, 0);
     const tex = new THREE.CanvasTexture(canvas);
     tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
     tex.repeat.set(6, 6);
     return tex;
};

// --- Realistic galvanized chain-link fencing ---------------------------
// Transparent diamond-wire texture used as both color + alpha map so the
// fence reads as real woven steel rather than a flat wireframe plane.
export const generateChainLinkTexture = () => {
     const size = 128;
     const canvas = document.createElement('canvas');
     canvas.width = size; canvas.height = size;
     const ctx = canvas.getContext('2d');
     if (!ctx) return new THREE.Texture();
     ctx.clearRect(0, 0, size, size);
     ctx.strokeStyle = 'rgba(214, 219, 224, 1)';
     ctx.lineWidth = 2.5;
     ctx.lineCap = 'round';
     const step = 16;
     for (let i = -size; i <= size; i += step) {
         ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
         ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke();
     }
     const tex = new THREE.CanvasTexture(canvas);
     tex.wrapS = THREE.RepeatWrapping;
     tex.wrapT = THREE.RepeatWrapping;
     return tex;
};
