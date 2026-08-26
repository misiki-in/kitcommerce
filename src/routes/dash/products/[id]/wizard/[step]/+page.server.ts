import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, blob, planner, repo } from "$server/app";
import { newId } from "$server/ids";
import { getConnector } from "$server/connectors";
import { brandMark } from "$server/connectors/brand";
import { missingRequiredFields, type FieldSpec } from "$server/connector";
import { suggestAll, suggestVariantSku } from "$server/suggest";

const STEPS = ["basics", "pricing", "images", "attributes", "review"] as const;
type Step = (typeof STEPS)[number];

const NEXT: Record<Step, string> = {
  basics: "pricing",
  pricing: "images",
  images: "attributes",
  attributes: "review",
  review: "review",
};

export const load: PageServerLoad = async ({ locals, params }) => {
  const step = params.step as Step;
  if (!STEPS.includes(step)) error(404, "Unknown step");
  if (!authz.canAccessProduct(locals.principal!, params.id)) error(404, "Product not found");

  const product = repo.getProduct(params.id);
  const canonical = repo.canonical(params.id);
  if (!product || !canonical) error(404, "Product not found");

  const store = repo.getStore(product.store_id)!;
  const channels = repo.listChannels(product.store_id);

  /**
   * Only the connected channels' requirements are asked for. Demanding an Etsy
   * taxonomy ID from a seller who only sells on Flipkart is how a wizard earns
   * a reputation for busywork.
   */
  const required = new Map<string, { spec: FieldSpec; connectors: string[] }>();
  for (const c of channels) {
    const manifest = getConnector(c.connector).manifest();
    for (const f of manifest.requiredFields) {
      if (!f.path.startsWith("attributes.")) continue;
      const key = f.path.slice("attributes.".length);
      const hit = required.get(key);
      if (hit) hit.connectors.push(manifest.displayName);
      else required.set(key, { spec: f, connectors: [manifest.displayName] });
    }
  }

  const attributes = JSON.parse(product.attributes || "{}") as Record<string, string>;
  const suggestions = suggestAll(repo, store.id, {
    title: product.title,
    brand: product.brand,
    category: product.category,
    attributes,
  });
  const known = new Map(suggestions.attributes.map((a) => [a.key, a.values]));

  return {
    step,
    currency: store.currency,
    product: {
      id: product.id,
      title: product.title,
      sku: product.sku,
      brand: product.brand,
      category: product.category,
      description: product.description,
      status: product.status,
      hsnCode: product.hsn_code,
      taxRatePct: product.tax_rate_bp / 100,
      weightG: product.weight_g,
      lengthMm: product.length_mm,
      widthMm: product.width_mm,
      heightMm: product.height_mm,
    },
    variants: repo.variants(product.id).map((v) => ({
      sku: v.sku,
      barcode: v.barcode,
      options: Object.entries(JSON.parse(v.options || "{}") as Record<string, string>)
        .map(([k, val]) => `${k}=${val}`)
        .join("; "),
      price: (v.price_cents / 100).toFixed(2),
      mrp: (v.mrp_cents / 100).toFixed(2),
      stock: v.available,
    })),
    images: repo.images(product.id).map((i) => ({ id: i.id, url: i.url })),
    attributes,
    requiredAttributes: [...required.entries()]
      .sort((a, b) => b[1].connectors.length - a[1].connectors.length || a[0].localeCompare(b[0]))
      .map(([key, { spec, connectors }]) => ({
        key,
        label: spec.label,
        help: spec.help ?? "",
        choices: spec.enum ?? known.get(key) ?? [],
        connectors,
        filled: String(attributes[key] ?? "").trim() !== "",
      })),
    extraAttributes: Object.entries(attributes)
      .filter(([k]) => !required.has(k))
      .map(([key, value]) => ({ key, value: String(value) })),
    channels: channels.map((c) => {
      const manifest = getConnector(c.connector).manifest();
      const missing = missingRequiredFields(manifest, canonical);
      return {
        id: c.id,
        name: c.name,
        mark: brandMark(c.connector, 26),
        ready: missing.length === 0,
        missing: missing.map((f) => f.label),
      };
    }),
  };
};

const parseOptions = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const pair of raw.split(/[;,]/)) {
    const [k, v] = pair.split("=");
    if (k?.trim() && v?.trim()) out[k.trim()] = v.trim();
  }
  return out;
};

