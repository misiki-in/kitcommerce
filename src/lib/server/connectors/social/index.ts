/**
 * Social Channel Connectors: Meta (Instagram and Facebook).
 */
import { makeMetaConnector } from "./api";
import { FACEBOOK_SPEC, INSTAGRAM_SPEC } from "./manifest";

export const instagram = makeMetaConnector(INSTAGRAM_SPEC);
export const facebook = makeMetaConnector(FACEBOOK_SPEC);
