// User-facing catalog: categories shown in the Parts panel (mirrors 3DTuning's componentType settings:
// position/ordering, menu visibility, which config keys a tile drives), build packs, factory colours, finishes.
// Variants/prices/names come from the sprite manifest (partsMeta); this file only adds presentation.

export const CATEGORIES = [
  { id: 'packs', label: 'Trims & Kits', keys: [], iconFrame: 0, kind: 'packs' },
  { id: 'front_wheel', label: 'Front Wheel', keys: ['rim_fl', 'rim_fr'], iconParts: ['rim_fl'], iconFrame: 7, zone: 'wheels' },
  { id: 'rear_wheel', label: 'Rear Wheel', keys: ['rim_rl', 'rim_rr'], iconParts: ['rim_rl'], iconFrame: 7, zone: 'wheels' },
  { id: 'tires', label: 'Tires', keys: ['tire_fl', 'tire_fr', 'tire_rl', 'tire_rr'], iconParts: ['tire_fl', 'rim_fl'], iconFrame: 7 },
  { id: 'front_bumper', label: 'Front Bumper', keys: ['front_bumper'], iconFrame: 0 },
  { id: 'rear_bumper', label: 'Rear Bumper', keys: ['rear_bumper'], iconFrame: 24 },
  { id: 'front_flares', label: 'F. Fender Flares', keys: ['front_flares'], iconParts: ['front_flares_l'], iconFrame: 7 },
  { id: 'rear_flares', label: 'R. Fender Flares', keys: ['rear_flares'], iconParts: ['rear_flares_l'], iconFrame: 7 },
  { id: 'steps', label: 'Step Bars', keys: ['steps'], iconParts: ['steps_l'], iconFrame: 7 },
  { id: 'headlights', label: 'Headlights', keys: ['headlights'], iconFrame: 0 },
  { id: 'light_bar', label: 'Roof Light Bar', keys: ['light_bar'], iconFrame: 0 },
  { id: 'hood', label: 'Hood', keys: ['hood'], iconFrame: 0 },
  { id: 'grille', label: 'Grilles', keys: ['grille'], iconFrame: 0 },
  { id: 'roof', label: 'Tops', keys: ['roof'], iconFrame: 0 },
  { id: 'doors', label: 'Doors', keys: ['doors'], iconParts: ['doors_l'], iconFrame: 7 },
  { id: 'mirrors', label: 'Mirrors', keys: ['mirrors'], iconParts: ['mirrors_l'], iconFrame: 4 },
  { id: 'snorkel', label: 'Snorkel', keys: ['snorkel'], iconFrame: 41 },
  { id: 'roof_rack', label: 'Roof Rack', keys: ['roof_rack'], iconFrame: 0 },
  { id: 'antenna', label: 'Antennas', keys: ['antenna'], iconFrame: 0 },
  { id: 'spare_wheel', label: 'Spare Wheel', keys: ['spare_wheel'], iconParts: ['spare'], iconFrame: 24 },
];

// Build packs ("Trims & Kits"): a pack is a config patch applied on top of the current build.
export const PACKS = [
  { id: 'stock', name: 'Factory trim', price: 0, patch: { hood: 'stock', doors: 'full', roof: 'hardtop', front_bumper: 'stock', rear_bumper: 'stock', front_flares: 'stock', rear_flares: 'stock', tire_fl: 'at', tire_fr: 'at', tire_rl: 'at', tire_rr: 'at', rim_fl: 'fivespoke', rim_fr: 'fivespoke', rim_rl: 'fivespoke', rim_rr: 'fivespoke', headlights: 'halogen', grille: 'slat', mirrors: 'stock', steps: 'none', roof_rack: 'none', light_bar: 'none', snorkel: 'none', antenna: 'none', spare_wheel: 'mounted' } },
  { id: 'trail', name: 'Trail kit', price: 9860, patch: { hood: 'vented', doors: 'tube', roof: 'none', front_bumper: 'steel', rear_bumper: 'steel', front_flares: 'wide', rear_flares: 'wide', tire_fl: 'mt', tire_fr: 'mt', tire_rl: 'mt', tire_rr: 'mt', rim_fl: 'beadlock', rim_fr: 'beadlock', rim_rl: 'beadlock', rim_rr: 'beadlock', headlights: 'led', grille: 'mesh', mirrors: 'stock', steps: 'sliders', roof_rack: 'none', light_bar: 'led', snorkel: 'none', antenna: 'whip', spare_wheel: 'mounted' } },
  { id: 'overland', name: 'Overland kit', price: 6420, patch: { hood: 'stock', doors: 'full', roof: 'hardtop', front_bumper: 'stubby', rear_bumper: 'steel', front_flares: 'stock', rear_flares: 'stock', tire_fl: 'at', tire_fr: 'at', tire_rl: 'at', tire_rr: 'at', rim_fl: 'steel', rim_fr: 'steel', rim_rl: 'steel', rim_rr: 'steel', headlights: 'led', grille: 'slat', mirrors: 'tow', steps: 'tube', roof_rack: 'basket', light_bar: 'led', snorkel: 'raised', antenna: 'whip', spare_wheel: 'mounted' } },
  { id: 'beach', name: 'Beach cruiser', price: 4180, patch: { hood: 'stock', doors: 'half', roof: 'soft', front_bumper: 'stock', rear_bumper: 'stock', front_flares: 'stock', rear_flares: 'stock', tire_fl: 'at', tire_fr: 'at', tire_rl: 'at', tire_rr: 'at', rim_fl: 'steel', rim_fr: 'steel', rim_rl: 'steel', rim_rr: 'steel', headlights: 'halogen', grille: 'slat', mirrors: 'stock', steps: 'tube', roof_rack: 'none', light_bar: 'none', snorkel: 'none', antenna: 'whip', spare_wheel: 'none' } },
];

