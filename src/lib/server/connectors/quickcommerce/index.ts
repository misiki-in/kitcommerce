/**
 * Quick Commerce Marketplace Connectors: Blinkit, Instamart, Zepto.
 */
import { makeConnector } from "./api";
import { BLINKIT_SPEC, INSTAMART_SPEC, ZEPTO_SPEC } from "./manifest";

export { allocateStock } from "./allocation";

export const zepto = makeConnector(ZEPTO_SPEC);
export const instamart = makeConnector(INSTAMART_SPEC);
export const blinkit = makeConnector(BLINKIT_SPEC);
