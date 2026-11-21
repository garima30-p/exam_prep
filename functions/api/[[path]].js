import { handle } from '../../server/engine.mjs';

export function onRequest({request}) {
  return handle(request);
}

