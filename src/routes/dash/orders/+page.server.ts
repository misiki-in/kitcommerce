import { redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { repo } from "$server/app";
import { importOrders } from "$server/sync";
import { brandMark } from "$server/connectors/brand";
import { getConnector } from "$server/connectors";
import { orderUrl } from "$server/connector";

export const load: PageServerLoad = async ({ locals }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  // Channel mode decides whether an outbound link makes sense: a mock order
  // has no counterpart on the marketplace, so linking to it would 404.
  const modeByChannel = new Map(repo.listChannels(store.id).map((c) => [c.id, c.mode]));

  return {
    orders: repo.listOrders(store.id, 200).map((o) => ({
      id: o.id,
      externalId: o.external_id,
      source: o.source,
      channelName: o.channel_name ?? o.source,
      status: o.status,
      totalCents: o.total_cents,
      currency: o.currency,
      createdAt: o.created_at,
      customer: JSON.parse(o.customer || "{}") as { name?: string; email?: string },
      items: repo.orderItems(o.id),
      mark: brandMark(o.source, 26),
      isMock: (modeByChannel.get(o.channel_id) ?? "mock") === "mock",
      externalUrl: (() => {
        try {
          return orderUrl(getConnector(o.source).manifest(), o.external_id);
        } catch {
          return "";
        }
      })(),
      marketplace: (() => {
        try {
          return getConnector(o.source).manifest().displayName;
        } catch {
          return o.source;
        }
      })(),
    })),
  };
};

export const actions: Actions = {
  import: async ({ locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return { imported: 0 };
    const imported = await importOrders(repo, store.id, Date.now() - 30 * 86_400_000);
    return { imported };
  },
};
