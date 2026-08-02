// Keep Babylon's glTF registration as a side-effect-only JavaScript module.
// Babylon 9.19's loader declarations are not compatible with exact optional
// property checking, while this runtime registration has no TypeScript API.
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
