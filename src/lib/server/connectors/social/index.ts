/**
 * Social Channel Connectors: Meta (Facebook & Instagram).
 */
import { makeMetaConnector } from "./api";
import { FACEBOOK_SPEC, INSTAGRAM_SPEC, META_SPEC } from "./manifest";

export {
  META_SPEC,
  FACEBOOK_SPEC,
  INSTAGRAM_SPEC,
  META_REQUIRED,
  META_CAPABILITIES,
  metaAuth,
} from "./manifest";
export {
  discoverAllMetaResources,
  exchangeMetaToken,
  makeMetaConnector,
} from "./api";

export const meta = makeMetaConnector(META_SPEC);
export const instagram = makeMetaConnector(INSTAGRAM_SPEC);
export const facebook = makeMetaConnector(FACEBOOK_SPEC);

