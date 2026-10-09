// Node-only test adapter. Browsers use index.html's native import map.
import { registerHooks } from 'node:module';
const three = new URL('../vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
 return nextResolve(specifier === 'three' ? three : specifier, context);
} });