/** Every step is a partial save, so untouched sections keep their values. */
async function patch(
  locals: App.Locals,
  id: string,
  fields: Partial<Parameters<typeof repo.saveProduct>[0]>,
) {
  const product = repo.getProduct(id)!;
  return repo.saveProduct({
    orgId: locals.principal!.organizationId,
    storeId: product.store_id,
    id: product.id,
    sku: product.sku,
    title: product.title,
    brand: product.brand,
    category: product.category,
    description: product.description,
    status: product.status,
    attributes: JSON.parse(product.attributes || "{}"),
    hsnCode: product.hsn_code,
    taxRateBp: product.tax_rate_bp,
    weightG: product.weight_g,
    lengthMm: product.length_mm,
    widthMm: product.width_mm,
    heightMm: product.height_mm,
    ...fields,
  });
}

export const actions: Actions = {
  save: async ({ request, locals, params }) => {
    if (!authz.canAccessProduct(locals.principal!, params.id)) error(403, "forbidden");
    const step = params.step as Step;
    const form = await request.formData();
    const str = (k: string) => String(form.get(k) ?? "").trim();
    const num = (k: string) => Number(form.get(k) ?? 0) || 0;

    const product = repo.getProduct(params.id)!;
    const store = repo.getStore(product.store_id)!;

    if (step === "basics") {
      const sku = str("sku");
      if (!sku || !str("title")) return fail(400, { error: "Title and SKU are required." });
      const clash = repo.getProductBySku(product.store_id, sku);
      if (clash && clash.id !== product.id) {
        return fail(400, { error: `SKU ${sku} is already used by another product.` });
      }
      await patch(locals, product.id, {
        sku,
        title: str("title"),
        brand: str("brand"),
        category: str("category"),
        description: str("description"),
      });
    }

    if (step === "pricing") {
      const skus = form.getAll("variant_sku").map(String);
      const variants = skus
        .map((sku, i) => {
          const opts = parseOptions(String(form.getAll("variant_options")[i] ?? ""));
          const price = Number(form.getAll("variant_price")[i] ?? 0) || 0;
          const mrp = Number(form.getAll("variant_mrp")[i] ?? 0) || 0;
          return {
            sku: sku.trim() || suggestVariantSku(product.sku, opts),
            barcode: String(form.getAll("variant_barcode")[i] ?? "").trim(),
            options: opts,
            priceCents: Math.round(price * 100),
            mrpCents: Math.round((mrp || price) * 100),
            currency: store.currency,
            available: Number(form.getAll("variant_stock")[i] ?? 0) || 0,
          };
        })
        .filter((v) => v.sku);

      await patch(locals, product.id, {
        hsnCode: str("hsn_code"),
        taxRateBp: Math.round(num("tax_rate") * 100),
        weightG: num("weight_g"),
        lengthMm: num("length_mm"),
        widthMm: num("width_mm"),
        heightMm: num("height_mm"),
        variants: variants.length ? variants : undefined,
      });
    }

    if (step === "images") {
      const uploaded: string[] = [];
      for (const f of form.getAll("image_file")) {
        if (f instanceof File && f.size > 0) {
          const ext = (f.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
          uploaded.push(await blob.put(`${newId("img")}.${ext}`, await f.arrayBuffer(), f.type));
        }
      }
      const urls = form.getAll("image_url").map((v) => String(v).trim()).filter(Boolean);
      await patch(locals, product.id, {
        images: [...urls, ...uploaded].map((url) => ({ url })),
      });
    }

    if (step === "attributes") {
      const attributes: Record<string, string> = {};
      for (const [k, v] of form.entries()) {
        if (!k.startsWith("attr_")) continue;
        const value = String(v).trim();
        if (value) attributes[k.slice(5)] = value;
      }
      const keys = form.getAll("extra_key").map((v) => String(v).trim());
      const values = form.getAll("extra_value").map((v) => String(v).trim());
      keys.forEach((k, i) => {
        if (k) attributes[k] = values[i] ?? "";
      });
      await patch(locals, product.id, { attributes });
    }

    redirect(303, `/dash/products/${product.id}/wizard/${NEXT[step]}`);
  },

  publish: async ({ locals, params }) => {
    if (!authz.canAccessProduct(locals.principal!, params.id)) error(403, "forbidden");
    const product = repo.getProduct(params.id)!;

    // ACTIVE is what the planner reacts to; the version bump gives the fan-out
    // a fresh idempotency key.
    await patch(locals, product.id, { status: "ACTIVE" });

    const queued = planner.planProduct(
      locals.principal!.organizationId,
      product.store_id,
      product.id,
      "PRODUCT_UPDATE",
    );
    repo.audit({
      orgId: locals.principal!.organizationId,
      storeId: product.store_id,
      actorUserId: locals.principal!.user.id,
      action: "ProductPublished",
      entityType: "product",
      entityId: product.id,
      metadata: { queued },
    });
    redirect(303, `/dash/activity?queued=${queued}`);
  },
};
