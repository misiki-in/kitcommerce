/**
 * Indian Fashion, Beauty and Horizontal Marketplace Connectors.
 */
import { makeConnector } from "./api";
import {
  AJIO_SPEC,
  JIOMART_SPEC,
  MYNTRA_SPEC,
  NYKAA_SPEC,
  SNAPDEAL_SPEC,
  TATACLIQ_SPEC,
} from "./manifest";

export const myntra = makeConnector(MYNTRA_SPEC);
export const ajio = makeConnector(AJIO_SPEC);
export const jiomart = makeConnector(JIOMART_SPEC);
export const nykaa = makeConnector(NYKAA_SPEC);
export const tatacliq = makeConnector(TATACLIQ_SPEC);
export const snapdeal = makeConnector(SNAPDEAL_SPEC);
