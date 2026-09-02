import { error, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, queue, repo } from "$server/app";
import { brandMark } from "$server/connectors/brand";
import { getConnector } from "$server/connectors";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!authz.canAccessJob(locals.principal!, params.id)) {
    error(404, "Job not found or access denied");
  }

  const job = repo.getJob(params.id);
  if (!job) error(404, "Sync job not found");

  const batchParam = url.searchParams.get("batch");
  let groupedJobs: any[] = [];

  if (batchParam || job.channel_id) {
    const createdAtTime = batchParam ? Number(batchParam) : job.created_at;
    const batchList = repo.getBatchJobs(
      job.store_id,
      job.channel_id,
      job.operation,
      createdAtTime,
      60000,
    );

    if (batchList.length > 1) {
      groupedJobs = batchList.map((gj: any) => ({
        id: gj.id,
        status: gj.status,
        operation: gj.operation,
        attemptCount: gj.attempt_count,
        lastError: gj.last_error,
        product: gj.product_title ? { id: gj.entity_id, title: gj.product_title, sku: gj.product_sku } : null,
      }));
    }
  }

  const channel = job.channel_id ? repo.getChannel(job.channel_id) : null;
  const rawAttempts = repo.jobAttempts(job.id);
  const product = job.entity_type === "product" ? repo.getProduct(job.entity_id) : null;

  let connectorName = channel?.connector || job.connector || "";
  let mark = connectorName ? brandMark(connectorName, 28) : "";

  return {
    groupedJobs,
    job: {
      id: job.id,
      organizationId: job.organization_id,
      storeId: job.store_id,
      channelId: job.channel_id,
      channelName: channel?.name || connectorName,
      connector: connectorName,
      mark,
      operation: job.operation,
      entityType: job.entity_type,
      entityId: job.entity_id,
      status: job.status,
      attemptCount: job.attempt_count,
      maxAttempts: job.max_attempts,
      nextAttemptAt: job.next_attempt_at,
      lastError: job.last_error,
      payload: JSON.parse(job.payload || "{}"),
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    },
    product: product
      ? {
          id: product.id,
          title: product.title,
          sku: product.sku,
          brand: product.brand,
          category: product.category,
          status: product.status,
        }
      : null,
    attempts: rawAttempts.map((a: any) => {
      let duration = a.duration_ms || 0;
      if (!duration && job.completed_at && job.started_at) {
        duration = Math.max(0, job.completed_at - job.started_at);
      }
      return {
        id: a.id,
        attempt: a.attempt,
        status: a.status,
        errorClass: a.error_class,
        errorSnippet: a.error_snippet || a.error,
        durationMs: duration,
        createdAt: a.created_at,
      };
    }),
  };
};

export const actions: Actions = {
  retry: async ({ locals, params }) => {
    if (!authz.canAccessJob(locals.principal!, params.id)) {
      error(403, "Forbidden");
    }
    queue.retry(params.id);
    return { retried: true };
  },
};
