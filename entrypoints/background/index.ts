import { startBackground } from './startup';

export default defineBackground(() => {
  // MV3 event listeners must be registered synchronously so a cold-start
  // alarm, proxy request, or auth challenge is not lost while storage loads.
  startBackground();
});
