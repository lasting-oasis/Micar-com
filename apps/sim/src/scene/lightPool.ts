import * as THREE from 'three';

// Three.js lights every pixel with every light in the scene, and adding or
// removing a light forces all materials to recompile. So instead of one
// PointLight per lamp (20+ in the city), the scene keeps a small FIXED pool of
// lights and moves them to whichever lamps are closest to the player.
//
// Every light in the scene costs every lit pixel, even at intensity 0 (the
// shader can't skip it). So the number of pool lights actually in the scene can
// be lowered (setActiveCount): Low graphics uses none by day and a few at night.

export type LightSource = {
    position: THREE.Vector3;
    color: THREE.ColorRepresentation;
    intensity: number;
    distance: number;
    /** Street lamps only glow after dusk; interiors are always lit. */
    nightOnly: boolean;
};

export class LightPool {
    private readonly lights: THREE.PointLight[] = [];
    private readonly sources: LightSource[] = [];
    private readonly colors = new Map<LightSource, THREE.Color>();
    private sinceUpdate = Infinity;
    private active = 0;

    constructor(private readonly scene: THREE.Scene, size = 8) {
        for (let i = 0; i < size; i++) {
            const light = new THREE.PointLight(0xffffff, 0, 1);
            light.castShadow = false;
            this.lights.push(light);
        }
        this.setActiveCount(size);
    }

    get size() { return this.lights.length; }
    get activeCount() { return this.active; }

    /**
     * How many of the pool's lights are in the scene. A change makes every lit
     * material switch shaders (compiled once per light count, then cached), so
     * only change it on rare events: a quality toggle, dusk and dawn.
     */
    setActiveCount(n: number) {
        n = Math.max(0, Math.min(this.lights.length, Math.floor(n)));
        if (n === this.active) return;
        this.lights.forEach((light, i) => {
            if (i < n) {
                if (light.parent !== this.scene) this.scene.add(light);
            } else {
                light.removeFromParent();
                light.intensity = 0;
                light.userData.source = undefined;
            }
        });
        this.active = n;
        this.sinceUpdate = Infinity; // re-pick on the next update
    }

    add(source: LightSource) {
        this.sources.push(source);
        this.colors.set(source, new THREE.Color(source.color));
        this.sinceUpdate = Infinity; // re-pick on the next update
    }

    /**
     * @param focus   where the player (or driven car) is
     * @param night   0 = full daylight, 1 = full night
     * @param dt      seconds since the last frame; lights are re-picked ~4x/sec
     */
    update(focus: THREE.Vector3, night: number, dt: number) {
        if (this.active === 0) return;
        this.sinceUpdate += dt;
        if (this.sinceUpdate < 0.25) {
            // Keep night-only lamps fading smoothly between re-picks.
            for (let i = 0; i < this.active; i++) {
                const l = this.lights[i];
                const src = l.userData.source as LightSource | undefined;
                if (src) l.intensity = src.nightOnly ? src.intensity * night : src.intensity;
            }
            return;
        }
        this.sinceUpdate = 0;
        const picks = this.sources
            .filter(s => !s.nightOnly || night > 0.01)
            .map(s => ({ s, d: s.position.distanceToSquared(focus) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, this.active);
        for (let i = 0; i < this.active; i++) {
            const light = this.lights[i];
            const pick = picks[i];
            if (!pick) { light.intensity = 0; light.userData.source = undefined; continue; }
            const s = pick.s;
            light.position.copy(s.position);
            light.color.copy(this.colors.get(s)!);
            light.distance = s.distance;
            light.intensity = s.nightOnly ? s.intensity * night : s.intensity;
            light.userData.source = s;
        }
    }

    dispose() {
        this.lights.forEach(l => { l.removeFromParent(); l.dispose(); });
    }
}
