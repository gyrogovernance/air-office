import { registerStaticDemoClient } from '../shared/service-client.hook';
import { createStaticDemoClient } from './static-demo-client';

/** Loaded only by the static Pages entry so product builds never import the snapshot. */
registerStaticDemoClient(createStaticDemoClient);