// Factory colours (own palette; names are generic)
export const FACTORY_COLORS = [
  { name: 'Firecracker Red', value: 'bc1d17' }, { name: 'Copper Brown', value: '815a3d' }, { name: 'Harvest Gold', value: 'e6ad25' },
  { name: 'Ocean Blue', value: '0661a9' }, { name: 'Deep Cherry', value: 'a2002a' }, { name: 'Punk Orange', value: 'ef674a' },
  { name: 'Bright White', value: 'f9fcfd' }, { name: 'Granite Grey', value: '6d7177' }, { name: 'Sarge Green', value: '4f6a4a' },
  { name: 'Hydro Blue', value: '2b8fd6' }, { name: 'Black', value: '0b0b0d' }, { name: 'Mojave Sand', value: 'c8b48b' },
  { name: 'Gecko Green', value: '7ac043' }, { name: 'Billet Silver', value: 'b9bcc2' }, { name: 'Sting Grey', value: '4a4e52' },
  { name: 'Tuscadero Pink', value: 'd9458f' }, { name: 'Anvil', value: '3b3f44' },
];
export const INTERIOR_COLORS = [
  { name: 'Black', value: '2b2b2e' }, { name: 'Heritage Tan', value: 'a27b55' }, { name: 'Dark Saddle', value: '5c3a21' }, { name: 'Light Frost', value: 'c9c6bd' }, { name: 'Red', value: '8a1c1c' }, { name: 'Steel', value: '7c8187' },
];
export const WHEEL_COLORS = [
  { name: 'Silver', value: 'c9ccd1' }, { name: 'Gloss Black', value: '141416' }, { name: 'Gunmetal', value: '4a4e55' }, { name: 'Bronze', value: '9a6b3a' }, { name: 'White', value: 'f0f0f0' }, { name: 'Body colour', value: 'body' },
];
export const FINISH_ORDER = ['glossy', 'matte', 'satin', 'metallic', 'pearl', 'candy', 'chrome'];

// "Selected Part" choices per paintable zone (configKeys of paintable parts)
export const ZONE_PARTS = {
  exterior: [{ key: null, label: 'All Components' }, { key: 'body', label: 'Body' }, { key: 'hood', label: 'Hood' }, { key: 'doors', label: 'Doors' }, { key: 'roof', label: 'Top' }],
  interior: [{ key: null, label: 'All Components' }, { key: 'interior', label: 'Seats' }],
  wheels: [{ key: null, label: 'All Wheels' }, { key: 'rim_fl', label: 'Front left' }, { key: 'rim_fr', label: 'Front right' }, { key: 'rim_rl', label: 'Rear left' }, { key: 'rim_rr', label: 'Rear right' }],
};

export const FILTERS = [
  { id: 'none', label: 'None', css: 'none' }, { id: 'warm', label: 'Warm', css: 'sepia(0.25) saturate(1.25) contrast(1.05)' }, { id: 'cool', label: 'Cool', css: 'hue-rotate(-12deg) saturate(1.1) brightness(1.03)' },
  { id: 'bw', label: 'B & W', css: 'grayscale(1) contrast(1.15)' }, { id: 'vintage', label: 'Vintage', css: 'sepia(0.5) contrast(0.95) brightness(1.05) saturate(0.8)' }, { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)' }, { id: 'night', label: 'Night', css: 'brightness(0.55) saturate(0.8) contrast(1.2)' },
];
